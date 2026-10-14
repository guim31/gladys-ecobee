// -----------------------------------------------------------------------------
// Integration configuration: the defaults (they MUST stay equal to the
// `default` values of the manifest `config_schema`, test/manifest.test.js
// checks it) and the normalization of what Gladys sends, so the rest of the
// code never deals with `undefined` or with a number typed as a string.
// -----------------------------------------------------------------------------

/** The languages of the texts the container produces. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** The unit of the temperature features. */
export const TEMPERATURE_UNITS = ['thermostat', 'celsius', 'fahrenheit'];

/** How long a setpoint or a comfort setting changed from Gladys is held. */
export const HOLD_DURATIONS = ['next_transition', 'indefinite', 'hours_2', 'hours_4', 'thermostat'];

// ecobee asks API clients not to read the thermostats more often than every
// 3 minutes (Home Assistant reads every 3 minutes too).
export const MIN_REFRESH_MINUTES = 3;
export const MAX_REFRESH_MINUTES = 60;

export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  api_key: '',
  temperature_unit: 'thermostat',
  hold_duration: 'next_transition',
  refresh_minutes: 3,
  language: 'fr',
};

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * @param {Record<string, unknown>} [raw] the config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const minutes = Math.round(Number(raw.refresh_minutes ?? DEFAULT_CONFIG.refresh_minutes));
  return {
    email: String(raw.email ?? '').trim(),
    password: String(raw.password ?? ''),
    api_key: String(raw.api_key ?? '').trim(),
    temperature_unit: oneOf(
      raw.temperature_unit,
      TEMPERATURE_UNITS,
      DEFAULT_CONFIG.temperature_unit,
    ),
    hold_duration: oneOf(raw.hold_duration, HOLD_DURATIONS, DEFAULT_CONFIG.hold_duration),
    refresh_minutes: Number.isFinite(minutes)
      ? Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, minutes))
      : DEFAULT_CONFIG.refresh_minutes,
    language: oneOf(raw.language, LANGUAGES, DEFAULT_CONFIG.language),
  };
}

/**
 * How the integration signs in: `account` (email + password, the default),
 * `api_key` (a developer API key and its PIN), or null when nothing is filled.
 */
export function authMethod(config) {
  if (config.api_key) {
    return 'api_key';
  }
  if (config.email && config.password) {
    return 'account';
  }
  return null;
}

/** The temperature unit of the features for a thermostat. */
export function unitFor(config, snapshot) {
  if (config.temperature_unit === 'celsius' || config.temperature_unit === 'fahrenheit') {
    return config.temperature_unit;
  }
  return snapshot?.useCelsius ? 'celsius' : 'fahrenheit';
}

/** The values of a config that must never reach a log. */
export const secretsOf = (config) => [config.password, config.api_key].filter((value) => value);
