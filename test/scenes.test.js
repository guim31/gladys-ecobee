// -----------------------------------------------------------------------------
// The scene actions: what they send to ecobee, and their refusals.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES } from './helpers/fakeEcobee.js';
import { ACCOUNT_CONFIG, createWorld, thermostatId } from './helpers/world.js';

const run = (world, key, fields) => world.gladys.fake.sceneAction(key, fields);
const sent = (world) => world.ecobee.updates.at(-1);

test('resume_program cancels every hold', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await run(world, 'resume_program', {
    thermostat: thermostatId(world, '411900000101'),
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(sent(world).functions, [{ type: 'resumeProgram', params: { resumeAll: true } }]);
});

test('set_comfort: the chosen duration, or the one of the configuration', async (t) => {
  const world = await createWorld({ config: { ...ACCOUNT_CONFIG, hold_duration: 'indefinite' } });
  t.after(() => world.app.stop());
  const thermostat = thermostatId(world, '411900000101');
  await run(world, 'set_comfort', { thermostat, comfort: 'away', duration: 'default' });
  assert.deepEqual(sent(world).functions[0].params, {
    holdType: 'indefinite',
    holdClimateRef: 'away',
  });
  await run(world, 'set_comfort', { thermostat, comfort: 'sleep', duration: 'hours_2' });
  assert.deepEqual(sent(world).functions[0].params, {
    holdType: 'holdHours',
    holdHours: 2,
    holdClimateRef: 'sleep',
  });
  // A remote sensor stands for its thermostat.
  const sensor = world.gladys.externalIds('sensor', '411900000101-QX4T').device;
  await run(world, 'set_comfort', {
    thermostat: sensor,
    comfort: 'home',
    duration: 'next_transition',
  });
  assert.equal(sent(world).selection.selectionMatch, '411900000101');
});

test('set_comfort refuses a comfort setting the thermostat does not have', async (t) => {
  const world = await createWorld({ ecobee: { fixture: FIXTURES['lite-and-cool-only'] } });
  t.after(() => world.app.stop());
  world.ecobee.mutate((list) => {
    list[1].runtime.connected = true;
  });
  await world.hub.refresh({ force: true });
  const ack = await run(world, 'set_comfort', {
    thermostat: thermostatId(world, '311500000404'),
    comfort: 'sleep',
    duration: 'default',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /comfort setting does not exist/);
});

test('start_vacation: from the thermostat clock, the Away setpoints by default', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await run(world, 'start_vacation', {
    thermostat: thermostatId(world, '411900000101'),
    days: 3,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { end_date: '2026-10-17' });
  assert.deepEqual(sent(world).functions, [
    {
      type: 'createVacation',
      params: {
        name: 'Gladys 2026-10-14',
        heatHoldTemp: 620,
        coolHoldTemp: 820,
        startDate: '2026-10-14',
        startTime: '07:43:00',
        endDate: '2026-10-17',
        endTime: '07:43:00',
        fan: 'auto',
        fanMinOnTime: '0',
      },
    },
  ]);
});

test('start_vacation with setpoints in °C, the cool one kept above the heat one', async (t) => {
  const world = await createWorld({ ecobee: { fixture: FIXTURES['premium-celsius'] } });
  t.after(() => world.app.stop());
  await run(world, 'start_vacation', {
    thermostat: thermostatId(world, '521700000202'),
    days: 10,
    heat_setpoint: 15,
    cool_setpoint: 14,
  });
  const { params } = sent(world).functions[0];
  assert.equal(params.heatHoldTemp, 590);
  assert.equal(params.coolHoldTemp, 630, 'heat + heatCoolMinDelta (4 °F)');
});

test('cancel_vacation deletes the vacations, and says when there is none', async (t) => {
  const world = await createWorld({ ecobee: { fixture: FIXTURES['premium-celsius'] } });
  t.after(() => world.app.stop());
  const thermostat = thermostatId(world, '521700000202');
  await run(world, 'cancel_vacation', { thermostat });
  assert.deepEqual(sent(world).functions, [
    { type: 'deleteVacation', params: { name: 'Ski trip' } },
  ]);
  await world.hub.refresh({ force: true });
  const none = await run(world, 'cancel_vacation', { thermostat });
  assert.equal(none.success, false);
  assert.match(none.error, /No vacation/);
});

test('the errors are in the language of the configuration', async (t) => {
  const world = await createWorld({ config: { ...ACCOUNT_CONFIG, language: 'es' } });
  t.after(() => world.app.stop());
  const ack = await run(world, 'resume_program', {
    thermostat: 'ext:test-integration:thermostat:0',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /^Este termostato ecobee es desconocido/);
});
