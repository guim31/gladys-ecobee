// -----------------------------------------------------------------------------
// The hub: one ecobee account, its thermostats, and everything Gladys sees of
// them.
//
// Refresh. The core cannot be trusted to call onPoll (GladysAssistant/Gladys
// #3198: a device created without should_poll is never polled, even after the
// fix), so the hub reads ecobee by itself, every `refresh_minutes` (3 at
// least: ecobee asks API clients not to read more often). The devices still
// carry should_poll + a valid poll_frequency, and the core's onPoll is a
// fallback that reads only when the timer has not for a whole period. One
// request reads every thermostat of the account; a command is followed by one
// read a few seconds later, to show its effect.
//
// States. Only the changes are published (the SDK deduplicates), plus a
// heartbeat every 6 hours so a value that never moves stays recent, and only
// for the devices the user added to Gladys. When a device is added, its
// states are sent at once from the last reading: no extra request to ecobee.
//
// Logs. A normal cycle writes nothing at the info level: the sign-in, the
// thermostats found, a thermostat or ecobee lost and back, and one line per
// user command do. Never a token, a password or an address with credentials.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { authMethod, secretsOf, unitFor } from './config.js';
import { CommandError, applyUpdate, featureCommand } from './commands.js';
import {
  allStates,
  buildDevices,
  sensorIds,
  thermostatIds,
  thermostatStates,
  sensorStates,
} from './devices.js';
import { readThermostats, updateThermostat } from './ecobee/api.js';
import { ApiError, AuthError, MfaRequiredError, NetworkError } from './ecobee/errors.js';
import { homeOccupied, parseThermostat } from './ecobee/model.js';
import { EcobeeSession } from './ecobee/session.js';
import { MESSAGES, TEXT, failure, pick } from './i18n.js';
import { IssueLog } from './issues.js';

/** The scene triggers the hub fires (manifest `scene_triggers`). */
export const TRIGGER = {
  HOME_OCCUPIED: 'home_occupied',
  HOME_VACANT: 'home_vacant',
  ALERT: 'alert',
};

/** The widget the hub nudges when the readings change. */
export const WIDGET_KEY = 'thermostat';

const HEARTBEAT_MS = 6 * 3600 * 1000;

export const DEFAULT_TIMINGS = {
  // The read that shows the effect of a command.
  followUpMs: 5000,
  // Retry of a sign-in ecobee could not answer (5xx, network).
  retryMs: 5 * 60 * 1000,
};

