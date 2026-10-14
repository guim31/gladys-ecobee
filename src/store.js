// -----------------------------------------------------------------------------
// The ecobee session on disk: /data/ecobee-session.json, the only file the
// integration writes (the rootfs is read-only). It holds the refresh token,
// the access token and its expiry, and a fingerprint of the account they
// belong to — never the password. Written atomically (temporary file, then
// rename), readable by the container user only.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = 'ecobee-session.json';

export class SessionStore {
  constructor(dir = DEFAULT_DATA_DIR) {
    this.path = join(dir, FILE);
    this.dir = dir;
  }

  /** The stored session, or null (none, or unreadable). */
  async read() {
    try {
      const session = JSON.parse(await readFile(this.path, 'utf8'));
      return session && typeof session === 'object' ? session : null;
    } catch {
      return null;
    }
  }

  async write(session) {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(session), { mode: 0o600 });
    await rename(temporary, this.path);
  }

  async clear() {
    await rm(this.path, { force: true });
  }
}

/** A store in memory, for the tests and the probe script. */
export class MemoryStore {
  constructor(session = null) {
    this.session = session;
  }

  async read() {
    return this.session;
  }

  async write(session) {
    this.session = structuredClone(session);
  }

  async clear() {
    this.session = null;
  }
}
