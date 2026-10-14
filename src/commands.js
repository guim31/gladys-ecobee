// -----------------------------------------------------------------------------
// What to send to ecobee for each command, as pure functions of the snapshot:
// the hub sends it, the tests read it.
//
// Facts of the API (ecobee documentation, Home Assistant):
// - a setpoint is a `setHold` with BOTH heatHoldTemp and coolHoldTemp; in
//   auto mode the cool one must stay heatCoolMinDelta above the heat one;
// - the fan mode is a `setHold` too, and ecobee ignores it unless the hold
//   carries the temperatures: the current setpoints go with it;
// - a comfort setting is a `setHold` with holdClimateRef;
// - "resume the program" is `resumeProgram` (resumeAll: every stacked hold),
//   and a vacation is an event only `deleteVacation` removes;
// - the mode is a setting (`settings.hvacMode`), not a function.
// -----------------------------------------------------------------------------

import { unitFor } from './config.js';
import { ECOBEE_MODE, GLADYS_PRESET, PRESET_TO_CLIMATE, THERMOSTAT_FEATURE } from './devices.js';
import {
  climateOf,
  holdParams,
  holdTemperatures,
  toTenths,
  vacationWindow,
} from './ecobee/model.js';
import { TEXT } from './i18n.js';

/** A command refused before reaching ecobee; `text` is a TEXT entry. */
export class CommandError extends Error {
  constructor(text) {
    super(text.en);
    this.name = 'CommandError';
    this.text = text;
  }
}

const setHold = (params) => ({ functions: [{ type: 'setHold', params }] });

/** A setpoint, in the unit of the features. */
export function setpointCommand(snapshot, side, value, config, duration = config.hold_duration) {
  if ((side === 'heat' && !snapshot.canHeat) || (side === 'cool' && !snapshot.canCool)) {
    throw new CommandError(TEXT.modeUnsupported);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new CommandError(TEXT.commandFailed);
  }
  const temperatures = holdTemperatures(
    snapshot,
    side,
    toTenths(number, unitFor(config, snapshot)),
  );
  return setHold({ ...holdParams(duration, snapshot), ...temperatures });
}

/** The mode (Gladys THERMOSTAT_MODE value). */
export function modeCommand(snapshot, value) {
  const mode = ECOBEE_MODE[Number(value)];
  const supported =
    mode === 'off' ||
    (mode === 'heat' && snapshot.canHeat) ||
    (mode === 'cool' && snapshot.canCool) ||
    (mode === 'auto' && snapshot.canHeat && snapshot.canCool);
  if (!mode || !supported) {
    throw new CommandError(TEXT.modeUnsupported);
  }
  return { thermostat: { settings: { hvacMode: mode } } };
}

/** The auxiliary-heat-only switch; null when there is nothing to change. */
export function auxHeatCommand(snapshot, value) {
  if (!snapshot.hasAuxHeat) {
    throw new CommandError(TEXT.modeUnsupported);
  }
  if (Number(value) === 1) {
    return { thermostat: { settings: { hvacMode: 'auxHeatOnly' } } };
  }
  return snapshot.hvacMode === 'auxHeatOnly'
    ? { thermostat: { settings: { hvacMode: 'heat' } } }
    : null;
}

/** The fan: on (continuous) or auto (with the heating or the cooling). */
export function fanCommand(snapshot, value, config) {
  return setHold({
    ...holdParams(config.hold_duration, snapshot),
    fan: Number(value) === 1 ? 'on' : 'auto',
    heatHoldTemp: snapshot.desiredHeat ?? snapshot.heatRange[0],
    coolHoldTemp: snapshot.desiredCool ?? snapshot.coolRange[1],
  });
}

/** Back to the program: cancel the running vacation, then every hold. */
export function resumeCommand(snapshot) {
  const functions = [];
  if (snapshot.override.kind === 'vacation' && snapshot.override.name) {
    functions.push({ type: 'deleteVacation', params: { name: snapshot.override.name } });
  }
  functions.push({ type: 'resumeProgram', params: { resumeAll: true } });
  return { functions };
}

/** A comfort setting (ecobee climateRef: home, away, sleep...). */
export function climateCommand(snapshot, climateRef, duration) {
  if (!climateOf(snapshot, climateRef)) {
    throw new CommandError(TEXT.climateMissing);
  }
  return setHold({ ...holdParams(duration, snapshot), holdClimateRef: climateRef });
}

