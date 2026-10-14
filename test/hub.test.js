// -----------------------------------------------------------------------------
// The hub on the SDK's fake Gladys and the fake ecobee: its own refresh timer
// (without the core's onPoll), the states it publishes, the commands, the
// sign-in states shown in the Configuration screen, the scene triggers, and
// quiet logs that never carry a secret.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT } from '../src/i18n.js';
import { ACCOUNT, FIXTURES, createFakeEcobee } from './helpers/fakeEcobee.js';
import { ACCOUNT_CONFIG, createWorld, thermostatId } from './helpers/world.js';

const MAIN = '411900000101';
const feature = (world, key, id = MAIN) => `${thermostatId(world, id)}:${key}`;
const deviceFor = (world, id = MAIN) =>
  world.gladys.fake.devices.find((device) => device.external_id === thermostatId(world, id));
const featureOf = (world, key, id = MAIN) =>
  deviceFor(world, id).features.find(
    (candidate) => candidate.external_id === feature(world, key, id),
  );
const setValue = (world, key, value, id = MAIN) =>
  world.gladys.fake.setValue(deviceFor(world, id), featureOf(world, key, id), value);
const lastUpdate = (world) => world.ecobee.updates.at(-1);

/** Let the timers' async callbacks run to the end. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** Capture every log line (console), at the debug level. */
function captureLogs(t) {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return {
    lines,
    at: (level) => lines.filter((line) => line.includes(`[${level}]`)),
    clear: () => lines.splice(0, lines.length),
  };
}

test('the hub refreshes by itself every period, without any onPoll from the core', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T12:00:00Z') });
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  assert.equal(world.ecobee.reads, 1);
  assert.equal(world.gladys.fake.lastState(feature(world, 'temperature')), 66.8);

  world.ecobee.mutate(([thermostat]) => {
    thermostat.runtime.actualTemperature = 702;
  });
  t.mock.timers.tick(2 * 60 * 1000);
  await settle();
  assert.equal(world.ecobee.reads, 1, 'not before the period (3 minutes)');
  t.mock.timers.tick(60 * 1000);
  await settle();
  assert.equal(world.ecobee.reads, 2);
  assert.equal(world.gladys.fake.lastState(feature(world, 'temperature')), 70.2);
  // The core never polled: no DEVICE_POLL message was ever sent.
  assert.ok(world.gladys.fake.wsMessages.every((message) => !/poll/i.test(message.type)));

  t.mock.timers.tick(3 * 60 * 1000);
  await settle();
  assert.equal(world.ecobee.reads, 3, 'and again');
});

test('the core onPoll is a fallback: it reads only when the timer has not for a period', async (t) => {
  let clock = 0;
  const world = await createWorld({ now: () => clock });
  t.after(() => world.app.stop());
  assert.equal(world.ecobee.reads, 1);
  clock += 60 * 1000;
  assert.equal((await world.gladys.fake.poll(deviceFor(world))).success, true);
  assert.equal(world.ecobee.reads, 1, 'read a minute ago: skipped');
  clock += 2 * 60 * 1000;
  await world.gladys.fake.poll(deviceFor(world));
  assert.equal(world.ecobee.reads, 2, 'a whole period without reading: the fallback reads');
});

test('the refresh interval follows the configuration, never below 3 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T12:00:00Z') });
  const world = await createWorld({
    timers: true,
    config: { ...ACCOUNT_CONFIG, refresh_minutes: 1 },
  });
  t.after(() => world.app.stop());
  t.mock.timers.tick(2 * 60 * 1000 + 59 * 1000);
  await settle();
  assert.equal(world.ecobee.reads, 1);
  await world.gladys.fake.configUpdated({ ...ACCOUNT_CONFIG, refresh_minutes: 10 });
  const reads = world.ecobee.reads;
  t.mock.timers.tick(9 * 60 * 1000);
  await settle();
  assert.equal(world.ecobee.reads, reads);
  t.mock.timers.tick(60 * 1000);
  await settle();
  assert.equal(world.ecobee.reads, reads + 1);
});

