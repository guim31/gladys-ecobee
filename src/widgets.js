// -----------------------------------------------------------------------------
// The "ecobee thermostat" dashboard widget: the temperature, the setpoint(s)
// and the humidity as live tiles, the mode, what runs, the comfort setting
// and the hold in a status list, and four buttons: lower, raise, mode (a
// form), comfort setting (a form). Forms on a widget button need Gladys
// 5.2.0 (#3168); the manifest requires it anyway for the thermostat preset.
//
// Budget of the core: 8 components, 6 tiles, 1 status, 4 buttons. Texts are
// in the language of the dashboard (`language` of the request).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { CommandError, climateCommand, modeCommand, resumeCommand } from './commands.js';
import { THERMOSTAT_FEATURE, holdText, thermostatIds } from './devices.js';
import {
  effectiveClimate,
  fromTenths,
  holdParams,
  setpointStep,
  STANDARD_CLIMATES,
  toTenths,
} from './ecobee/model.js';
import { LABELS, MESSAGES, TEXT, failure, pick } from './i18n.js';

export const WIDGET = { THERMOSTAT: 'thermostat' };

/** The widget button action keys (unique: the core drops a duplicate). */
export const ACTION = { LOWER: 'lower', RAISE: 'raise', MODE: 'mode', COMFORT: 'comfort' };

const SCHEDULE = 'schedule';

const text = (body, variant = 'body') => ({ type: 'text', text: body, variant });

/** Which setpoints the dial moves in the current mode. */
function activeSides(snapshot) {
  switch (snapshot.hvacMode) {
    case 'heat':
    case 'auxHeatOnly':
      return ['heat'];
    case 'cool':
      return ['cool'];
    case 'auto':
      return ['heat', 'cool'];
    default:
      return [];
  }
}

function stateLabel(snapshot, language) {
  if (snapshot.operatingState === 1)
    return { value: pick(TEXT.heating, language), color: WIDGET_COLORS.WARNING };
  if (snapshot.operatingState === 2)
    return { value: pick(TEXT.cooling, language), color: WIDGET_COLORS.INFO };
  if (snapshot.fanRunning)
    return { value: pick(TEXT.fanOnly, language), color: WIDGET_COLORS.PRIMARY };
  return { value: pick(TEXT.idle, language), color: WIDGET_COLORS.NEUTRAL };
}

function modeLabel(mode, language) {
  const labels = LABELS[language] ?? LABELS.en;
  return mode === 'auxHeatOnly' ? `${labels.heat} (aux)` : labels[mode];
}

/** A label of the LABELS tables, as the multi-language object a form needs. */
const label = (key) =>
  Object.fromEntries(Object.entries(LABELS).map(([lang, labels]) => [lang, labels[key]]));

/** The modes the form offers on this thermostat. */
function modeChoices(snapshot) {
  return [
    { value: 'off', label: label('off') },
    ...(snapshot.canHeat ? [{ value: 'heat', label: label('heat') }] : []),
    ...(snapshot.canCool ? [{ value: 'cool', label: label('cool') }] : []),
    ...(snapshot.canHeat && snapshot.canCool ? [{ value: 'auto', label: label('auto') }] : []),
  ];
}

/** The comfort settings the form offers: the program, then Home / Away / Sleep. */
function comfortChoices(snapshot) {
  return [
    { value: SCHEDULE, label: label('schedule') },
    ...STANDARD_CLIMATES.map((ref) => snapshot.climates.find((climate) => climate.ref === ref))
      .filter(Boolean)
      // The names the user gave in ecobee, in no particular language.
      .map((climate) => ({ value: climate.ref, label: { en: climate.name.slice(0, 60) } })),
  ];
}

/**
 * The content of the widget.
 * @param {object} hub
 * @param {object} request { settings, language }
 */
export function thermostatContent(hub, { settings = {}, language = 'en' }) {
  if (!settings.thermostat) {
    return { ttl_seconds: 300, components: [text(pick(TEXT.pickThermostat, language))] };
  }
  if (!hub.session.signedIn) {
    return { ttl_seconds: 60, components: [text(pick(TEXT.notSignedIn, language))] };
  }
  const snapshot = hub.snapshotOf(settings.thermostat);
  if (!snapshot) {
    return {
      ttl_seconds: 30,
      components: [
        text(pick(hub.snapshots.size ? TEXT.thermostatNotFound : TEXT.waiting, language)),
      ],
    };
  }
  const ids = thermostatIds(hub.gladys, snapshot);
  const sides = activeSides(snapshot);
  const tiles = [
    {
      type: 'value',
      label: pick(TEXT.temperature, language),
      icon: 'thermometer',
      device_feature: ids.feature(THERMOSTAT_FEATURE.TEMPERATURE),
    },
  ];
  for (const side of sides) {
    tiles.push({
      type: 'value',
      label: pick(side === 'heat' ? TEXT.heatTo : TEXT.coolTo, language),
      icon: side === 'heat' ? 'sun' : 'wind',
      device_feature: ids.feature(
        side === 'heat' ? THERMOSTAT_FEATURE.HEAT_SETPOINT : THERMOSTAT_FEATURE.COOL_SETPOINT,
      ),
    });
  }
  // Budget: 3 tiles + 1 status + 4 buttons = 8 components. In auto mode the
  // two setpoints take the room of the humidity tile, which moves to the status.
  const humidityTile = snapshot.humidity !== null && tiles.length < 3;
  if (humidityTile) {
    tiles.push({
      type: 'value',
      label: pick(TEXT.humidity, language),
      icon: 'droplet',
      device_feature: ids.feature(THERMOSTAT_FEATURE.HUMIDITY),
    });
  }

  const running = stateLabel(snapshot, language);
  const climate = effectiveClimate(snapshot);
  const items = [
    {
      label: pick(TEXT.mode, language),
      value: modeLabel(snapshot.hvacMode, language),
      icon: 'settings',
      color: snapshot.hvacMode === 'off' ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.SUCCESS,
    },
    {
      label: pick(TEXT.state, language),
      value: running.value,
      icon: 'activity',
      color: running.color,
    },
    ...(climate
      ? [
          {
            label: pick(TEXT.comfort, language),
            value: climate.name.slice(0, 40),
            icon: 'home',
            color: WIDGET_COLORS.NEUTRAL,
          },
        ]
      : []),
    {
      label: pick(TEXT.hold, language),
      value: holdText(snapshot, language).slice(0, 40),
      icon: 'clock',
      color: snapshot.override.kind === 'none' ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.WARNING,
    },
  ];
  if (snapshot.humidity !== null && !humidityTile) {
    items.push({
      label: pick(TEXT.humidity, language),
      value: `${snapshot.humidity} %`,
      icon: 'droplet',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (!snapshot.connected) {
    items.unshift({
      label: pick(TEXT.connection, language),
      value: pick(TEXT.offline, language),
      icon: 'wifi-off',
      color: WIDGET_COLORS.DANGER,
    });
  }

  const currentMode = snapshot.hvacMode === 'auxHeatOnly' ? 'heat' : snapshot.hvacMode;
  const currentComfort =
    snapshot.override.kind === 'climate' ? snapshot.override.climateRef : SCHEDULE;
  const buttons = [];
  if (sides.length > 0) {
    buttons.push(
      {
        type: 'button',
        label: pick(TEXT.lower, language),
        icon: 'minus',
        style: 'secondary',
        action: { key: ACTION.LOWER },
      },
      {
        type: 'button',
        label: pick(TEXT.raise, language),
        icon: 'plus',
        style: 'secondary',
        action: { key: ACTION.RAISE },
      },
    );
  }
  buttons.push(
    {
      type: 'button',
      label: pick(TEXT.modeButton, language),
      icon: 'sliders',
      style: 'secondary',
      action: {
        key: ACTION.MODE,
        fields: [
          {
            key: 'mode',
            type: 'select',
            required: true,
            default: currentMode,
            label: TEXT.mode,
            options: modeChoices(snapshot),
          },
        ],
      },
    },
    {
      type: 'button',
      label: pick(TEXT.comfortButton, language),
      icon: 'home',
      style: 'secondary',
      action: {
        key: ACTION.COMFORT,
        fields: [
          {
            key: 'comfort',
            type: 'select',
            required: true,
            default: comfortChoices(snapshot).some((choice) => choice.value === currentComfort)
              ? currentComfort
              : SCHEDULE,
            label: TEXT.comfort,
            options: comfortChoices(snapshot),
          },
        ],
      },
    },
  );
  return { ttl_seconds: 120, components: [...tiles, { type: 'status', items }, ...buttons] };
}

/** One step of the dial on the setpoints the mode uses. */
function stepCommand(hub, snapshot, direction) {
  const sides = activeSides(snapshot);
  if (sides.length === 0) {
    throw new CommandError(TEXT.thermostatIsOff);
  }
  const unit = hub.unitOf(snapshot);
  const step = setpointStep(unit) * direction;
  const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));
  const moved = (tenths, range) =>
    clamp(toTenths(fromTenths(tenths, unit, setpointStep(unit)) + step, unit), range);
  let heat = snapshot.desiredHeat ?? snapshot.heatRange[0];
  let cool = snapshot.desiredCool ?? snapshot.coolRange[1];
  if (sides.length === 2) {
    // Auto: both move, the gap between them stays.
    heat = moved(heat, snapshot.heatRange);
    cool = Math.max(moved(cool, snapshot.coolRange), heat + snapshot.heatCoolMinDelta);
  } else if (sides[0] === 'heat') {
    heat = moved(heat, snapshot.heatRange);
    cool = heat;
  } else {
    cool = moved(cool, snapshot.coolRange);
    heat = cool;
  }
  return {
    update: {
      functions: [
        {
          type: 'setHold',
          params: {
            ...holdParams(hub.config.hold_duration, snapshot),
            heatHoldTemp: heat,
            coolHoldTemp: cool,
          },
        },
      ],
    },
    shown: fromTenths(sides[0] === 'cool' ? cool : heat, unit, setpointStep(unit)),
    unit,
  };
}

/**
 * A button of the widget.
 * @param {object} hub
 * @param {object} request { actionKey, settings, values, language }
 */
export async function thermostatAction(hub, { actionKey, settings = {}, values, language }) {
  const lang = language ?? hub.language;
  const snapshot = hub.commandTarget(settings.thermostat);
  try {
    switch (actionKey) {
      case ACTION.LOWER:
      case ACTION.RAISE: {
        const { update, shown, unit } = stepCommand(
          hub,
          snapshot,
          actionKey === ACTION.RAISE ? 1 : -1,
        );
        hub.logger.info(`Widget: setpoint ${shown} on ${snapshot.name}`);
        await hub.send(snapshot, update);
        return MESSAGES.setpointSet(`${shown} ${unit === 'celsius' ? '°C' : '°F'}`);
      }
      case ACTION.MODE: {
        // An older core drops the form and sends no values: refuse rather than guess.
        if (!values?.mode) {
          throw new CommandError(TEXT.commandFailed);
        }
        const gladysMode = { off: 0, heat: 1, cool: 2, auto: 3 }[values.mode];
        const update = modeCommand(snapshot, gladysMode);
        hub.logger.info(`Widget: mode ${values.mode} on ${snapshot.name}`);
        await hub.send(snapshot, update);
        return undefined;
      }
      case ACTION.COMFORT: {
        if (!values?.comfort) {
          throw new CommandError(TEXT.commandFailed);
        }
        const update =
          values.comfort === SCHEDULE
            ? resumeCommand(snapshot)
            : climateCommand(snapshot, values.comfort, hub.config.hold_duration);
        hub.logger.info(`Widget: comfort setting ${values.comfort} on ${snapshot.name}`);
        await hub.send(snapshot, update);
        return undefined;
      }
      default:
        throw new CommandError(TEXT.commandFailed);
    }
  } catch (err) {
    throw err instanceof CommandError ? failure(err.text, lang) : err;
  }
}

/** The widgets of the manifest, by key. */
export const WIDGETS = {
  [WIDGET.THERMOSTAT]: { get: thermostatContent, action: thermostatAction },
};
