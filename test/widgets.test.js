// -----------------------------------------------------------------------------
// The thermostat widget: its content fits the core's budget and vocabulary
// (validateWidgetContent), its tiles name features that exist, and its
// buttons send the right ecobee commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FIXTURES } from './helpers/fakeEcobee.js';
import { ACCOUNT_CONFIG, createWorld, thermostatId } from './helpers/world.js';

const get = async (world, thermostat, language = 'en') => {
  const ack = await world.gladys.fake.widgetGet('thermostat', {
    settings: { thermostat },
    language,
  });
  return { ...ack, data: ack.data?.content };
};
const tap = (world, thermostat, actionKey, values) =>
  world.gladys.fake.widgetAction('thermostat', actionKey, {}, { settings: { thermostat }, values });

const scenarios = [
  ['heat-pump-fahrenheit', '411900000101'],
  ['premium-celsius', '521700000202'],
  ['lite-and-cool-only', '311500000303'],
  ['lite-and-cool-only', '311500000404'],
  ['home-assistant', '8675309'],
];

for (const [fixture, identifier] of scenarios) {
  test(`the widget content fits the core vocabulary and budget (${fixture}, ${identifier})`, async (t) => {
    const world = await createWorld({ ecobee: { fixture: FIXTURES[fixture] } });
    t.after(() => world.app.stop());
    const features = new Set(
      world.gladys.fake.discoveredDevices.flatMap((device) =>
        device.features.map((f) => f.external_id),
      ),
    );
    for (const language of ['en', 'fr', 'de', 'es']) {
      const ack = await get(world, thermostatId(world, identifier), language);
      assert.equal(ack.success, true, ack.error);
      const content = ack.data;
      assert.deepEqual(validateWidgetContent(content), [], `${language}: rendered as sent`);
      // The live tiles point to features of the published devices.
      for (const component of content.components.filter((c) => c.device_feature)) {
        assert.ok(features.has(component.device_feature), `${component.device_feature} exists`);
      }
      assert.ok(content.components.filter((c) => c.type === 'button').length <= 4);
    }
  });
}

test('the widget without a thermostat, before the first reading, and signed out', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const empty = await world.gladys.fake.widgetGet('thermostat', { settings: {}, language: 'fr' });
  assert.equal(
    empty.data.content.components[0].text,
    'Choisissez un thermostat dans les réglages du widget.',
  );
  const unknown = await get(world, 'ext:test-integration:thermostat:000');
  assert.match(unknown.data.components[0].text, /unknown/);
  await world.gladys.fake.action('sign_out', {});
  const signedOut = await get(world, thermostatId(world, '411900000101'));
  assert.match(signedOut.data.components[0].text, /Not signed in/);
});

test('heat mode: the heat setpoint tile, lower and raise by one degree F', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const id = thermostatId(world, '411900000101');
  const { data } = await get(world, id);
  const tiles = data.components
    .filter((c) => c.type === 'value')
    .map((c) => c.device_feature.split(':').pop());
  assert.deepEqual(tiles, ['temperature', 'heat_setpoint', 'humidity']);
  const status = data.components
    .find((c) => c.type === 'status')
    .items.map((item) => [item.label, item.value]);
  assert.deepEqual(status, [
    ['Mode', 'Heat'],
    ['State', 'Heating'],
    ['Comfort', 'Home'],
    ['Hold', 'Hold until 8:30 AM'],
  ]);

  const raised = await tap(world, id, 'raise');
  assert.equal(raised.success, true, raised.error);
  assert.deepEqual(raised.data.message, {
    en: 'Setpoint 71 °F',
    fr: 'Consigne 71 °F',
    de: 'Sollwert 71 °F',
    es: 'Consigna 71 °F',
  });
  // A second tap starts from the new setpoint, before any reading.
  await tap(world, id, 'raise');
  assert.deepEqual(world.ecobee.updates.at(-1).functions[0].params, {
    holdType: 'nextTransition',
    heatHoldTemp: 720,
    coolHoldTemp: 720,
  });
  await tap(world, id, 'lower');
  assert.equal(world.ecobee.updates.at(-1).functions[0].params.heatHoldTemp, 710);
});

