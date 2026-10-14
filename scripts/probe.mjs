#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe the real ecobee services with the integration's own client, READ-ONLY.
//
//   node scripts/probe.mjs
//       A made-up account and a made-up token: ecobee must refuse both
//       cleanly (credentials refused, API status 1/16). Proves the sign-in
//       pages and the API still answer the way the client expects.
//
//   ECOBEE_EMAIL=... ECOBEE_PASSWORD=... [ECOBEE_MFA_CODE=123456] node scripts/probe.mjs
//       A real account: signs in, reads the thermostats once, prints what the
//       integration would build (models, capabilities, units, counts). Sends
//       no command. With two-step verification, run it once to receive the
//       SMS (or use the authenticator app), then again with ECOBEE_MFA_CODE
//       within a few minutes.
//
// Prints no password, token, code, identifier, name or address.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { normalizeConfig } from '../src/config.js';
import { readThermostats } from '../src/ecobee/api.js';
import { ApiError, AuthError, MfaRequiredError } from '../src/ecobee/errors.js';
import { parseThermostat, homeOccupied } from '../src/ecobee/model.js';
import { EcobeeSession } from '../src/ecobee/session.js';
import { MemoryStore } from '../src/store.js';

const say = (line) => process.stdout.write(`${line}\n`);
const outcome = (err) =>
  err instanceof AuthError || err instanceof MfaRequiredError || err instanceof ApiError
    ? `${err.name}${err.kind ? ` (${err.kind})` : ''}${err.code !== undefined ? ` (code ${err.code})` : ''}: ${err.message}`
    : `${err.name}: ${err.message}`;

async function fakeAccount() {
  let ok = true;
  const email = `gladys-probe-${randomBytes(4).toString('hex')}@example.com`;
  const session = new EcobeeSession({ fetch, store: new MemoryStore() });
  await session.configure(normalizeConfig({ email, password: randomBytes(12).toString('hex') }));
  say('1. Sign-in with a made-up account (expected: credentials refused)');
  try {
    await session.signIn();
    say('   UNEXPECTED: signed in');
    ok = false;
  } catch (err) {
    say(`   ${outcome(err)}`);
    ok &&= err instanceof AuthError && err.kind === 'credentials';
  }

  say('2. Thermostat API with a made-up token (expected: status 1 or 16)');
  try {
    await readThermostats(fetch, randomBytes(16).toString('hex'));
    say('   UNEXPECTED: answered');
    ok = false;
  } catch (err) {
    say(`   ${outcome(err)}`);
    ok &&= err instanceof ApiError && err.tokenInvalid;
  }
  return ok;
}

async function realAccount() {
  const session = new EcobeeSession({ fetch, store: new MemoryStore() });
  await session.configure(
    normalizeConfig({ email: process.env.ECOBEE_EMAIL, password: process.env.ECOBEE_PASSWORD }),
  );
  say('1. Sign-in with the account of ECOBEE_EMAIL');
  try {
    await session.signIn();
    say('   signed in, no verification code asked');
  } catch (err) {
    if (!(err instanceof MfaRequiredError)) {
      say(`   ${outcome(err)}`);
      return false;
    }
    say(`   verification code asked (${err.challenge.type})`);
    if (!process.env.ECOBEE_MFA_CODE) {
      say('   run again with ECOBEE_MFA_CODE=<the code>');
      return false;
    }
    await session.submitMfa(process.env.ECOBEE_MFA_CODE);
    say('   signed in with the code');
  }

  say('2. Reading the thermostats (one GET /1/thermostat)');
  const list = await session.withToken((token) => readThermostats(fetch, token));
  say(`   ${list.length} thermostat(s)`);
  for (const [index, raw] of list.entries()) {
    const snapshot = parseThermostat(raw);
    say(
      `   #${index + 1} ${snapshot.modelNumber} (${snapshot.modelName}), ` +
        `${snapshot.connected ? 'online' : 'OFFLINE'}, ${snapshot.useCelsius ? '°C' : '°F'}, ` +
        `mode ${snapshot.hvacMode}, heat ${snapshot.canHeat}, cool ${snapshot.canCool}, ` +
        `heat pump ${snapshot.hasHeatPump}, override ${snapshot.override.kind}, ` +
        `${snapshot.sensors.length} remote sensor(s), occupancy ${homeOccupied(snapshot)}, ` +
        `${snapshot.climates.length} comfort setting(s), ${snapshot.alerts.length} alert(s)`,
    );
    const unknownTypes = [...new Set(snapshot.sensors.map((sensor) => sensor.type))];
    say(`      sensor types: ${unknownTypes.join(', ') || 'none'}`);
  }
  // Only the session's token renewal, nothing written on ecobee.
  return true;
}

const real = Boolean(process.env.ECOBEE_EMAIL && process.env.ECOBEE_PASSWORD);
say(`ecobee probe (${real ? 'real account, read-only' : 'made-up account'})`);
try {
  const ok = real ? await realAccount() : await fakeAccount();
  say(ok ? 'OK' : 'FAILED');
  process.exit(ok ? 0 : 1);
} catch (err) {
  say(`FAILED: ${outcome(err)}`);
  process.exit(1);
}
