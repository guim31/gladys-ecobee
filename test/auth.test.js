// -----------------------------------------------------------------------------
// The ecobee sign-in against the fake auth.ecobee.com: the Auth0 universal
// login steps of python-ecobee-api (identifier, password, verification code,
// PKCE exchange), the refresh token, the PIN of a developer API key, and the
// session kept in the store.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieJar, WEB_CLIENT, pkcePair, submitMfaCode, webLogin } from '../src/ecobee/auth.js';
import { AuthError, MfaRequiredError } from '../src/ecobee/errors.js';
import { EcobeeSession } from '../src/ecobee/session.js';
import { normalizeConfig } from '../src/config.js';
import { MemoryStore, SessionStore } from '../src/store.js';
import { ACCOUNT, createFakeEcobee } from './helpers/fakeEcobee.js';
import { createHash } from 'node:crypto';

const login = (ecobee, overrides = {}) =>
  webLogin({
    fetch: ecobee.fetch,
    username: ACCOUNT.email,
    password: ACCOUNT.password,
    ...overrides,
  });

test('PKCE: the challenge is the S256 of the verifier (RFC 7636)', () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
});

test('the cookie jar keeps the Auth0 cookies and drops the cleared ones', () => {
  const jar = new CookieJar();
  const headers = new Headers();
  headers.append('set-cookie', 'auth0=abc; Path=/; HttpOnly');
  headers.append('set-cookie', 'did=xyz; Max-Age=0');
  jar.store({ headers });
  assert.equal(jar.header(), 'auth0=abc');
});

test('account sign-in: authorize, identifier, password, then the code for the tokens', async () => {
  const ecobee = createFakeEcobee();
  const tokens = await login(ecobee);
  assert.equal(tokens.access_token, 'access-1');
  assert.equal(tokens.refresh_token, 'refresh-1');

  const authorize = new URL(ecobee.requests[0].url);
  assert.equal(authorize.pathname, '/authorize');
  assert.equal(authorize.searchParams.get('client_id'), WEB_CLIENT.clientId);
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorize.searchParams.get('scope'), /offline_access/);
  // The callback on www.ecobee.com is read, never fetched.
  assert.ok(ecobee.requests.every((request) => !request.url.startsWith('https://www.ecobee.com')));
  const exchange = ecobee.requests.find((request) => request.url.endsWith('/oauth/token'));
  const body = new URLSearchParams(exchange.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('redirect_uri'), WEB_CLIENT.redirectUri);
  assert.ok(body.get('code_verifier'));
});

test('a wrong password is refused as credentials, without any retry', async () => {
  const ecobee = createFakeEcobee();
  await assert.rejects(
    login(ecobee, { password: 'wrong' }),
    (err) => err instanceof AuthError && err.kind === 'credentials',
  );
  assert.equal(
    ecobee.requests.filter(
      (request) => request.url.includes('/u/login/password') && request.method === 'POST',
    ).length,
    1,
  );
});

test('an authenticator app code: the challenge, a wrong code, then the right one', async () => {
  const ecobee = createFakeEcobee({ mfa: 'otp' });
  const error = await login(ecobee).catch((err) => err);
  assert.ok(error instanceof MfaRequiredError);
  assert.equal(error.challenge.type, 'otp');
  assert.equal(error.challenge.state, 'MFA-1');
  await assert.rejects(
    submitMfaCode({ fetch: ecobee.fetch, challenge: error.challenge, code: '000000' }),
    (err) => err instanceof AuthError && err.kind === 'mfa_code',
  );
  const tokens = await submitMfaCode({
    fetch: ecobee.fetch,
    challenge: error.challenge,
    code: ' 123456 ',
  });
  assert.ok(tokens.refresh_token);
});