/** The preset feature (Gladys THERMOSTAT_PRESET value). */
export function presetCommand(snapshot, value, config) {
  if (Number(value) === GLADYS_PRESET.SCHEDULE) {
    return resumeCommand(snapshot);
  }
  const ref = PRESET_TO_CLIMATE[Number(value)];
  if (!ref) {
    throw new CommandError(TEXT.climateMissing);
  }
  return climateCommand(snapshot, ref, config.hold_duration);
}

/**
 * A vacation of `days` days from now. Without temperatures, those of the
 * Away comfort setting.
 * @param {object} options
 * @param {number} options.days
 * @param {number|null} [options.heat] in the unit of the features
 * @param {number|null} [options.cool]
 * @param {string} options.name
 */
export function vacationCommand(snapshot, { days, heat, cool, name }, config) {
  const unit = unitFor(config, snapshot);
  const away = climateOf(snapshot, 'away');
  const given = (value) =>
    value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const heatTemp = given(heat) ? toTenths(heat, unit) : (away?.heatTemp ?? snapshot.heatRange[0]);
  const coolTemp = given(cool) ? toTenths(cool, unit) : (away?.coolTemp ?? snapshot.coolRange[1]);
  return {
    functions: [
      {
        type: 'createVacation',
        params: {
          name,
          heatHoldTemp: heatTemp,
          // ecobee wants the cool setpoint above the heat one.
          coolHoldTemp: Math.max(coolTemp, heatTemp + snapshot.heatCoolMinDelta),
          ...vacationWindow(snapshot.thermostatTime, Math.max(1, Math.round(Number(days) || 1))),
          fan: 'auto',
          fanMinOnTime: '0',
        },
      },
    ],
  };
}

/** Delete every vacation of the thermostat (running or planned). */
export function cancelVacationCommand(snapshot) {
  if (snapshot.vacations.length === 0) {
    throw new CommandError(TEXT.noVacation);
  }
  return {
    functions: snapshot.vacations.map((name) => ({ type: 'deleteVacation', params: { name } })),
  };
}

/**
 * What a sent update changes on the snapshot, applied at once: the widget is
 * reloaded as soon as its button resolves, seconds before the next reading,
 * and a second tap on "+" must start from the new setpoint.
 * @param {object} snapshot modified in place
 * @param {object} update what was sent
 */
export function applyUpdate(snapshot, update) {
  const mode = update.thermostat?.settings?.hvacMode;
  if (mode) {
    snapshot.hvacMode = mode;
  }
  for (const { type, params = {} } of update.functions ?? []) {
    if (type === 'resumeProgram') {
      snapshot.override = { kind: 'none' };
    } else if (type === 'createVacation') {
      snapshot.vacations = [...snapshot.vacations, params.name];
      snapshot.override = {
        kind: 'vacation',
        name: params.name,
        endDate: params.endDate,
        endTime: params.endTime,
      };
    } else if (type === 'deleteVacation') {
      snapshot.vacations = snapshot.vacations.filter((name) => name !== params.name);
      if (snapshot.override.kind === 'vacation' && snapshot.override.name === params.name) {
        snapshot.override = { kind: 'none' };
      }
    } else if (type === 'setHold') {
      if (params.heatHoldTemp !== undefined) snapshot.desiredHeat = params.heatHoldTemp;
      if (params.coolHoldTemp !== undefined) snapshot.desiredCool = params.coolHoldTemp;
      if (params.fan) snapshot.fanMode = params.fan;
      snapshot.override = params.holdClimateRef
        ? {
            kind: 'climate',
            climateRef: params.holdClimateRef,
            indefinite: params.holdType === 'indefinite',
          }
        : { kind: 'temperature', indefinite: params.holdType === 'indefinite' };
    }
  }
}

/**
 * The command of a feature written from Gladys.
 * @returns {object|null} the update to send, null when nothing changes
 */
export function featureCommand(snapshot, featureKey, value, config) {
  switch (featureKey) {
    case THERMOSTAT_FEATURE.HEAT_SETPOINT:
      return setpointCommand(snapshot, 'heat', value, config);
    case THERMOSTAT_FEATURE.COOL_SETPOINT:
      return setpointCommand(snapshot, 'cool', value, config);
    case THERMOSTAT_FEATURE.MODE:
      return modeCommand(snapshot, value);
    case THERMOSTAT_FEATURE.AUX_HEAT:
      return auxHeatCommand(snapshot, value);
    case THERMOSTAT_FEATURE.FAN:
      return fanCommand(snapshot, value, config);
    case THERMOSTAT_FEATURE.PRESET:
      return presetCommand(snapshot, value, config);
    default:
      throw new CommandError(TEXT.modeUnsupported);
  }
}
