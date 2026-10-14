// -----------------------------------------------------------------------------
// The one door to the network. Every request goes through `send`, with a
// timeout, and a network failure becomes a NetworkError whose message names
// the host and the cause only: the URLs of the sign-in carry codes and
// tokens, they must never reach a log.
// -----------------------------------------------------------------------------

import { NetworkError } from './errors.js';

export const TIMEOUT_MS = 30_000;

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function send(fetchImpl, url, init = {}) {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  } catch (err) {
    const cause = err?.cause?.code ?? err?.cause?.name ?? err?.name ?? 'error';
    throw new NetworkError(`${new URL(url).host} unreachable (${cause})`);
  }
}

/** The JSON body of a response, or null when it has none (an HTML page...). */
export async function jsonOf(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** An application/x-www-form-urlencoded body. */
export const form = (fields) => new URLSearchParams(fields).toString();

export const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };
