// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/app.js';
import {
  DEFAULT_CONFIG,
  HOLD_DURATIONS,
  LANGUAGES,
  MIN_REFRESH_MINUTES,
  TEMPERATURE_UNITS,
} from '../src/config.js';
import { TRIGGER } from '../src/hub.js';
import { COMFORT_DURATIONS, SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { createWorld, thermostatId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .sort();

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 2, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, cloud transport, climate category', () => {
  assert.equal(manifest.name, 'ecobee');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-ecobee:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-ecobee/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['climate']);
});

test('Gladys 5.2.0 at least: the thermostat preset type and the widget button forms', () => {
  // thermostat/preset and the widget button `fields` (#3168) ship in 5.2.0;
  // categories need 4.86.0 and the capability fields 5.1.0, both below.
  assert.ok(
    isAtLeast(minGladysVersion(), [5, 2, 0]),
    `gladys_version must be >= 5.2.0, got "${manifest.gladys_version}"`,
  );
});

test('every manifest action has a registered handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
  assert.deepEqual(handlerKeys('action:'), Object.keys(ACTIONS).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:'), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has its handlers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), Object.keys(WIDGETS));
  assert.deepEqual(handlerKeys('widget:'), Object.keys(WIDGETS));
  assert.deepEqual(handlerKeys('widgetAction:'), Object.keys(WIDGETS));
});

test('the scene triggers the hub fires are the declared ones', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGER).sort());
});

test('the scene events carry the keys their filters and variables read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  // Somebody leaves, a new alert arrives.
  world.ecobee.mutate(([thermostat]) => {
    for (const sensor of thermostat.remoteSensors) {
      for (const capability of sensor.capability) {
        if (capability.type === 'occupancy') capability.value = 'false';
      }
    }
    thermostat.alerts.push({ ...thermostat.alerts[0], acknowledgeRef: 'new-ref', text: 'Hot' });
  });
  await world.hub.refresh({ force: true });
  world.ecobee.mutate(([thermostat]) => {
    thermostat.remoteSensors[1].capability[1].value = 'true';
  });
  await world.hub.refresh({ force: true });

  const events = world.gladys.fake.sceneEvents;
  assert.deepEqual(events.map((event) => event.key).sort(), Object.values(TRIGGER).sort());
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((candidate) => candidate.key === trigger.key);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
    assert.equal(event.data.device, thermostatId(world, '411900000101'));
  }
});

test('the scene action outputs are the declared ones', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const thermostat = thermostatId(world, '411900000101');
  const fields = {
    resume_program: { thermostat },
    set_comfort: { thermostat, comfort: 'away', duration: 'default' },
    start_vacation: { thermostat, days: 3 },
    cancel_vacation: { thermostat },
  };
  for (const action of manifest.scene_actions) {
    const ack = await world.gladys.fake.sceneAction(action.key, fields[action.key]);
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data?.outputs ?? {}).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
  }
});

test('config_schema keys, defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
  const options = (key) =>
    manifest.config_schema.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('language'), LANGUAGES);
  assert.deepEqual(options('temperature_unit'), TEMPERATURE_UNITS);
  assert.deepEqual(options('hold_duration'), HOLD_DURATIONS);
  assert.equal(
    manifest.config_schema.find((f) => f.key === 'refresh_minutes').min,
    MIN_REFRESH_MINUTES,
  );
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
  const comfort = manifest.scene_actions.find((action) => action.key === 'set_comfort');
  assert.deepEqual(
    comfort.fields.find((field) => field.key === 'duration').options.map((o) => o.value),
    COMFORT_DURATIONS,
  );
});

test('the password and the API key are secret fields', () => {
  const type = (key) => manifest.config_schema.find((f) => f.key === key).type;
  assert.equal(type('password'), 'secret');
  assert.equal(type('api_key'), 'secret');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, and no default they would not apply', () => {
  // Gladys#3154/#3155: a secret in an action form cannot be filled, and an
  // action applies no default while enforcing `required`.
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret', `${action.key}.${field.key}`);
      assert.equal(field.default, undefined, `${action.key}.${field.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});
