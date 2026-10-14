// -----------------------------------------------------------------------------
// The ecobee session: which account, its tokens, and keeping them valid.
//
// - The tokens live in /data (src/store.js), with a fingerprint of the
//   account: a configuration pointing to another account starts over.
// - The access token lasts an hour; it is renewed with the refresh token a
//   minute before it expires, or as soon as the API says it expired (14).
// - When ecobee no longer accepts the refresh token, an account sign-in is
//   replayed with the password of the configuration — unless the account asks
//   for a verification code, which only the user can give.
// - One renewal at a time: concurrent callers wait for the same one.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  pinTokens,
  refreshPinToken,
  refreshWebToken,
  requestPin,
  submitMfaCode,
  webLogin,
} from './auth.js';
import { ApiError, AuthError, MfaRequiredError } from './errors.js';
import { authMethod } from '../config.js';

// Auth0 keeps a login transaction about ten minutes.
const MFA_CHALLENGE_TTL_MS = 9 * 60 * 1000;
const EXPIRY_MARGIN_MS = 60 * 1000;

export class EcobeeSession {
  /**
   * @param {object} options
   * @param {typeof fetch} options.fetch
   * @param {{ read: Function, write: Function, clear: Function }} options.store
   * @param {() => number} [options.now]
   */
  constructor({ fetch: fetchImpl, store, now = () => Date.now() }) {
    this.fetch = fetchImpl;
    this.store = store;
    this.now = now;
    this.config = null;
    this.method = null;
    this.tokens = null;
    this.pendingMfa = null;
    this.pendingPin = null;
    this.renewing = null;
  }

  /** The fingerprint of the account the configuration names. */
  static fingerprint(config) {
    const method = authMethod(config);
    if (!method) {
      return null;
    }
    const identity = method === 'api_key' ? config.api_key : config.email.toLowerCase();
    return createHash('sha256').update(`${method}:${identity}`).digest('hex').slice(0, 16);
  }

  /**
   * Take a (new) configuration and the tokens stored for its account.
   * @returns {Promise<boolean>} true when a stored session was found
   */
  async configure(config) {
    const fingerprint = EcobeeSession.fingerprint(config);
    const changed = fingerprint !== EcobeeSession.fingerprint(this.config ?? {});
    this.config = config;
    this.method = authMethod(config);
    if (changed) {
      this.pendingMfa = null;
      this.pendingPin = null;
    }
    const stored = await this.store.read();
    if (stored && fingerprint && stored.account === fingerprint && stored.refresh_token) {
      this.tokens = stored;
      return true;
    }
    this.tokens = null;
    if (stored && stored.account !== fingerprint) {
      // Another account (or none): the old tokens must not be used.
      await this.store.clear();
    }
    return false;
  }

  get signedIn() {
    return Boolean(this.tokens?.refresh_token);
  }

  /** The kind of verification code ecobee waits for, or null. */
  get mfaPending() {
    return this.pendingMfa && this.now() - this.pendingMfa.at < MFA_CHALLENGE_TTL_MS
      ? this.pendingMfa.challenge.type
      : null;
  }

  async save(payload) {
    this.tokens = {
      account: EcobeeSession.fingerprint(this.config),
      method: this.method,
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: this.now() + Number(payload.expires_in ?? 3600) * 1000,
    };
    await this.store.write(this.tokens);
  }

