// -----------------------------------------------------------------------------
// The thermostat API (api.ecobee.com/1), read and write.
//
// ecobee asks API clients not to read the thermostats more often than every
// 3 minutes: the hub reads them on that pace (refresh_minutes, never below
// 3), plus one read a few seconds after a command, to show its effect.
//
// Every temperature of the API is in tenths of a degree FAHRENHEIT, whatever
// the unit the thermostat displays (src/ecobee/model.js converts).
// -----------------------------------------------------------------------------

import { API_BASE } from './auth.js';
import { ApiError } from './errors.js';
import { jsonOf, send } from './http.js';

/** Everything the integration reads, in one request for all the thermostats. */
export const SELECTION = {
  selectionType: 'registered',
  selectionMatch: '',
  includeRuntime: true,
  includeSettings: true,
  includeProgram: true,
  includeEvents: true,
  includeEquipmentStatus: true,
  includeSensors: true,
  includeAlerts: true,
};

/**
 * Read every thermostat of the account.
 * @param {typeof fetch} fetchImpl
 * @param {string} accessToken
 * @returns {Promise<object[]>} the raw thermostatList
 */
export async function readThermostats(fetchImpl, accessToken) {
  // The `json` query parameter, as python-ecobee-api sends it.
  const query = new URLSearchParams({ json: JSON.stringify({ selection: SELECTION }) });
  const response = await send(fetchImpl, `${API_BASE}/1/thermostat?${query}`, {
    headers: headers(accessToken),
  });
  const payload = await checked(response);
  return Array.isArray(payload.thermostatList) ? payload.thermostatList : [];
}

/**
 * Send functions (setHold, resumeProgram...) and/or a partial thermostat
 * object (settings) to ONE thermostat.
 * @param {typeof fetch} fetchImpl
 * @param {string} accessToken
 * @param {string} identifier the thermostat identifier (serial number)
 * @param {{ functions?: object[], thermostat?: object }} update
 */
export async function updateThermostat(fetchImpl, accessToken, identifier, update) {
  const body = {
    selection: { selectionType: 'thermostats', selectionMatch: String(identifier) },
    ...update,
  };
  const response = await send(fetchImpl, `${API_BASE}/1/thermostat?format=json`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });
  await checked(response);
}

const headers = (accessToken) => ({
  'Content-Type': 'application/json;charset=UTF-8',
  Authorization: `Bearer ${accessToken}`,
});

/** The payload of a response whose `status.code` is 0, or an ApiError. */
async function checked(response) {
  const payload = await jsonOf(response);
  const status = payload?.status;
  if (response.ok && status && Number(status.code) === 0) {
    return payload;
  }
  if (status && status.code !== undefined) {
    // ecobee's messages name no secret ("Authentication token has expired...").
    const message = String(status.message ?? '').slice(0, 160);
    throw new ApiError(
      Number(status.code),
      `ecobee API error ${status.code}: ${message}`,
      response.status,
    );
  }
  throw new ApiError(-1, `ecobee API answered HTTP ${response.status}`, response.status);
}
