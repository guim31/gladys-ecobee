// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys) and returns the hub, so index.js stays a few lines and the tests
// drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { EcobeeHub } from './hub.js';
import { TEXT } from './i18n.js';
import { SCENE_ACTIONS } from './scenes.js';
import { SessionStore } from './store.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'ecobee-app' });

/** The actions of the Configuration screen (manifest `actions`). */
export const ACTIONS = {
  sign_in: (hub) => hub.actionSignIn(),
  mfa_code: (hub, fields) => hub.actionMfa(fields.code),
  request_pin: (hub) => hub.actionPin(),
  sign_out: (hub) => hub.actionSignOut(),
};

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, timers, timings, now, logger
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new EcobeeHub({
    gladys,
    store: options.store ?? new SessionStore(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
    logger: options.logger,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first reading is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      if (started) {
        // Gladys restarted: re-send what it may have lost.
        await hub.resync();
        return;
      }
      started = true;
      await hub.start(normalizeConfig(await gladys.getConfig()));
    } catch (err) {
      logger.error(`Initialization failed (${hub.redact(err.message)})`);
      await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(
    whenReady(async () => {
      hub.devicesSignature = null;
      await hub.refresh({ force: true });
    }),
  );

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The hub reads ecobee on its own timer; this is the fallback.
  gladys.onPoll(whenReady(() => hub.pollFromCore()));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.start(normalizeConfig(newConfig));
    }),
  );

  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(
      key,
      whenReady((fields = {}) => handler(hub, fields)),
    );
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields = {}) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request = {}) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
