// -----------------------------------------------------------------------------
// The errors of the ecobee layer. Each one carries a `kind` the hub turns into
// a message for the user (src/i18n.js): the text of an error never reaches the
// screen as is, and never carries a token, a password or a full URL.
// -----------------------------------------------------------------------------

/**
 * Sign-in refused or impossible.
 *
 * kinds:
 * - `credentials`     : ecobee refused the email or the password;
 * - `mfa_code`        : the verification code was refused;
 * - `mfa_unsupported` : the account asks for a second factor other than a code
 *                       (push, email link): not supported;
 * - `prompt`          : ecobee wants an interactive step first (new terms...);
 * - `invalid_grant`   : the stored session is no longer valid;
 * - `pin_pending`     : the PIN was not authorized on ecobee.com yet;
 * - `pin_expired`     : the PIN expired before being authorized;
 * - `api_key`         : the developer API key was refused;
 * - `unavailable`     : ecobee answered with an error (5xx, 429, a moved page).
 */
export class AuthError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

/** The account asks for a verification code: `challenge` resumes the sign-in. */
export class MfaRequiredError extends Error {
  constructor(challenge) {
    super(`ecobee asks for a verification code (${challenge.type})`);
    this.name = 'MfaRequiredError';
    this.challenge = challenge;
  }
}

/**
 * The thermostat API answered with an error status.
 * `code` is the ecobee status code (14: token expired, 1/16: token invalid...).
 */
export class ApiError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
  }

  get tokenExpired() {
    return this.code === 14;
  }

  get tokenInvalid() {
    return this.code === 1 || this.code === 2 || this.code === 16;
  }
}

/** The network failed (DNS, timeout, connection refused). */
export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}
