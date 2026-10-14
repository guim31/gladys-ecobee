// -----------------------------------------------------------------------------
// The normalization of the configuration Gladys sends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, authMethod, normalizeConfig, secretsOf } from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.equal(authMethod(normalizeConfig()), null);
});

test('types and choices are forced, the refresh interval kept within 3 to 60 minutes', () => {
  const config = normalizeConfig({
    email: '  owner@example.com ',
    refresh_minutes: '1',
    temperature_unit: 'kelvin',
    hold_duration: 'forever',
    language: 'it',
  });
  assert.equal(config.email, 'owner@example.com');
  assert.equal(config.refresh_minutes, 3);
  assert.equal(config.temperature_unit, 'thermostat');
  assert.equal(config.hold_duration, 'next_transition');
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ refresh_minutes: 600 }).refresh_minutes, 60);
  assert.equal(normalizeConfig({ refresh_minutes: 'abc' }).refresh_minutes, 3);
});

test('the sign-in method: the API key wins, else the email and the password', () => {
  assert.equal(authMethod(normalizeConfig({ email: 'a@b.c' })), null);
  assert.equal(authMethod(normalizeConfig({ email: 'a@b.c', password: 'x' })), 'account');
  assert.equal(
    authMethod(normalizeConfig({ email: 'a@b.c', password: 'x', api_key: 'K' })),
    'api_key',
  );
  assert.deepEqual(secretsOf(normalizeConfig({ email: 'a@b.c', password: 'x', api_key: 'K' })), [
    'x',
    'K',
  ]);
});