test('auto mode in °C: both setpoints move by half a degree, the gap kept', async (t) => {
  const world = await createWorld({ ecobee: { fixture: FIXTURES['premium-celsius'] } });
  t.after(() => world.app.stop());
  const id = thermostatId(world, '521700000202');
  const { data } = await get(world, id, 'fr');
  const tiles = data.components.filter((c) => c.type === 'value').map((c) => c.label);
  assert.deepEqual(tiles, ['Température', 'Chauffer à', 'Refroidir à']);
  const humidity = data.components
    .find((c) => c.type === 'status')
    .items.find((item) => item.label === 'Humidité');
  assert.equal(humidity.value, '38 %', 'the humidity moves to the status list');
  const ack = await tap(world, id, 'raise');
  assert.equal(ack.success, true, ack.error);
  // 644 (18 °C) + 0.5 °C = 18.5 °C = 653; 770 (25 °C) + 0.5 °C = 779.
  assert.deepEqual(world.ecobee.updates.at(-1).functions[0].params, {
    holdType: 'nextTransition',
    heatHoldTemp: 653,
    coolHoldTemp: 779,
  });
});

test('off: no dial, and a dial action is refused', async (t) => {
  const world = await createWorld({ ecobee: { fixture: FIXTURES['lite-and-cool-only'] } });
  t.after(() => world.app.stop());
  const id = thermostatId(world, '311500000303');
  const { data } = await get(world, id);
  const buttons = data.components.filter((c) => c.type === 'button').map((c) => c.action.key);
  assert.deepEqual(buttons, ['mode', 'comfort']);
  const ack = await tap(world, id, 'raise');
  assert.equal(ack.success, false);
  assert.match(ack.error, /off: choose a mode first/);
});

test('the mode and comfort forms offer what the thermostat has, and send it', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const id = thermostatId(world, '411900000101');
  const { data } = await get(world, id);
  const form = (key) => data.components.find((c) => c.action?.key === key).action.fields[0];
  assert.deepEqual(
    form('mode').options.map((o) => o.value),
    ['off', 'heat', 'cool', 'auto'],
  );
  assert.equal(form('mode').default, 'heat');
  assert.deepEqual(
    form('comfort').options.map((o) => o.value),
    ['schedule', 'home', 'away', 'sleep'],
  );
  assert.equal(form('comfort').default, 'schedule');

  await tap(world, id, 'mode', { mode: 'cool' });
  assert.deepEqual(world.ecobee.updates.at(-1).thermostat, { settings: { hvacMode: 'cool' } });
  await tap(world, id, 'comfort', { comfort: 'sleep' });
  assert.equal(world.ecobee.updates.at(-1).functions[0].params.holdClimateRef, 'sleep');
  await tap(world, id, 'comfort', { comfort: 'schedule' });
  assert.equal(world.ecobee.updates.at(-1).functions[0].type, 'resumeProgram');
  // An older core drops the form: no values, nothing guessed.
  const count = world.ecobee.updates.length;
  assert.equal((await tap(world, id, 'mode')).success, false);
  assert.equal(world.ecobee.updates.length, count);
});

test('the widget picks the thermostat of a remote sensor chosen in its settings', async (t) => {
  const world = await createWorld({ config: { ...ACCOUNT_CONFIG, language: 'de' } });
  t.after(() => world.app.stop());
  const sensor = world.gladys.externalIds('sensor', '411900000101-QX4T').device;
  const { data } = await get(world, sensor, 'de');
  assert.ok(
    data.components.some(
      (c) => c.device_feature === `${thermostatId(world, '411900000101')}:temperature`,
    ),
  );
});
