// -----------------------------------------------------------------------------
// Signing in to ecobee.
//
// ecobee stopped handing out developer API keys in 2024. Two ways remain, and
// both are the ones Home Assistant and python-ecobee-api (MIT, Nolan Gilley)
// use today:
//
// 1. The account sign-in (the default): the same Auth0 universal login as the
//    ecobee web portal (auth.ecobee.com), with the portal's public client id:
//    authorization code + PKCE, identifier page, then password page, then an
//    optional verification code (MFA by authenticator app or SMS), and the
//    code is exchanged for an access token (1 h) and a refresh token. The
//    refresh token renews the access token without the password.
// 2. The PIN of a developer API key (for those who still have one): the key
//    asks for a PIN, the user enters it on ecobee.com (My Apps), and the code
//    is exchanged for tokens at api.ecobee.com/token.
//
// Nothing here logs: the hub decides what to say, without secrets.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { AuthError, MfaRequiredError } from './errors.js';
import { FORM_HEADERS, form, jsonOf, send } from './http.js';

export const AUTH_BASE = 'https://auth.ecobee.com';
export const API_BASE = 'https://api.ecobee.com';

// The public client of the ecobee web portal, as python-ecobee-api 0.4.4 uses it.
export const WEB_CLIENT = {
  clientId: '183eORFPlXyz9BbDZwqexHPBQoVjgadh',
  redirectUri: 'https://www.ecobee.com/home/authCallback',
  audience: 'https://prod.ecobee.com/api/v1',
  scope: 'openid offline_access smartWrite piiWrite piiRead smartRead deleteGrants',
};

const MFA_OTP_PATH = '/u/mfa-otp-challenge';
const MFA_SMS_PATH = '/u/mfa-sms-challenge';
const CUSTOM_PROMPT_PATH = '/u/custom-prompt';
const MAX_REDIRECTS = 10;

/** A PKCE pair: the verifier, and its S256 challenge (RFC 7636). */
export function pkcePair() {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * The cookies of the Auth0 transaction: the login pages are bound to them.
 * Only the name=value pairs are kept, for auth.ecobee.com.
 */
export class CookieJar {
  constructor(entries = {}) {
    this.cookies = new Map(Object.entries(entries));
  }

  store(response) {
    const lines = response.headers.getSetCookie?.() ?? [];
    for (const line of lines) {
      const [pair, ...attributes] = line.split(';');
      const index = pair.indexOf('=');
      if (index <= 0) {
        continue;
      }
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute));
      if (value === '' || expired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.cookies);
  }
}

const stateOf = (url) => new URL(url).searchParams.get('state') ?? '';
const codeOf = (url) => new URL(url).searchParams.get('code');
const isRedirect = (status) => [301, 302, 303, 307, 308].includes(status);
const pathOf = (url) => new URL(url).pathname;

/** One request on auth.ecobee.com, with the cookies, never following redirects. */
async function authRequest(context, url, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  const cookie = context.jar.header();
  if (cookie) {
    headers.Cookie = cookie;
  }
  const response = await send(context.fetch, url, { ...init, headers, redirect: 'manual' });
  context.jar.store(response);
  return response;
}

/**
 * Follow the redirects of a response while they stay on auth.ecobee.com.
 * The last one, to www.ecobee.com/home/authCallback?code=..., is read and not
 * fetched. Resolves with the URL reached and the last response.
 */
async function follow(context, response, url) {
  let current = response;
  let currentUrl = url;
  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    if (!isRedirect(current.status)) {
      // Drain the body: undici keeps the socket busy otherwise.
      await current.text().catch(() => '');
      if (current.status === 429 || current.status >= 500) {
        throw new AuthError('unavailable', `ecobee sign-in answered HTTP ${current.status}`);
      }
      return { url: currentUrl, status: current.status };
    }
    const next = new URL(current.headers.get('location') ?? '', currentUrl).href;
    await current.text().catch(() => '');
    if (new URL(next).origin !== AUTH_BASE) {
      return { url: next, status: current.status };
    }
    currentUrl = next;
    current = await authRequest(context, next);
  }
  throw new AuthError('unavailable', 'ecobee sign-in redirected too many times');
}