export class EcobeeHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store the session store (src/store.js)
   * @param {typeof fetch} [options.fetch]
   * @param {boolean} [options.timers] run the timers (the tests drive them)
   * @param {object} [options.timings]
   * @param {() => number} [options.now]
   * @param {object} [options.logger]
   */
  constructor({
    gladys,
    store,
    fetch: fetchImpl = globalThis.fetch,
    timers = true,
    timings = {},
    now = () => Date.now(),
    logger,
  }) {
    this.gladys = gladys;
    this.fetch = fetchImpl;
    this.timers = timers;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now;
    this.logger = logger ?? createLogger({ name: 'ecobee' });
    this.issues = new IssueLog(this.logger);
    this.session = new EcobeeSession({ fetch: fetchImpl, store, now });
    this.config = null;
    /** @type {Map<string, object>} snapshots by thermostat identifier */
    this.snapshots = new Map();
    this.lastReadAt = null;
    this.reading = null;
    this.devicesSignature = null;
    this.readingsSignature = null;
    this.statusKey = null;
    this.announced = false;
    // Sign-in state: 'ok' | 'none' | 'mfa' | 'refused' | 'pin' | 'retry'
    this.auth = 'none';
    this.occupancy = new Map();
    this.alertsSeen = new Map();
    this.timer = null;
    this.followUp = null;
    this.pinTimer = null;
    this.stopped = false;
  }

  get periodMs() {
    return this.config.refresh_minutes * 60 * 1000;
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Lifecycle -------------------------------------------------------------

  /** First start, or a new configuration: sign in if needed, read, publish. */
  async start(config) {
    this.stopped = false;
    const previousAccount = EcobeeSession.fingerprint(this.config ?? {});
    this.config = config;
    const restored = await this.session.configure(config);
    if (EcobeeSession.fingerprint(config) !== previousAccount) {
      this.snapshots.clear();
      this.occupancy.clear();
      this.alertsSeen.clear();
      this.devicesSignature = null;
      this.announced = false;
      this.issues.reset();
    }
    clearTimeout(this.pinTimer);
    const method = authMethod(config);
    if (!method) {
      this.auth = 'none';
      this.logger.info('Not configured yet: waiting for the ecobee account');
      await this.setStatus(false, TEXT.notConfigured);
    } else if (restored) {
      this.auth = 'ok';
    } else if (method === 'account') {
      await this.signIn();
    } else {
      this.auth = 'pin';
      this.logger.info('Developer API key configured: waiting for its PIN');
      await this.setStatus(false, TEXT.pinNeeded);
    }
    if (this.session.signedIn) {
      await this.refresh({ force: true });
    }
    this.schedule();
  }

  /** Gladys reconnected: it may have lost states and statuses. */
  async resync() {
    this.statusKey = null;
    this.devicesSignature = null;
    this.gladys.forgetPublishedStates?.();
    if (this.session.signedIn) {
      await this.refresh({ force: true });
    } else {
      await this.start(this.config);
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.followUp);
    clearTimeout(this.pinTimer);
    this.timer = null;
    this.followUp = null;
    this.pinTimer = null;
  }

  schedule(delay = this.periodMs) {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.timers || this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick()
        .catch((err) => this.logger.error(`Refresh cycle failed (${this.redact(err.message)})`))
        .finally(() => this.schedule());
    }, delay);
    this.timer.unref?.();
  }

  /** One cycle of the timer. */
  async tick() {
    if (this.gladys.connected === false) {
      this.logger.debug('Gladys unreachable: refresh skipped');
      return;
    }
    if (this.auth === 'retry' && authMethod(this.config) === 'account') {
      await this.signIn();
    }
    if (this.session.signedIn) {
      // The core's onPoll may have read moments ago.
      await this.refresh({ minGap: 0.5 });
    }
  }

  // --- Sign-in ---------------------------------------------------------------

  /** Account sign-in; the outcome goes to the connection status. */
  async signIn() {
    try {
      await this.session.signIn();
      this.auth = 'ok';
      this.issues.recover('auth');
      this.logger.info('Signed in to ecobee');
      return true;
    } catch (err) {
      await this.authFailed(err);
      return false;
    }
  }

  /** Map a sign-in failure to the state, the log and the status. */
  async authFailed(err) {
    if (err instanceof MfaRequiredError) {
      this.auth = 'mfa';
      this.logger.info(`ecobee asks for a verification code (${err.challenge.type})`);
      await this.setStatus(false, err.challenge.type === 'sms' ? TEXT.mfaSms : TEXT.mfaOtp);
      return;
    }
    if (err instanceof AuthError) {
      const refusal = {
        credentials: TEXT.credentialsRefused,
        mfa_unsupported: TEXT.mfaUnsupported,
        prompt: TEXT.promptNeeded,
        api_key: TEXT.apiKeyRefused,
        not_configured: TEXT.notConfigured,
      }[err.kind];
      if (refusal) {
        // Never retried by itself: a loop of refused passwords locks accounts.
        this.auth = 'refused';
        this.issues.fail('auth', `ecobee sign-in refused: ${err.message}`, 'error');
        await this.setStatus(false, refusal);
        return;
      }
      if (err.kind === 'invalid_grant' || err.kind === 'not_signed_in') {
        this.auth = authMethod(this.config) === 'api_key' ? 'pin' : 'refused';
        this.issues.fail('auth', `ecobee session ended: ${err.message}`, 'error');
        await this.setStatus(false, this.auth === 'pin' ? TEXT.pinNeeded : TEXT.credentialsRefused);
        return;
      }
    }
    this.auth = 'retry';
    this.issues.fail('auth', `ecobee sign-in failed, retrying later (${this.redact(err.message)})`);
    await this.setStatus(false, TEXT.unreachable);
  }

  // --- Reading ---------------------------------------------------------------

  /**
   * Read every thermostat and publish what changed.
   * @param {object} [options]
   * @param {boolean} [options.force] read even if read moments ago
   * @param {number} [options.minGap] skip when the last read is more recent
   *   than this fraction of the period
   * @returns {Promise<boolean>} true when ecobee was read
   */
  async refresh({ force = false, minGap = 0 } = {}) {
    if (this.reading) {
      return this.reading;
    }
    if (
      !force &&
      this.lastReadAt !== null &&
      this.now() - this.lastReadAt < this.periodMs * minGap
    ) {
      this.logger.debug(`Read ${this.now() - this.lastReadAt} ms ago, skipped`);
      return false;
    }
    this.reading = this.read().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async read() {
    this.lastReadAt = this.now();
    let list;
    try {
      list = await this.session.withToken((token) => readThermostats(this.fetch, token));
    } catch (err) {
      await this.readFailed(err);
      return false;
    }
    this.issues.recover('read', 'ecobee answers again');
    this.issues.recover('auth');
    this.auth = 'ok';
    const snapshots = list.map(parseThermostat);
    this.snapshots = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    this.logger.debug(`Read ${snapshots.length} thermostat(s)`);

    if (!this.announced) {
      this.announced = true;
      const sensors = snapshots.reduce((count, snapshot) => count + snapshot.sensors.length, 0);
      this.logger.info(
        `ecobee account read: ${snapshots.length} thermostat(s), ${sensors} remote sensor(s)`,
      );
    }
    for (const snapshot of snapshots) {
      if (snapshot.connected) {
        this.issues.recover(`offline:${snapshot.id}`, `Thermostat ${snapshot.name} is back online`);
      } else {
        this.issues.fail(
          `offline:${snapshot.id}`,
          `Thermostat ${snapshot.name} is offline from ecobee`,
        );
      }
    }

    await this.publishDevices();
    await this.publishStates();
    await this.fireTriggers(snapshots);
    await this.setStatus(true, snapshots.length === 0 ? TEXT.noThermostat : undefined);
    // Open dashboards follow the readings; the core caps the nudges anyway.
    const readings = JSON.stringify(
      list.map((raw) => [raw.runtime, raw.settings?.hvacMode, raw.events]),
    );
    if (readings !== this.readingsSignature) {
      this.readingsSignature = readings;
      this.nudgeWidget();
    }
    return true;
  }

  async readFailed(err) {
    if (err instanceof AuthError || err instanceof MfaRequiredError) {
      await this.authFailed(err);
      return;
    }
    const reason =
      err instanceof NetworkError || err instanceof ApiError
        ? err.message
        : `unexpected error: ${err.message}`;
    this.issues.fail('read', `Reading ecobee failed (${this.redact(reason)})`);
    await this.setStatus(false, TEXT.unreachable);
  }

  /** Publish the device list when its structure changed. */
  async publishDevices() {
    const devices = buildDevices(this.gladys, [...this.snapshots.values()], this.config);
    const signature = JSON.stringify(devices);
    if (signature === this.devicesSignature) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(devices);
    this.devicesSignature = signature;
  }

  /** The external ids of the devices created in Gladys. */
  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /** Publish the changed states of the devices created in Gladys. */
  async publishStates() {
    const created = this.createdDevices();
    if (created.size === 0) {
      return;
    }
    const states = allStates(this.gladys, [...this.snapshots.values()], this.config).filter(
      (state) => created.has(deviceOf(state.device_feature_external_id)),
    );
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      this.issues.recover('publish', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('publish', `Publishing the states failed (${err.message})`);
    }
  }

  /** The connection status of the Configuration screen, sent when it changes. */
  async setStatus(connected, message) {
    const key = `${connected}:${message?.en ?? ''}`;
    if (key === this.statusKey) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(connected, message);
      this.statusKey = key;
    } catch (err) {
      this.logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  // --- Scene triggers --------------------------------------------------------

  /**
   * Somebody detected / nobody left around a thermostat (all its sensors),
   * and the new alerts of the thermostat. The first reading only seeds the
   * memory: nothing fires for what was already there.
   */
  async fireTriggers(snapshots) {
    for (const snapshot of snapshots) {
      const device = thermostatIds(this.gladys, snapshot).device;
      const occupied = homeOccupied(snapshot);
      const before = this.occupancy.get(snapshot.id);
      this.occupancy.set(snapshot.id, occupied);
      if (before !== undefined && before !== null && occupied !== null && before !== occupied) {
        const occupiedSensors = [
          ...(snapshot.occupancy ? [snapshot.name] : []),
          ...snapshot.sensors
            .filter((sensor) => sensor.occupancy === true)
            .map((sensor) => sensor.name),
        ];
        await this.sceneEvent(occupied ? TRIGGER.HOME_OCCUPIED : TRIGGER.HOME_VACANT, {
          device,
          thermostat: snapshot.name,
          ...(occupied ? { sensors: occupiedSensors.join(', ') } : {}),
        });
      }

      const seen = this.alertsSeen.get(snapshot.id);
      this.alertsSeen.set(snapshot.id, new Set(snapshot.alerts.map((alert) => alert.ref)));
      if (seen === undefined) {
        continue;
      }
      for (const alert of snapshot.alerts.filter((candidate) => !seen.has(candidate.ref))) {
        await this.sceneEvent(TRIGGER.ALERT, {
          device,
          thermostat: snapshot.name,
          text: alert.text.slice(0, 1000),
          alert_type: alert.notificationType ?? alert.type ?? '',
        });
      }
    }
  }

  async sceneEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.logger.debug(`Scene event ${key} for ${data.thermostat}`);
    } catch (err) {
      this.logger.warn(`Scene event ${key} not accepted (${err.message})`);
    }
  }

  // --- Gladys handlers -------------------------------------------------------

  /** The core polls a device: read only if the timer has not for a period. */
  async pollFromCore() {
    if (this.session.signedIn) {
      await this.refresh({ minGap: 1 });
    }
  }

  /** A device was added in Gladys: its states now, from the last reading. */
  async onDeviceCreated(device) {
    const states = this.statesOfDevice(device.external_id);
    if (states.length > 0) {
      this.gladys.forgetPublishedStates?.(device.external_id);
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS }).catch((err) => {
        this.logger.warn(`States of the new device not published (${err.message})`);
      });
    }
    this.nudgeWidget();
  }

  /** "Re-pull the widget now" (rate-limited by the core; lost when disconnected). */
  nudgeWidget() {
    try {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      this.logger.debug(`Widget refresh not requested (${err.message})`);
    }
  }

  statesOfDevice(externalId) {
    for (const snapshot of this.snapshots.values()) {
      if (thermostatIds(this.gladys, snapshot).device === externalId) {
        return thermostatStates(this.gladys, snapshot, this.config);
      }
      for (const sensor of snapshot.sensors) {
        if (sensorIds(this.gladys, snapshot, sensor).device === externalId) {
          return sensorStates(this.gladys, snapshot, sensor, this.config);
        }
      }
    }
    return [];
  }

  /**
   * The snapshot of the thermostat a device external id names: the
   * thermostat itself, or one of its remote sensors.
   */
  snapshotOf(externalId) {
    for (const snapshot of this.snapshots.values()) {
      if (thermostatIds(this.gladys, snapshot).device === externalId) {
        return snapshot;
      }
      if (
        snapshot.sensors.some(
          (sensor) => sensorIds(this.gladys, snapshot, sensor).device === externalId,
        )
      ) {
        return snapshot;
      }
    }
    return null;
  }

  /**
   * The snapshot for a command, or a localized error.
   * @param {string} externalId
   */
  commandTarget(externalId) {
    if (!this.session.signedIn) {
      throw failure(TEXT.notSignedIn, this.language);
    }
    const snapshot = this.snapshotOf(externalId);
    if (!snapshot) {
      throw failure(TEXT.thermostatNotFound, this.language);
    }
    if (!snapshot.connected) {
      throw failure(TEXT.thermostatOffline, this.language);
    }
    return snapshot;
  }

  /** onSetValue: a feature of a thermostat written from Gladys. */
  async setValue(device, feature, value) {
    const snapshot = this.commandTarget(device.external_id);
    const ids = thermostatIds(this.gladys, snapshot);
    const key = feature.external_id.startsWith(`${ids.device}:`)
      ? feature.external_id.slice(ids.device.length + 1)
      : null;
    let update;
    try {
      update = featureCommand(snapshot, key, value, this.config);
    } catch (err) {
      throw err instanceof CommandError ? failure(err.text, this.language) : err;
    }
    this.logger.info(`Command: ${key} = ${value} on ${snapshot.name}`);
    if (update) {
      await this.send(snapshot, update);
    }
  }

  /**
   * Send an update to one thermostat, then read again shortly after.
   * @param {object} snapshot
   * @param {object} update { functions?, thermostat? }
   */
  async send(snapshot, update) {
    try {
      await this.session.withToken((token) =>
        updateThermostat(this.fetch, token, snapshot.id, update),
      );
    } catch (err) {
      if (err instanceof AuthError || err instanceof MfaRequiredError) {
        await this.authFailed(err);
        throw failure(TEXT.notSignedIn, this.language);
      }
      this.logger.warn(
        `ecobee refused a command for ${snapshot.name} (${this.redact(err.message)})`,
      );
      throw failure(TEXT.commandFailed, this.language);
    }
    applyUpdate(snapshot, update);
    // Whatever Gladys stored for the command, the next reading is the truth.
    this.gladys.forgetPublishedStates?.(thermostatIds(this.gladys, snapshot).device);
    this.scheduleFollowUp();
  }

  scheduleFollowUp() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearTimeout(this.followUp);
    this.followUp = setTimeout(() => {
      this.followUp = null;
      this.refresh({ force: true }).catch(() => {});
    }, this.timings.followUpMs);
    this.followUp.unref?.();
  }

  // --- Configuration screen actions -----------------------------------------

  /** "Sign in / test the connection". */
  async actionSignIn() {
    const method = authMethod(this.config);
    if (method === null) {
      return TEXT.notConfigured;
    }
    if (method === 'api_key' && !this.session.signedIn) {
      return TEXT.pinNeeded;
    }
    if (method === 'account' && !this.session.signedIn) {
      if (!(await this.signIn())) {
        return this.statusMessage();
      }
    }
    if (await this.refresh({ force: true })) {
      return MESSAGES.signedIn(this.snapshots.size);
    }
    return this.statusMessage();
  }

  /** The message of the current status, for an action result. */
  statusMessage() {
    switch (this.auth) {
      case 'mfa':
        return this.session.mfaPending === 'sms' ? TEXT.mfaSms : TEXT.mfaOtp;
      case 'pin':
        return TEXT.pinNeeded;
      case 'refused':
        return authMethod(this.config) === 'api_key' ? TEXT.apiKeyRefused : TEXT.credentialsRefused;
      default:
        return TEXT.unreachable;
    }
  }

  /** "Enter the verification code". */
  async actionMfa(code) {
    if (authMethod(this.config) !== 'account') {
      return TEXT.accountOnly;
    }
    const digits = String(code ?? '').replace(/\s+/g, '');
    if (!/^\d{4,10}$/.test(digits)) {
      return TEXT.mfaCodeMissing;
    }
    try {
      await this.session.submitMfa(digits);
    } catch (err) {
      if (err instanceof AuthError && err.kind === 'mfa_code') {
        this.logger.info('ecobee refused the verification code');
        return TEXT.mfaCodeRefused;
      }
      if (err instanceof AuthError && err.kind === 'mfa_new_sms') {
        await this.authFailed(new MfaRequiredError({ type: 'sms' }));
        return TEXT.mfaNewSms;
      }
      await this.authFailed(err);
      return err instanceof AuthError && err.kind === 'unavailable'
        ? MESSAGES.unavailable(err.message.slice(0, 60))
        : this.statusMessage();
    }
    this.auth = 'ok';
    this.issues.recover('auth');
    this.logger.info('Signed in to ecobee with a verification code');
    return this.actionSignIn();
  }

  /** "Get a PIN" (developer API key). */
  async actionPin() {
    if (authMethod(this.config) !== 'api_key') {
      return TEXT.apiKeyOnly;
    }
    let pin;
    try {
      pin = await this.session.requestPin();
    } catch (err) {
      await this.authFailed(err);
      return this.statusMessage();
    }
    this.logger.info(`PIN issued for the developer API key, valid ${pin.minutes} minutes`);
    this.waitForPin(pin.intervalMs);
    return MESSAGES.pinIssued(pin.pin, pin.minutes);
  }

  /** Try the PIN every `intervalMs` until the user authorized it, or it expired. */
  waitForPin(intervalMs) {
    clearTimeout(this.pinTimer);
    if (!this.timers || this.stopped) {
      return;
    }
    this.pinTimer = setTimeout(async () => {
      this.pinTimer = null;
      if (await this.checkPin()) {
        return;
      }
      if (this.session.pendingPin) {
        this.waitForPin(intervalMs);
      }
    }, intervalMs);
    this.pinTimer.unref?.();
  }

  /** @returns {Promise<boolean>} true once signed in with the PIN */
  async checkPin() {
    try {
      if (!(await this.session.completePin())) {
        return false;
      }
    } catch (err) {
      if (err instanceof AuthError && err.kind === 'pin_expired') {
        this.logger.info('The PIN expired before it was authorized');
        await this.setStatus(false, TEXT.pinExpired);
        return false;
      }
      this.logger.debug(`PIN not exchanged yet (${err.message})`);
      return false;
    }
    this.auth = 'ok';
    this.logger.info('Signed in to ecobee with the developer API key');
    await this.refresh({ force: true });
    return true;
  }

  /** "Sign out": forget the stored session. */
  async actionSignOut() {
    await this.session.signOut();
    this.auth = authMethod(this.config) === 'api_key' ? 'pin' : 'refused';
    this.logger.info('Signed out of ecobee: stored session deleted');
    await this.setStatus(
      false,
      authMethod(this.config) === 'api_key' ? TEXT.pinNeeded : TEXT.notConfigured,
    );
    return TEXT.signedOut;
  }

  /** The unit of the temperatures of a thermostat. */
  unitOf(snapshot) {
    return unitFor(this.config, snapshot);
  }

  /** Remove the configured secrets from a text that may reach a log. */
  redact(text) {
    let clean = String(text);
    for (const secret of secretsOf(this.config ?? {})) {
      clean = clean.split(secret).join('***');
    }
    return clean;
  }

  /** A text of the configured language. */
  text(entry) {
    return pick(entry, this.language);
  }
}

/** The device external id of a feature external id. */
export const deviceOf = (featureExternalId) =>
  featureExternalId.slice(0, featureExternalId.lastIndexOf(':'));