test('only the changes are published, with a heartbeat, for the devices added in Gladys', async (t) => {
  const world = await createWorld({ createAll: false });
  t.after(() => world.app.stop());
  assert.equal(world.gladys.fake.states.length, 0, 'no device added: nothing published');

  const calls = [];
  const original = world.gladys.publishChangedStates.bind(world.gladys);
  t.mock.method(world.gladys, 'publishChangedStates', (states, options) => {
    calls.push(options);
    return original(states, options);
  });

  // Adding the thermostat sends its states at once, from the last reading.
  await world.gladys.fake.deviceCreated(world.gladys.fake.discoveredDevices[0]);
  assert.equal(world.ecobee.reads, 1, 'no extra request to ecobee');
  assert.ok(world.gladys.fake.states.length >= 12);
  assert.ok(
    world.gladys.fake.states.every((state) =>
      state.device_feature_external_id.startsWith(thermostatId(world, MAIN)),
    ),
  );
  assert.ok(world.gladys.fake.widgetRefreshes.length >= 1, 'the widget is nudged');

  const count = world.gladys.fake.states.length;
  await world.hub.refresh({ force: true });
  assert.equal(world.gladys.fake.states.length, count, 'nothing changed: nothing sent');
  world.ecobee.mutate(([thermostat]) => {
    thermostat.runtime.actualHumidity = 44;
  });
  await world.hub.refresh({ force: true });
  assert.deepEqual(world.gladys.fake.states.slice(count), [
    { device_feature_external_id: feature(world, 'humidity'), state: 44 },
  ]);
  assert.ok(
    calls.every((options) => options.heartbeat === 6 * 3600 * 1000),
    'heartbeat every 6 hours',
  );
});

test('an unchanged value is sent again after the heartbeat (6 h, under the 12 h rule)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T12:00:00Z') });
  const world = await createWorld();
  t.after(() => world.app.stop());
  const count = world.gladys.fake.states.length;
  await world.hub.refresh({ force: true });
  assert.equal(world.gladys.fake.states.length, count);
  t.mock.timers.tick(6 * 3600 * 1000);
  await world.hub.refresh({ force: true });
  assert.ok(world.gladys.fake.states.length >= count * 2 - 1, 'every state sent again');
});

test('a normal cycle writes nothing at the info level, and no secret ever reaches the logs', async (t) => {
  const logs = captureLogs(t);
  const config = { ...ACCOUNT_CONFIG, api_key: '' };
  const world = await createWorld({ config });
  t.after(() => world.app.stop());
  assert.ok(
    logs.at('INFO').some((line) => line.includes('Signed in to ecobee')),
    'the sign-in is said',
  );

  logs.clear();
  for (let i = 0; i < 3; i += 1) {
    world.ecobee.mutate(([thermostat]) => {
      thermostat.runtime.actualTemperature += 3;
    });
    await world.hub.refresh({ force: true });
  }
  await world.gladys.fake.poll(deviceFor(world));
  assert.deepEqual(logs.at('INFO'), [], 'quiet at info');
  assert.ok(logs.at('DEBUG').length > 0, 'LOG_LEVEL=debug shows the cycles');

  // ecobee down, three times: one warning, then one line when it is back.
  world.ecobee.down = true;
  for (let i = 0; i < 3; i += 1) await world.hub.refresh({ force: true });
  world.ecobee.down = false;
  await world.hub.refresh({ force: true });
  assert.equal(logs.at('WARN').length, 1);
  assert.match(logs.at('WARN')[0], /api\.ecobee\.com unreachable/);
  assert.deepEqual(logs.at('INFO'), [
    logs.at('INFO').find((line) => line.includes('ecobee answers again')),
  ]);

  // A user command is one info line.
  logs.clear();
  await setValue(world, 'heat_setpoint', 71);
  assert.equal(logs.at('INFO').length, 1);

  const secrets = [
    ACCOUNT.password,
    ...world.ecobee.accessTokens.keys(),
    ...world.ecobee.refreshTokens,
    'CODE-1',
    'auth0=sess',
  ];
  for (const line of logs.lines) {
    for (const secret of secrets) {
      assert.ok(!line.includes(secret), `a log line carries a secret: ${line}`);
    }
  }
});

test('the API key never reaches the logs either', async (t) => {
  const logs = captureLogs(t);
  const ecobee = createFakeEcobee();
  const world = await createWorld({
    ecobee,
    config: { api_key: 'DEVKEY0123456789', language: 'en' },
  });
  t.after(() => world.app.stop());
  await world.gladys.fake.action('request_pin', {});
  ecobee.authorizePins();
  await world.hub.checkPin();
  await world.gladys.fake.configUpdated({ api_key: 'WRONG-KEY-42', language: 'en' });
  await world.gladys.fake.action('request_pin', {});
  assert.ok(logs.lines.length > 3);
  for (const line of logs.lines) {
    assert.ok(!line.includes('DEVKEY0123456789') && !line.includes('WRONG-KEY-42'), line);
    assert.ok(!line.includes('PINCODE'), line);
  }
});