/**
 * Sign in with the email and the password of the ecobee account.
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {string} options.username
 * @param {string} options.password
 * @returns {Promise<{ access_token: string, refresh_token: string, expires_in?: number }>}
 * @throws {MfaRequiredError} the account asks for a verification code
 * @throws {AuthError}
 */
export async function webLogin({ fetch: fetchImpl, username, password }) {
  const context = { fetch: fetchImpl, jar: new CookieJar() };
  const { verifier, challenge } = pkcePair();
  const authorizeUrl = `${AUTH_BASE}/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: WEB_CLIENT.clientId,
    redirect_uri: WEB_CLIENT.redirectUri,
    audience: WEB_CLIENT.audience,
    scope: WEB_CLIENT.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })}`;

  // 1. The login page, identifier first.
  let step = await follow(context, await authRequest(context, authorizeUrl), authorizeUrl);
  if (!pathOf(step.url).startsWith('/u/login/identifier')) {
    throw new AuthError('unavailable', 'the ecobee login page moved (no identifier step)');
  }

  // 2. The email.
  const identifierUrl = step.url;
  let response = await authRequest(context, identifierUrl, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: form({ state: stateOf(identifierUrl), username }),
  });
  step = await follow(context, response, identifierUrl);
  if (!pathOf(step.url).startsWith('/u/login/password')) {
    throw new AuthError('credentials', 'ecobee did not accept the email');
  }

  // 3. The password: ecobee answers with the callback (code), a verification
  // code challenge, or the password page again.
  const passwordUrl = step.url;
  response = await authRequest(context, passwordUrl, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: form({ state: stateOf(passwordUrl), username, password }),
  });
  step = await follow(context, response, passwordUrl);
  return finishLogin(context, step.url, verifier);
}

/** Decide on the page the password (or the code) led to. */
async function finishLogin(context, url, verifier) {
  const path = pathOf(url);
  if (path.startsWith(MFA_OTP_PATH) || path.startsWith(MFA_SMS_PATH)) {
    throw new MfaRequiredError({
      type: path.startsWith(MFA_SMS_PATH) ? 'sms' : 'otp',
      url,
      state: stateOf(url),
      cookies: context.jar.toJSON(),
      verifier,
    });
  }
  if (path.startsWith('/u/mfa-')) {
    throw new AuthError('mfa_unsupported', 'ecobee asks for a second factor other than a code');
  }
  if (path.startsWith('/u/login/password')) {
    throw new AuthError('credentials', 'ecobee refused the password');
  }
  if (path.startsWith(CUSTOM_PROMPT_PATH)) {
    throw new AuthError('prompt', 'ecobee asks to complete a step in a browser first');
  }
  const code = codeOf(url);
  if (!code) {
    throw new AuthError('unavailable', `unexpected page after the sign-in (${path})`);
  }
  return exchangeCode(context.fetch, code, verifier);
}

/**
 * Finish a sign-in interrupted by a verification code.
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {object} options.challenge MfaRequiredError.challenge
 * @param {string} options.code the code from the authenticator app or the SMS
 */
export async function submitMfaCode({ fetch: fetchImpl, challenge, code }) {
  const context = { fetch: fetchImpl, jar: new CookieJar(challenge.cookies) };
  const response = await authRequest(context, challenge.url, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: form({ state: challenge.state, code: String(code).trim() }),
  });
  // A wrong SMS code is a 400 on the challenge page; a wrong app code sends
  // back to the challenge page.
  if (response.status === 400) {
    await response.text().catch(() => '');
    throw new AuthError('mfa_code', 'ecobee refused the verification code');
  }
  const step = await follow(context, response, challenge.url);
  const path = pathOf(step.url);
  if (path.startsWith(MFA_OTP_PATH) || path.startsWith(MFA_SMS_PATH)) {
    throw new AuthError('mfa_code', 'ecobee refused the verification code');
  }
  return finishLogin(context, step.url, challenge.verifier);
}