  /**
   * Account sign-in with the email and the password.
   * @throws {MfaRequiredError} kept as pending: submitMfa() finishes it
   */
  async signIn() {
    if (this.method !== 'account') {
      throw new AuthError('not_configured', 'no email and password configured');
    }
    try {
      const payload = await webLogin({
        fetch: this.fetch,
        username: this.config.email,
        password: this.config.password,
      });
      this.pendingMfa = null;
      await this.save(payload);
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        this.pendingMfa = { challenge: err.challenge, at: this.now() };
      }
      throw err;
    }
  }

  /**
   * Finish the sign-in with a verification code. Without a pending challenge
   * (expired, container restarted), a new sign-in starts and the code is
   * tried on it: an authenticator app code stays valid, an SMS one does not
   * (ecobee then sends a new SMS, and the error says so).
   */
  async submitMfa(code) {
    if (!this.mfaPending) {
      try {
        await this.signIn();
        return; // no code needed after all
      } catch (err) {
        if (!(err instanceof MfaRequiredError)) {
          throw err;
        }
        if (err.challenge.type === 'sms') {
          throw new AuthError('mfa_new_sms', 'a new SMS code was sent');
        }
      }
    }
    const payload = await submitMfaCode({
      fetch: this.fetch,
      challenge: this.pendingMfa.challenge,
      code,
    });
    this.pendingMfa = null;
    await this.save(payload);
  }

  /** Ask a PIN for the developer API key; the user authorizes it on ecobee.com. */
  async requestPin() {
    if (this.method !== 'api_key') {
      throw new AuthError('not_configured', 'no API key configured');
    }
    const answer = await requestPin({ fetch: this.fetch, apiKey: this.config.api_key });
    const minutes = Number(answer.expires_in ?? 9);
    this.pendingPin = {
      code: answer.code,
      until: this.now() + minutes * 60 * 1000,
      intervalMs: Math.max(5, Number(answer.interval ?? 30)) * 1000,
    };
    return { pin: answer.ecobeePin, minutes, intervalMs: this.pendingPin.intervalMs };
  }

  /**
   * Try to exchange the pending PIN for tokens.
   * @returns {Promise<boolean>} true once signed in
   * @throws {AuthError} pin_expired, api_key...
   */
  async completePin() {
    if (!this.pendingPin) {
      return false;
    }
    if (this.now() > this.pendingPin.until) {
      this.pendingPin = null;
      throw new AuthError('pin_expired', 'the PIN expired');
    }
    try {
      const payload = await pinTokens({
        fetch: this.fetch,
        apiKey: this.config.api_key,
        code: this.pendingPin.code,
      });
      this.pendingPin = null;
      await this.save(payload);
      return true;
    } catch (err) {
      if (err instanceof AuthError && err.kind === 'pin_pending') {
        return false;
      }
      if (err instanceof AuthError && err.kind !== 'unavailable') {
        this.pendingPin = null;
      }
      throw err;
    }
  }

  async signOut() {
    this.tokens = null;
    this.pendingMfa = null;
    this.pendingPin = null;
    await this.store.clear();
  }

  /** A valid access token, renewed when needed. */
  async accessToken() {
    if (!this.signedIn) {
      throw new AuthError('not_signed_in', 'not signed in to ecobee');
    }
    if (this.tokens.access_token && this.now() < this.tokens.expires_at - EXPIRY_MARGIN_MS) {
      return this.tokens.access_token;
    }
    this.renewing ??= this.renew().finally(() => {
      this.renewing = null;
    });
    await this.renewing;
    return this.tokens.access_token;
  }

  async renew() {
    const refreshToken = this.tokens.refresh_token;
    try {
      const payload =
        this.tokens.method === 'api_key'
          ? await refreshPinToken({ fetch: this.fetch, apiKey: this.config.api_key, refreshToken })
          : await refreshWebToken({ fetch: this.fetch, refreshToken });
      await this.save({ ...payload, refresh_token: payload.refresh_token ?? refreshToken });
    } catch (err) {
      if (!(err instanceof AuthError) || err.kind !== 'invalid_grant') {
        throw err;
      }
      // The refresh token is dead: sign in again when the password allows it.
      this.tokens = null;
      await this.store.clear();
      if (this.method === 'account') {
        await this.signIn();
        return;
      }
      throw err;
    }
  }

  /**
   * Run an API call with a valid token; an expired token is renewed and the
   * call made once more.
   * @template T
   * @param {(token: string) => Promise<T>} call
   * @returns {Promise<T>}
   */
  async withToken(call) {
    const token = await this.accessToken();
    try {
      return await call(token);
    } catch (err) {
      if (!(err instanceof ApiError) || !(err.tokenExpired || err.tokenInvalid)) {
        throw err;
      }
      if (this.tokens) {
        this.tokens.expires_at = 0;
      }
      return call(await this.accessToken());
    }
  }
}