test('an SMS code: a wrong one is a 400, the right one signs in', async () => {
  const ecobee = createFakeEcobee({ mfa: 'sms' });
  const error = await login(ecobee).catch((err) => err);
  assert.equal(error.challenge.type, 'sms');
  await assert.rejects(
    submitMfaCode({ fetch: ecobee.fetch, challenge: error.challenge, code: '999999' }),
    (err) => err.kind === 'mfa_code',
  );
  assert.ok(
    (await submitMfaCode({ fetch: ecobee.fetch, challenge: error.challenge, code: '123456' }))
      .access_token,
  );
});

test('a push notification second factor and a terms prompt are refused clearly', async () => {
  await assert.rejects(
    login(createFakeEcobee({ mfa: 'push' })),
    (err) => err.kind === 'mfa_unsupported',
  );
  await assert.rejects(
    login(createFakeEcobee({ customPrompt: true })),
    (err) => err.kind === 'prompt',
  );
});

test('ecobee down: a network error that names the host, never the URL', async () => {
  const ecobee = createFakeEcobee();
  ecobee.down = true;
  const error = await login(ecobee).catch((err) => err);
  assert.equal(error.name, 'NetworkError');
  assert.equal(error.message, 'auth.ecobee.com unreachable (ECONNREFUSED)');
});

const accountConfig = normalizeConfig(ACCOUNT);

test('session: the tokens are stored with the account fingerprint, never the password', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-ecobee-'));
  const store = new SessionStore(dir);
  const ecobee = createFakeEcobee();
  const session = new EcobeeSession({ fetch: ecobee.fetch, store });
  assert.equal(await session.configure(accountConfig), false);
  await session.signIn();
  const raw = await readFile(join(dir, 'ecobee-session.json'), 'utf8');
  assert.ok(!raw.includes(ACCOUNT.password));
  assert.ok(!raw.includes(ACCOUNT.email));
  assert.equal(JSON.parse(raw).refresh_token, 'refresh-1');
  assert.equal((await stat(join(dir, 'ecobee-session.json'))).mode & 0o777, 0o600);

  // A restart finds the session; another account does not.
  const again = new EcobeeSession({ fetch: ecobee.fetch, store });
  assert.equal(await again.configure(accountConfig), true);
  const other = new EcobeeSession({ fetch: ecobee.fetch, store });
  assert.equal(
    await other.configure(normalizeConfig({ ...ACCOUNT, email: 'other@example.com' })),
    false,
  );
  assert.equal(await store.read(), null, 'the tokens of another account are deleted');
});

test('session: an expired access token is renewed, and the rotated refresh token kept', async () => {
  let clock = 1_000_000;
  const ecobee = createFakeEcobee();
  const store = new MemoryStore();
  const session = new EcobeeSession({ fetch: ecobee.fetch, store, now: () => clock });
  await session.configure(accountConfig);
  await session.signIn();
  assert.equal(await session.accessToken(), 'access-1');
  clock += 3600 * 1000;
  assert.equal(await session.accessToken(), 'access-2');
  assert.equal(store.session.refresh_token, 'refresh-2');
  // Concurrent callers share one renewal.
  clock += 3600 * 1000;
  const tokens = await Promise.all([
    session.accessToken(),
    session.accessToken(),
    session.accessToken(),
  ]);
  assert.deepEqual(new Set(tokens), new Set(['access-3']));
});

test('session: the API says the token expired (14), it is renewed and the call made again', async () => {
  const ecobee = createFakeEcobee();
  const session = new EcobeeSession({ fetch: ecobee.fetch, store: new MemoryStore() });
  await session.configure(accountConfig);
  await session.signIn();
  ecobee.expireAccessTokens();
  const { readThermostats } = await import('../src/ecobee/api.js');
  const list = await session.withToken((token) => readThermostats(ecobee.fetch, token));
  assert.equal(list.length, 1);
  assert.equal(session.tokens.access_token, 'access-2');
});