test('setpoints: a hold until the next period, in °F, and in °C on a Celsius thermostat', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await setValue(world, 'heat_setpoint', 72);
  assert.equal(ack.success, true);
  assert.deepEqual(lastUpdate(world), {
    selection: { selectionType: 'thermostats', selectionMatch: MAIN },
    functions: [
      {
        type: 'setHold',
        params: { holdType: 'nextTransition', heatHoldTemp: 720, coolHoldTemp: 720 },
      },
    ],
  });

  const celsius = await createWorld({
    ecobee: { fixture: FIXTURES['premium-celsius'] },
    config: { ...ACCOUNT_CONFIG, hold_duration: 'hours_2' },
  });
  t.after(() => celsius.app.stop());
  assert.equal(featureOf(celsius, 'heat_setpoint', '521700000202').unit, 'celsius');
  assert.equal(featureOf(celsius, 'heat_setpoint', '521700000202').step, 0.5);
  await setValue(celsius, 'heat_setpoint', 21.5, '521700000202');
  assert.deepEqual(lastUpdate(celsius).functions[0].params, {
    holdType: 'holdHours',
    holdHours: 2,
    heatHoldTemp: 707,
    coolHoldTemp: 770,
  });
});

test('a command is followed by one reading, and its states sent even if Gladys stored them', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T12:00:00Z') });
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await setValue(world, 'heat_setpoint', 72);
  await setValue(world, 'heat_setpoint', 73);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(world.ecobee.reads, 2, 'one reading for the two commands');
  assert.equal(world.gladys.fake.lastState(feature(world, 'heat_setpoint')), 73);
  assert.equal(world.gladys.fake.lastState(feature(world, 'hold')), 'Hold until 6:00 PM');
});

test('mode, auxiliary heat, fan and preset commands', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await setValue(world, 'mode', 3);
  assert.deepEqual(lastUpdate(world).thermostat, { settings: { hvacMode: 'auto' } });
  await setValue(world, 'aux_heat', 1);
  assert.deepEqual(lastUpdate(world).thermostat, { settings: { hvacMode: 'auxHeatOnly' } });
  await world.hub.refresh({ force: true });
  await setValue(world, 'aux_heat', 0);
  assert.deepEqual(lastUpdate(world).thermostat, { settings: { hvacMode: 'heat' } });

  // The fan hold carries the current setpoints, or ecobee ignores it.
  await setValue(world, 'fan', 1);
  assert.deepEqual(lastUpdate(world).functions[0].params, {
    holdType: 'nextTransition',
    fan: 'on',
    heatHoldTemp: 700,
    coolHoldTemp: 700,
  });

  await setValue(world, 'preset', 2);
  assert.deepEqual(lastUpdate(world).functions, [
    { type: 'setHold', params: { holdType: 'nextTransition', holdClimateRef: 'away' } },
  ]);
  await setValue(world, 'preset', 0);
  assert.deepEqual(lastUpdate(world).functions, [
    { type: 'resumeProgram', params: { resumeAll: true } },
  ]);
});

test('commands a thermostat cannot do, or cannot receive, are refused with a message', async (t) => {
  const world = await createWorld({ ecobee: { fixture: FIXTURES['lite-and-cool-only'] } });
  t.after(() => world.app.stop());
  const before = world.ecobee.updates.length;
  const cool = await setValue(world, 'mode', 2, '311500000303');
  assert.equal(cool.success, false);
  assert.match(cool.error, /does not drive this kind of equipment/);
  const offline = await setValue(world, 'cool_setpoint', 75, '311500000404');
  assert.equal(offline.success, false);
  assert.match(offline.error, /offline/);
  assert.equal(world.ecobee.updates.length, before, 'nothing sent');
});

test('the resume of a thermostat on vacation cancels the vacation too', async (t) => {
  const ecobee = createFakeEcobee({ fixture: FIXTURES['lite-and-cool-only'] });
  ecobee.mutate((list) => {
    list[1].runtime.connected = true;
  });
  const world = await createWorld({ ecobee });
  t.after(() => world.app.stop());
  await setValue(world, 'preset', 0, '311500000404');
  assert.deepEqual(lastUpdate(world).functions, [
    { type: 'deleteVacation', params: { name: 'Summer cabin' } },
    { type: 'resumeProgram', params: { resumeAll: true } },
  ]);
});

test('not configured: a status, no request to ecobee', async (t) => {
  const world = await createWorld({ config: {} });
  t.after(() => world.app.stop());
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: TEXT.notConfigured,
  });
  assert.equal(world.ecobee.requests.length, 0);
});

test('a refused password: a status, and never retried by itself (account lockout)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T12:00:00Z') });
  const world = await createWorld({
    timers: true,
    config: { ...ACCOUNT_CONFIG, password: 'wrong' },
  });
  t.after(() => world.app.stop());
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: TEXT.credentialsRefused,
  });
  const requests = world.ecobee.requests.length;
  t.mock.timers.tick(60 * 60 * 1000);
  await settle();
  assert.equal(world.ecobee.requests.length, requests);
  // Saving the right password signs in.
  await world.gladys.fake.configUpdated(ACCOUNT_CONFIG);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
});

