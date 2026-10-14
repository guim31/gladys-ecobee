// -----------------------------------------------------------------------------
// An in-memory ecobee: the Auth0 universal login of auth.ecobee.com (identifier
// page, password page, verification code, PKCE token exchange, refresh
// tokens), the PIN flow and the thermostat API of api.ecobee.com. It answers a
// `fetch` call the way the real services do, as python-ecobee-api's tests
// describe them (redirects, 400 on a wrong SMS code, invalid_grant...), and
// records every request. No network.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FIXTURES = Object.fromEntries(
  ['home-assistant', 'heat-pump-fahrenheit', 'premium-celsius', 'lite-and-cool-only'].map(
    (name) => [
      name,
      JSON.parse(readFileSync(new URL(`../fixtures/ecobee/${name}.json`, import.meta.url), 'utf8')),
    ],
  ),
);

export const ACCOUNT = { email: 'owner@example.com', password: 'correct horse battery staple' };
export const CALLBACK = 'https://www.ecobee.com/home/authCallback';
const AUTH = 'https://auth.ecobee.com';

const html = (status, headers = {}) =>
  new Response('<html></html>', { status, headers: { 'content-type': 'text/html', ...headers } });
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const redirect = (location, cookie) =>
  new Response(null, {
    status: 302,
    headers: { location, ...(cookie ? { 'set-cookie': cookie } : {}) },
  });

/**
 * @param {object} [options]
 * @param {object} [options.fixture] a thermostat API response (FIXTURES.x)
 * @param {'otp'|'sms'|'push'|null} [options.mfa]
 * @param {string} [options.mfaCode]
 * @param {boolean} [options.customPrompt] ecobee wants new terms accepted
 * @param {string} [options.apiKey] the developer API key ecobee knows
 */
