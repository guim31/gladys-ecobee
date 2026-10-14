// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, the fake ecobee, a session
// store in memory, and the integration wired on top through registerHandlers.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { MemoryStore } from '../../src/store.js';
import { ACCOUNT, createFakeEcobee } from './fakeEcobee.js';

// The integration logs its lifecycle; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export const ACCOUNT_CONFIG = { email: ACCOUNT.email, password: ACCOUNT.password, language: 'en' };

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.ecobee] options of createFakeEcobee, or an instance
 * @param {object} [options.store]
 * @param {boolean} [options.connect]
 * @param {boolean} [options.createAll] add every discovered device in Gladys
 * @param {boolean} [options.timers]
 * @param {object} [options.timings]
 * @param {() => number} [options.now]
 * @param {object} [options.logger]
 */
export async function createWorld({
  config = ACCOUNT_CONFIG,
  ecobee = {},
  store = new MemoryStore(),
  connect = true,
  createAll = true,
  timers = false,
  timings,
  now,
  logger,
} = {}) {
  const fake = typeof ecobee.fetch === 'function' ? ecobee : createFakeEcobee(ecobee);
  const gladys = createFakeGladys({ config });
  const app = registerHandlers(gladys, { store, fetch: fake.fetch, timers, timings, now, logger });
  const world = { gladys, ecobee: fake, app, hub: app.hub, store };
  if (connect) {
    await gladys.connect();
    await app.ready;
    if (createAll) {
      await addAll(world);
    }
  }
  return world;
}

/** Add every discovered device in Gladys, as the user would. */
export async function addAll(world) {
  for (const device of world.gladys.fake.discoveredDevices) {
    await world.gladys.fake.deviceCreated(device);
  }
}

/** The device Gladys holds for an external id. */
export const deviceOf = (world, externalId) =>
  world.gladys.fake.devices.find((device) => device.external_id === externalId);

/** The thermostat device external id of an identifier. */
export const thermostatId = (world, identifier) =>
  world.gladys.externalIds('thermostat', identifier).device;