test('ecobee unreachable at start: a status, then retried on the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T12:00:00Z') });
  const ecobee = createFakeEcobee();
  ecobee.down = true;
  const world = await createWorld({ ecobee, timers: true });
  t.after(() => world.app.stop());
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: TEXT.unreachable,
  });
  ecobee.down = false;
  t.mock.timers.tick(3 * 60 * 1000);
  await settle();
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  assert.equal(world.gladys.fake.discoveredDevices.length, 3);
});

test('two-step verification: the status asks for the code, the action signs in', async (t) => {
  const world = await createWorld({ ecobee: { mfa: 'sms' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: false, message: TEXT.mfaSms });
  const missing = await world.gladys.fake.action('mfa_code', { code: 'abc' });
  assert.deepEqual(missing.data.message, TEXT.mfaCodeMissing);
  const wrong = await world.gladys.fake.action('mfa_code', { code: '000000' });
  assert.deepEqual(wrong.data.message, TEXT.mfaCodeRefused);
  const right = await world.gladys.fake.action('mfa_code', { code: '123 456' });
  assert.match(right.data.message.en, /Signed in to ecobee: 1 thermostat/);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
});

test('the configuration actions: sign in, PIN, sign out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T12:00:00Z') });
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  const signIn = await world.gladys.fake.action('sign_in', {});
  assert.match(signIn.data.message.fr, /Connecté à ecobee : 1 thermostat/);
  assert.deepEqual(
    (await world.gladys.fake.action('request_pin', {})).data.message,
    TEXT.apiKeyOnly,
  );
  assert.deepEqual((await world.gladys.fake.action('sign_out', {})).data.message, TEXT.signedOut);
  assert.equal(world.store.session, null);

  // A developer API key: PIN, then the integration finishes once authorized.
  await world.gladys.fake.configUpdated({ api_key: 'DEVKEY0123456789', language: 'en' });
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: TEXT.pinNeeded,
  });
  const pin = await world.gladys.fake.action('request_pin', {});
  assert.match(pin.data.message.en, /Your PIN is ab12/);
  world.ecobee.authorizePins();
  t.mock.timers.tick(30_000);
  await settle();
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  assert.equal(world.store.session.method, 'api_key');
});

test('a restart reuses the stored session: no sign-in, no password sent', async (t) => {
  const first = await createWorld();
  first.app.stop();
  const ecobee = first.ecobee;
  const before = ecobee.logins;
  const world = await createWorld({ ecobee, store: first.store });
  t.after(() => world.app.stop());
  assert.equal(ecobee.logins, before);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
});

test('scene triggers: somebody detected / nobody left, and new alerts, from the second reading', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.gladys.fake.sceneEvents, [], 'the first reading only seeds');

  world.ecobee.mutate(([thermostat]) => {
    thermostat.remoteSensors[1].capability[1].value = 'false';
  });
  await world.hub.refresh({ force: true });
  world.ecobee.mutate(([thermostat]) => {
    thermostat.remoteSensors[2].capability[1].value = 'true';
  });
  await world.hub.refresh({ force: true });
  await world.hub.refresh({ force: true });
  world.ecobee.mutate(([thermostat]) => {
    thermostat.alerts.push({
      acknowledgeRef: 'ref-2',
      text: 'Low temperature alert: 44°F.',
      alertType: 'alert',
      notificationType: 'lowTemp',
    });
  });
  await world.hub.refresh({ force: true });

  const device = thermostatId(world, MAIN);
  assert.deepEqual(world.gladys.fake.sceneEvents, [
    { key: 'home_vacant', data: { device, thermostat: 'Main Floor' } },
    { key: 'home_occupied', data: { device, thermostat: 'Main Floor', sensors: 'Office' } },
    {
      key: 'alert',
      data: {
        device,
        thermostat: 'Main Floor',
        text: 'Low temperature alert: 44°F.',
        alert_type: 'lowTemp',
      },
    },
  ]);
});

test('a thermostat offline from ecobee: one warning, one line when it is back', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  logs.clear();
  for (const connected of [false, false, false, true]) {
    world.ecobee.mutate(([thermostat]) => {
      thermostat.runtime.connected = connected;
    });
    await world.hub.refresh({ force: true });
  }
  assert.equal(logs.at('WARN').length, 1);
  assert.match(logs.at('WARN')[0], /Main Floor is offline/);
  assert.equal(logs.at('INFO').length, 1);
  assert.match(logs.at('INFO')[0], /Main Floor is back online/);
});

test('Gladys reconnects: the devices and every state are sent again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const discoveries = world.gladys.fake.requests.filter(
    (request) => request.path === '/discovered_device',
  ).length;
  const states = world.gladys.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  assert.equal(
    world.gladys.fake.requests.filter((request) => request.path === '/discovered_device').length,
    discoveries + 1,
  );
  assert.equal(world.gladys.fake.states.length, states * 2);
});