export function createFakeEcobee({
  fixture = FIXTURES['heat-pump-fahrenheit'],
  account = ACCOUNT,
  mfa = null,
  mfaCode = '123456',
  customPrompt = false,
  apiKey = 'DEVKEY0123456789',
  rotateRefreshTokens = true,
} = {}) {
  const ecobee = {
    requests: [],
    thermostats: structuredClone(fixture.thermostatList),
    updates: [],
    reads: 0,
    logins: 0,
    accessTokens: new Map(), // token -> expired?
    refreshTokens: new Set(),
    pins: new Map(), // code -> { authorized }
    down: false,
    counter: 0,
    transaction: null,
  };

  const issueTokens = () => {
    ecobee.counter += 1;
    const access = `access-${ecobee.counter}`;
    const refresh = `refresh-${ecobee.counter}`;
    ecobee.accessTokens.set(access, false);
    ecobee.refreshTokens.add(refresh);
    return { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer' };
  };

  /** Expire every access token (the next API call answers code 14). */
  ecobee.expireAccessTokens = () => {
    for (const token of ecobee.accessTokens.keys()) ecobee.accessTokens.set(token, true);
  };
  /** Revoke every refresh token (invalid_grant). */
  ecobee.revokeRefreshTokens = () => ecobee.refreshTokens.clear();
  /** The user authorizes every pending PIN on ecobee.com. */
  ecobee.authorizePins = () => {
    for (const pin of ecobee.pins.values()) pin.authorized = true;
  };
  /** Change the API answer (a later reading). */
  ecobee.mutate = (fn) => fn(ecobee.thermostats);

  const cookieOk = (request) => (request.headers.get('cookie') ?? '').includes('auth0=sess-1');

  async function auth(url, request, body) {
    const path = url.pathname;
    if (request.method === 'GET' && path === '/authorize') {
      ecobee.transaction = { challenge: url.searchParams.get('code_challenge'), state: 'STATE-1' };
      return redirect(
        `${AUTH}/u/login/identifier?state=STATE-1`,
        'auth0=sess-1; Path=/; HttpOnly; Secure',
      );
    }
    if (
      request.method === 'GET' &&
      (path === '/u/login/identifier' || path === '/u/login/password')
    ) {
      return html(200);
    }
    if (request.method === 'GET' && path.startsWith('/u/mfa-')) {
      return html(200);
    }
    if (request.method === 'GET' && path === '/authorize/resume') {
      return redirect(url.searchParams.get('next'));
    }
    if (request.method === 'POST' && path === '/u/login/identifier') {
      if (!cookieOk(request) || body.get('state') !== 'STATE-1') return html(400);
      ecobee.transaction.username = body.get('username');
      return redirect('/u/login/password?state=STATE-1');
    }
    if (request.method === 'POST' && path === '/u/login/password') {
      if (!cookieOk(request)) return html(400);
      if (body.get('username') !== account.email || body.get('password') !== account.password) {
        return html(400); // Auth0 renders the password page again
      }
      ecobee.logins += 1;
      if (customPrompt)
        return redirect(
          `/authorize/resume?next=${encodeURIComponent(`${AUTH}/u/custom-prompt?state=P`)}`,
        );
      if (mfa) {
        const challenge = mfa === 'push' ? '/u/mfa-push-challenge' : `/u/mfa-${mfa}-challenge`;
        return redirect(
          `/authorize/resume?next=${encodeURIComponent(`${AUTH}${challenge}?state=MFA-1`)}`,
        );
      }
      return redirect(
        `/authorize/resume?next=${encodeURIComponent(`${CALLBACK}?code=CODE-${ecobee.logins}`)}`,
      );
    }
    if (request.method === 'POST' && path.startsWith('/u/mfa-')) {
      if (!cookieOk(request) || body.get('state') !== 'MFA-1') return html(400);
      if (body.get('code') !== mfaCode) {
        return mfa === 'sms' ? html(400) : redirect(`${AUTH}${path}?state=MFA-1`);
      }
      return redirect(
        `/authorize/resume?next=${encodeURIComponent(`${CALLBACK}?code=CODE-${ecobee.logins}`)}`,
      );
    }
    if (request.method === 'POST' && path === '/oauth/token') {
      if (body.get('grant_type') === 'authorization_code') {
        const verifier = body.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (!body.get('code')?.startsWith('CODE-') || challenge !== ecobee.transaction?.challenge) {
          return json(403, { error: 'invalid_grant' });
        }
        return json(200, issueTokens());
      }
      if (body.get('grant_type') === 'refresh_token') {
        const refresh = body.get('refresh_token');
        if (!ecobee.refreshTokens.has(refresh)) return json(403, { error: 'invalid_grant' });
        const tokens = issueTokens();
        if (rotateRefreshTokens) {
          ecobee.refreshTokens.delete(refresh);
          return json(200, tokens);
        }
        ecobee.refreshTokens.delete(tokens.refresh_token);
        delete tokens.refresh_token;
        return json(200, tokens);
      }
    }
    return html(404);
  }

  async function api(url, request, rawBody) {
    const path = url.pathname;
    if (path === '/authorize') {
      if (url.searchParams.get('client_id') !== apiKey)
        return json(401, { error: 'invalid_client' });
      const code = `PINCODE-${ecobee.pins.size + 1}`;
      ecobee.pins.set(code, { authorized: false });
      return json(200, {
        ecobeePin: 'ab12',
        code,
        scope: 'smartWrite',
        expires_in: 9,
        interval: 30,
      });
    }
    if (path === '/token') {
      const grant = url.searchParams.get('grant_type');
      if (url.searchParams.get('client_id') !== apiKey)
        return json(400, { error: 'invalid_client' });
      if (grant === 'ecobeePin') {
        const pin = ecobee.pins.get(url.searchParams.get('code'));
        if (!pin) return json(400, { error: 'invalid_grant' });
        if (!pin.authorized) return json(400, { error: 'authorization_pending' });
        return json(200, issueTokens());
      }
      if (grant === 'refresh_token') {
        const refresh = url.searchParams.get('refresh_token');
        if (!ecobee.refreshTokens.has(refresh)) return json(400, { error: 'invalid_grant' });
        ecobee.refreshTokens.delete(refresh);
        return json(200, issueTokens());
      }
    }
    if (path === '/1/thermostat') {
      const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
      if (!ecobee.accessTokens.has(token)) {
        return json(500, { status: { code: 16, message: 'Authentication token is invalid.' } });
      }
      if (ecobee.accessTokens.get(token)) {
        return json(500, {
          status: { code: 14, message: 'Authentication token has expired. Refresh your tokens.' },
        });
      }
      if (request.method === 'GET') {
        const selection = JSON.parse(url.searchParams.get('json')).selection;
        if (selection.selectionType !== 'registered')
          return json(500, { status: { code: 9, message: 'Invalid selection' } });
        ecobee.reads += 1;
        return json(200, {
          thermostatList: structuredClone(ecobee.thermostats),
          status: { code: 0, message: '' },
        });
      }
      const update = JSON.parse(rawBody);
      ecobee.updates.push(update);
      const thermostat = ecobee.thermostats.find(
        (item) => String(item.identifier) === update.selection.selectionMatch,
      );
      if (!thermostat) return json(500, { status: { code: 9, message: 'Invalid selection' } });
      applyUpdate(thermostat, update);
      return json(200, { status: { code: 0, message: '' } });
    }
    return json(404, {});
  }

  ecobee.fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const rawBody = init.body === undefined ? '' : String(init.body);
    ecobee.requests.push({ method: request.method, url: request.url, body: rawBody });
    if (ecobee.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (init.redirect !== 'manual' && url.origin === AUTH && url.pathname.startsWith('/u/')) {
      throw new Error('the sign-in pages must be fetched without following redirects');
    }
    if (url.origin === AUTH) {
      return auth(url, request, new URLSearchParams(rawBody));
    }
    if (url.origin === 'https://api.ecobee.com') {
      return api(url, request, rawBody);
    }
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  };

  return ecobee;
}

/** What ecobee does with a POST /1/thermostat, coarsely. */
function applyUpdate(thermostat, update) {
  if (update.thermostat?.settings) {
    Object.assign(thermostat.settings, update.thermostat.settings);
  }
  for (const fn of update.functions ?? []) {
    if (fn.type === 'setHold') {
      if (fn.params.heatHoldTemp !== undefined)
        thermostat.runtime.desiredHeat = fn.params.heatHoldTemp;
      if (fn.params.coolHoldTemp !== undefined)
        thermostat.runtime.desiredCool = fn.params.coolHoldTemp;
      if (fn.params.fan) thermostat.runtime.desiredFanMode = fn.params.fan;
      thermostat.events = [
        {
          type: 'hold',
          name: 'auto',
          running: true,
          startDate: '2026-10-14',
          startTime: '07:45:00',
          endDate: fn.params.holdType === 'indefinite' ? '2035-01-01' : '2026-10-14',
          endTime: '18:00:00',
          holdClimateRef: fn.params.holdClimateRef ?? '',
        },
        ...(thermostat.events ?? []).filter((event) => event.type === 'vacation'),
      ];
    } else if (fn.type === 'resumeProgram') {
      thermostat.events = (thermostat.events ?? []).filter((event) => event.type === 'vacation');
    } else if (fn.type === 'deleteVacation') {
      thermostat.events = (thermostat.events ?? []).filter(
        (event) => event.name !== fn.params.name,
      );
    } else if (fn.type === 'createVacation') {
      thermostat.events = [
        { type: 'vacation', running: true, ...fn.params },
        ...(thermostat.events ?? []),
      ];
    }
  }
}