test('session: a revoked refresh token signs in again with the password', async () => {
  let clock = 0;
  const ecobee = createFakeEcobee();
  const session = new EcobeeSession({
    fetch: ecobee.fetch,
    store: new MemoryStore(),
    now: () => clock,
  });
  await session.configure(accountConfig);
  await session.signIn();
  ecobee.revokeRefreshTokens();
  clock += 2 * 3600 * 1000;
  assert.equal(await session.accessToken(), 'access-2');
  assert.equal(ecobee.logins, 2);
});

test('session: a revoked refresh token on an MFA account asks for the code', async () => {
  let clock = 0;
  const ecobee = createFakeEcobee({ mfa: 'otp' });
  const session = new EcobeeSession({
    fetch: ecobee.fetch,
    store: new MemoryStore(),
    now: () => clock,
  });
  await session.configure(accountConfig);
  await assert.rejects(session.signIn(), MfaRequiredError);
  assert.equal(session.mfaPending, 'otp');
  await session.submitMfa('123456');
  assert.equal(session.signedIn, true);
  ecobee.revokeRefreshTokens();
  clock += 2 * 3600 * 1000;
  await assert.rejects(session.accessToken(), MfaRequiredError);
  // The code of the app, entered after the challenge expired: a new sign-in takes it.
  clock += 3600 * 1000;
  assert.equal(session.mfaPending, null);
  await session.submitMfa('123456');
  assert.equal(session.signedIn, true);
});

test('session: an expired SMS challenge sends a new SMS rather than a stale code', async () => {
  let clock = 0;
  const ecobee = createFakeEcobee({ mfa: 'sms' });
  const session = new EcobeeSession({
    fetch: ecobee.fetch,
    store: new MemoryStore(),
    now: () => clock,
  });
  await session.configure(accountConfig);
  await assert.rejects(session.signIn(), MfaRequiredError);
  clock += 20 * 60 * 1000;
  await assert.rejects(session.submitMfa('123456'), (err) => err.kind === 'mfa_new_sms');
  assert.equal(session.mfaPending, 'sms');
  await session.submitMfa('123456');
  assert.equal(session.signedIn, true);
});

test('developer API key: PIN, pending until authorized, then tokens and refresh', async () => {
  let clock = 0;
  const ecobee = createFakeEcobee();
  const session = new EcobeeSession({
    fetch: ecobee.fetch,
    store: new MemoryStore(),
    now: () => clock,
  });
  await session.configure(normalizeConfig({ api_key: 'DEVKEY0123456789' }));
  const pin = await session.requestPin();
  assert.deepEqual(pin, { pin: 'ab12', minutes: 9, intervalMs: 30_000 });
  assert.equal(await session.completePin(), false);
  ecobee.authorizePins();
  assert.equal(await session.completePin(), true);
  assert.equal(session.tokens.method, 'api_key');
  clock += 2 * 3600 * 1000;
  assert.equal(await session.accessToken(), 'access-2');
  const refresh = new URL(ecobee.requests.at(-1).url);
  assert.equal(refresh.searchParams.get('grant_type'), 'refresh_token');
  assert.equal(refresh.searchParams.get('client_id'), 'DEVKEY0123456789');
});

test('developer API key: a refused key, and a PIN that expires', async () => {
  let clock = 0;
  const ecobee = createFakeEcobee();
  const refused = new EcobeeSession({ fetch: ecobee.fetch, store: new MemoryStore() });
  await refused.configure(normalizeConfig({ api_key: 'NOT-A-KEY' }));
  await assert.rejects(refused.requestPin(), (err) => err.kind === 'api_key');

  const session = new EcobeeSession({
    fetch: ecobee.fetch,
    store: new MemoryStore(),
    now: () => clock,
  });
  await session.configure(normalizeConfig({ api_key: 'DEVKEY0123456789' }));
  await session.requestPin();
  clock += 10 * 60 * 1000;
  await assert.rejects(session.completePin(), (err) => err.kind === 'pin_expired');
});