/** Exchange the authorization code for the tokens. */
async function exchangeCode(fetchImpl, code, verifier) {
  const response = await send(fetchImpl, `${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: form({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: WEB_CLIENT.clientId,
      redirect_uri: WEB_CLIENT.redirectUri,
    }),
  });
  const payload = await jsonOf(response);
  if (!response.ok || !payload?.access_token) {
    throw new AuthError('unavailable', `token exchange failed (HTTP ${response.status})`);
  }
  if (!payload.refresh_token) {
    // Without it the session dies after an hour: not worth starting.
    throw new AuthError('unavailable', 'ecobee gave no refresh token');
  }
  return payload;
}

/**
 * Renew the access token of an account sign-in. ecobee may rotate the
 * refresh token: the new one, when given, replaces the old one.
 */
export async function refreshWebToken({ fetch: fetchImpl, refreshToken }) {
  const response = await send(fetchImpl, `${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: form({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: WEB_CLIENT.clientId,
    }),
  });
  const payload = await jsonOf(response);
  if (response.ok && payload?.access_token) {
    return { ...payload, refresh_token: payload.refresh_token ?? refreshToken };
  }
  if (payload?.error === 'invalid_grant' || response.status === 401 || response.status === 403) {
    throw new AuthError('invalid_grant', 'the ecobee session is no longer valid');
  }
  throw new AuthError('unavailable', `token refresh failed (HTTP ${response.status})`);
}

/**
 * Ask a PIN for a developer API key.
 * @returns {Promise<{ ecobeePin: string, code: string, interval: number, expires_in: number }>}
 */
export async function requestPin({ fetch: fetchImpl, apiKey }) {
  const url = `${API_BASE}/authorize?${new URLSearchParams({
    response_type: 'ecobeePin',
    client_id: apiKey,
    scope: 'smartWrite',
  })}`;
  const response = await send(fetchImpl, url);
  const payload = await jsonOf(response);
  if (response.ok && payload?.ecobeePin && payload?.code) {
    return payload;
  }
  if (payload?.error === 'invalid_client' || response.status === 401) {
    throw new AuthError('api_key', 'ecobee refused the API key');
  }
  throw new AuthError('unavailable', `PIN request failed (HTTP ${response.status})`);
}

/** Exchange an authorized PIN for the tokens. */
export async function pinTokens({ fetch: fetchImpl, apiKey, code }) {
  return apiToken(fetchImpl, { grant_type: 'ecobeePin', code, client_id: apiKey });
}

/** Renew the access token of a developer API key. */
export async function refreshPinToken({ fetch: fetchImpl, apiKey, refreshToken }) {
  return apiToken(fetchImpl, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: apiKey,
  });
}

async function apiToken(fetchImpl, params) {
  // The PIN flow takes its parameters in the query string (python-ecobee-api).
  const response = await send(fetchImpl, `${API_BASE}/token?${new URLSearchParams(params)}`, {
    method: 'POST',
  });
  const payload = await jsonOf(response);
  if (response.ok && payload?.access_token) {
    return payload;
  }
  switch (payload?.error) {
    case 'authorization_pending':
    case 'slow_down':
      throw new AuthError('pin_pending', 'the PIN is not authorized yet');
    case 'authorization_expired':
      throw new AuthError('pin_expired', 'the PIN expired');
    case 'invalid_grant':
      throw new AuthError('invalid_grant', 'the ecobee session is no longer valid');
    case 'invalid_client':
    case 'unauthorized_client':
      throw new AuthError('api_key', 'ecobee refused the API key');
    default:
      throw new AuthError('unavailable', `token request failed (HTTP ${response.status})`);
  }
}
