// -----------------------------------------------------------------------------
// From the ecobee snapshots to the Gladys devices and their states.
//
// One device per thermostat, one per remote sensor (SmartSensor, room
// sensor). The external ids are built on what ecobee gives for good: the
// thermostat identifier (its serial number), and the pairing code printed on
// a sensor (its id within the thermostat when it has none).
//
// The feature keys below are forever: Gladys keys the history, the scenes
// and the dashboards on them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { unitFor } from './config.js';
import { effectiveClimate, fromTenths, setpointStep, STANDARD_CLIMATES } from './ecobee/model.js';
import { HOLD_TEXT, LABELS, MESSAGES, NAMES, formatWhen, pick } from './i18n.js';

/** Feature keys of a thermostat. */
export const THERMOSTAT_FEATURE = {
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  HEAT_SETPOINT: 'heat_setpoint',
  COOL_SETPOINT: 'cool_setpoint',
  MODE: 'mode',
  AUX_HEAT: 'aux_heat',
  OPERATING_STATE: 'operating_state',
  FAN: 'fan',
  FAN_RUNNING: 'fan_running',
  PRESET: 'preset',
  COMFORT: 'comfort',
  HOLD: 'hold',
  OCCUPANCY: 'occupancy',
};

/** Feature keys of a remote sensor. */
export const SENSOR_FEATURE = {
  TEMPERATURE: 'temperature',
  OCCUPANCY: 'occupancy',
  HUMIDITY: 'humidity',
};

/** THERMOSTAT_MODE of Gladys, from and to the ecobee hvacMode. */
export const GLADYS_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };
const MODE_FROM_ECOBEE = { off: 0, heat: 1, auxHeatOnly: 1, cool: 2, auto: 3 };
export const ECOBEE_MODE = { 0: 'off', 1: 'heat', 2: 'cool', 3: 'auto' };

/** THERMOSTAT_PRESET of Gladys and the ecobee comfort settings. */
export const GLADYS_PRESET = { SCHEDULE: 0, AWAY: 2, NIGHT: 4, COMFORT: 5 };
export const CLIMATE_TO_PRESET = { home: 5, away: 2, sleep: 4 };
export const PRESET_TO_CLIMATE = { 5: 'home', 2: 'away', 4: 'sleep' };

// The core polls a device once a minute at most; the hub's own timer reads
// ecobee every refresh_minutes, and onPoll is only its fallback.
const POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

const TEMPERATURE_BOUNDS = { celsius: [-40, 60], fahrenheit: [-40, 140] };

export const thermostatIds = (gladys, snapshot) => gladys.externalIds('thermostat', snapshot.id);
export const sensorIds = (gladys, snapshot, sensor) =>
  gladys.externalIds('sensor', `${snapshot.id}-${sensor.key}`);

function feature(ids, key, name, spec) {
  return {
    name,
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...spec,
  };
}

/** The Gladys preset a snapshot is in, or null. */
export function presetOf(snapshot) {
  const { override } = snapshot;
  if (override.kind === 'none') {
    return GLADYS_PRESET.SCHEDULE;
  }
  if (override.kind === 'vacation') {
    return GLADYS_PRESET.AWAY;
  }
  const climate = effectiveClimate(snapshot);
  if (!climate) {
    return null;
  }
  return (
    CLIMATE_TO_PRESET[climate.ref] ??
    (climate.isOccupied ? GLADYS_PRESET.COMFORT : GLADYS_PRESET.AWAY)
  );
}

/** What the mode feature offers on this thermostat. */
function modeOptions(snapshot, labels) {
  const options = [{ value: GLADYS_MODE.OFF, label: labels.off }];
  if (snapshot.canHeat) options.push({ value: GLADYS_MODE.HEATING, label: labels.heat });
  if (snapshot.canCool) options.push({ value: GLADYS_MODE.COOLING, label: labels.cool });
  if (snapshot.canHeat && snapshot.canCool)
    options.push({ value: GLADYS_MODE.AUTO, label: labels.auto });
  return options;
}

/** What the preset feature offers: the program, and the standard comfort settings. */
function presetOptions(snapshot, labels) {
  const options = [{ value: GLADYS_PRESET.SCHEDULE, label: labels.schedule }];
  for (const ref of STANDARD_CLIMATES) {
    const climate = snapshot.climates.find((candidate) => candidate.ref === ref);
    if (climate) {
      options.push({ value: CLIMATE_TO_PRESET[ref], label: climate.name });
    }
  }
  return options;
}

/**
 * The Gladys device of a thermostat.
 * @param {object} gladys GladysIntegration
 * @param {object} snapshot src/ecobee/model.js parseThermostat
 * @param {object} config normalized config
 */
export function buildThermostatDevice(gladys, snapshot, config) {
  const ids = thermostatIds(gladys, snapshot);
  const names = NAMES[config.language];
  const labels = LABELS[config.language];
  const unit = unitFor(config, snapshot);
  const gladysUnit = unit === 'celsius' ? UNITS.CELSIUS : UNITS.FAHRENHEIT;
  const step = setpointStep(unit);
  const [low, high] = TEMPERATURE_BOUNDS[unit];
  const bounds = ([min, max]) => ({
    min: fromTenths(min, unit, step),
    max: fromTenths(max, unit, step),
  });
  const features = [
    feature(ids, THERMOSTAT_FEATURE.TEMPERATURE, names.temperature, {
      category: CATEGORIES.TEMPERATURE_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: gladysUnit,
      min: low,
      max: high,
    }),
  ];
  if (snapshot.humidity !== null) {
    features.push(
      feature(ids, THERMOSTAT_FEATURE.HUMIDITY, names.humidity, {
        category: CATEGORIES.HUMIDITY_SENSOR,
        type: TYPES.SENSOR.DECIMAL,
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
      }),
    );
  }
  if (snapshot.canHeat) {
    features.push(
      feature(ids, THERMOSTAT_FEATURE.HEAT_SETPOINT, names.heatSetpoint, {
        category: CATEGORIES.THERMOSTAT,
        type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
        unit: gladysUnit,
        ...bounds(snapshot.heatRange),
        step,
        read_only: false,
      }),
    );
  }
  if (snapshot.canCool) {
    features.push(
      feature(ids, THERMOSTAT_FEATURE.COOL_SETPOINT, names.coolSetpoint, {
        category: CATEGORIES.THERMOSTAT,
        type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
        unit: gladysUnit,
        ...bounds(snapshot.coolRange),
        step,
        read_only: false,
      }),
    );
  }
  const modes = modeOptions(snapshot, labels);
  features.push(
    feature(ids, THERMOSTAT_FEATURE.MODE, names.mode, {
      category: CATEGORIES.THERMOSTAT,
      type: TYPES.THERMOSTAT.MODE,
      min: 0,
      // A heating-only thermostat declares max 1: the core's thermostat
      // clamps the mode it writes to it (docs/specs/thermostat.md C.0).
      max: Math.max(...modes.map((option) => option.value)),
      read_only: false,
      supported_options: modes,
    }),
  );
  if (snapshot.hasAuxHeat) {
    features.push(
      feature(ids, THERMOSTAT_FEATURE.AUX_HEAT, names.auxHeat, {
        category: CATEGORIES.SWITCH,
        type: TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: false,
      }),
    );
  }
  features.push(
    feature(ids, THERMOSTAT_FEATURE.OPERATING_STATE, names.operatingState, {
      category: CATEGORIES.THERMOSTAT,
      type: TYPES.THERMOSTAT.OPERATING_STATE,
      min: 0,
      max: 2,
    }),
    feature(ids, THERMOSTAT_FEATURE.FAN, names.fan, {
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
    }),
    feature(ids, THERMOSTAT_FEATURE.FAN_RUNNING, names.fanRunning, {
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
    }),
    feature(ids, THERMOSTAT_FEATURE.PRESET, names.preset, {
      category: CATEGORIES.THERMOSTAT,
      type: TYPES.THERMOSTAT.PRESET,
      min: 0,
      max: 5,
      read_only: false,
      supported_options: presetOptions(snapshot, labels),
    }),
    // Texts have no history, and min/max are NOT NULL in the core (0/0).
    feature(ids, THERMOSTAT_FEATURE.COMFORT, names.comfort, {
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.TEXT,
      min: 0,
      max: 0,
      keep_history: false,
    }),
    feature(ids, THERMOSTAT_FEATURE.HOLD, names.hold, {
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.TEXT,
      min: 0,
      max: 0,
      keep_history: false,
    }),
  );
  if (snapshot.hasOccupancy) {
    features.push(
      feature(ids, THERMOSTAT_FEATURE.OCCUPANCY, names.occupancy, {
        category: CATEGORIES.PRESENCE_SENSOR,
        type: TYPES.SENSOR.BINARY,
        min: 0,
        max: 1,
      }),
    );
  }
  return {
    name: snapshot.name,
    external_id: ids.device,
    model: snapshot.modelName,
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    params: [{ name: 'ECOBEE_MODEL', value: String(snapshot.modelNumber ?? 'unknown') }],
    features,
  };
}

/** The Gladys device of a remote sensor, or null when it reports nothing usable. */
export function buildSensorDevice(gladys, snapshot, sensor, config) {
  const ids = sensorIds(gladys, snapshot, sensor);
  const names = NAMES[config.language];
  const unit = unitFor(config, snapshot);
  const [low, high] = TEMPERATURE_BOUNDS[unit];
  const features = [];
  if (sensor.hasTemperature) {
    features.push(
      feature(ids, SENSOR_FEATURE.TEMPERATURE, names.temperature, {
        category: CATEGORIES.TEMPERATURE_SENSOR,
        type: TYPES.SENSOR.DECIMAL,
        unit: unit === 'celsius' ? UNITS.CELSIUS : UNITS.FAHRENHEIT,
        min: low,
        max: high,
      }),
    );
  }
  if (sensor.hasOccupancy) {
    features.push(
      feature(ids, SENSOR_FEATURE.OCCUPANCY, names.occupancy, {
        category: CATEGORIES.PRESENCE_SENSOR,
        type: TYPES.SENSOR.BINARY,
        min: 0,
        max: 1,
      }),
    );
  }
  if (sensor.hasHumidity) {
    features.push(
      feature(ids, SENSOR_FEATURE.HUMIDITY, names.humidity, {
        category: CATEGORIES.HUMIDITY_SENSOR,
        type: TYPES.SENSOR.DECIMAL,
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
      }),
    );
  }
  if (features.length === 0) {
    return null;
  }
  return {
    name: sensor.name,
    external_id: ids.device,
    model: 'ecobee SmartSensor',
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    params: [{ name: 'ECOBEE_THERMOSTAT', value: snapshot.id }],
    features,
  };
}

/** Every device of the account. */
export function buildDevices(gladys, snapshots, config) {
  return snapshots.flatMap((snapshot) => [
    buildThermostatDevice(gladys, snapshot, config),
    ...snapshot.sensors
      .map((sensor) => buildSensorDevice(gladys, snapshot, sensor, config))
      .filter(Boolean),
  ]);
}

/** The text of the hold feature, in the configured language. */
export function holdText(snapshot, language) {
  const { override } = snapshot;
  const today = snapshot.thermostatTime ? snapshot.thermostatTime.slice(0, 10) : null;
  switch (override.kind) {
    case 'none':
      return pick(HOLD_TEXT.schedule, language);
    case 'vacation':
      return override.endDate
        ? pick(
            MESSAGES.vacationUntil(formatWhen(override.endDate, override.endTime, language, today)),
            language,
          )
        : pick(HOLD_TEXT.vacation, language);
    case 'climate':
    case 'temperature':
      if (override.indefinite) {
        return pick(HOLD_TEXT.indefinite, language);
      }
      if (!override.endDate) {
        return pick(HOLD_TEXT.hold, language);
      }
      return pick(
        MESSAGES.holdUntil(formatWhen(override.endDate, override.endTime, language, today)),
        language,
      );
    default:
      return pick(HOLD_TEXT.event, language);
  }
}

const state = (externalId, value) =>
  value === null || value === undefined
    ? null
    : { device_feature_external_id: externalId, state: value };
const text = (externalId, value) =>
  value ? { device_feature_external_id: externalId, text: String(value).slice(0, 255) } : null;
const bit = (value) => (value === null || value === undefined ? null : value ? 1 : 0);

/** The states of a thermostat device. */
export function thermostatStates(gladys, snapshot, config) {
  const ids = thermostatIds(gladys, snapshot);
  const unit = unitFor(config, snapshot);
  const step = setpointStep(unit);
  const id = (key) => ids.feature(key);
  const climate = effectiveClimate(snapshot);
  return [
    state(id(THERMOSTAT_FEATURE.TEMPERATURE), fromTenths(snapshot.temperature, unit)),
    state(id(THERMOSTAT_FEATURE.HUMIDITY), snapshot.humidity),
    snapshot.canHeat
      ? state(id(THERMOSTAT_FEATURE.HEAT_SETPOINT), fromTenths(snapshot.desiredHeat, unit, step))
      : null,
    snapshot.canCool
      ? state(id(THERMOSTAT_FEATURE.COOL_SETPOINT), fromTenths(snapshot.desiredCool, unit, step))
      : null,
    state(id(THERMOSTAT_FEATURE.MODE), MODE_FROM_ECOBEE[snapshot.hvacMode]),
    snapshot.hasAuxHeat
      ? state(id(THERMOSTAT_FEATURE.AUX_HEAT), bit(snapshot.hvacMode === 'auxHeatOnly'))
      : null,
    state(id(THERMOSTAT_FEATURE.OPERATING_STATE), snapshot.operatingState),
    state(id(THERMOSTAT_FEATURE.FAN), bit(snapshot.fanMode === 'on')),
    state(id(THERMOSTAT_FEATURE.FAN_RUNNING), bit(snapshot.fanRunning)),
    state(id(THERMOSTAT_FEATURE.PRESET), presetOf(snapshot)),
    text(id(THERMOSTAT_FEATURE.COMFORT), climate?.name),
    text(id(THERMOSTAT_FEATURE.HOLD), holdText(snapshot, config.language)),
    snapshot.hasOccupancy ? state(id(THERMOSTAT_FEATURE.OCCUPANCY), bit(snapshot.occupancy)) : null,
  ].filter(Boolean);
}

/** The states of a remote sensor device. */
export function sensorStates(gladys, snapshot, sensor, config) {
  const ids = sensorIds(gladys, snapshot, sensor);
  const unit = unitFor(config, snapshot);
  return [
    sensor.hasTemperature
      ? state(ids.feature(SENSOR_FEATURE.TEMPERATURE), fromTenths(sensor.temperature, unit))
      : null,
    sensor.hasOccupancy
      ? state(ids.feature(SENSOR_FEATURE.OCCUPANCY), bit(sensor.occupancy))
      : null,
    sensor.hasHumidity ? state(ids.feature(SENSOR_FEATURE.HUMIDITY), sensor.humidity) : null,
  ].filter(Boolean);
}

/** Every state of the account, devices created in Gladys or not. */
export function allStates(gladys, snapshots, config) {
  return snapshots.flatMap((snapshot) => [
    ...thermostatStates(gladys, snapshot, config),
    ...snapshot.sensors.flatMap((sensor) => sensorStates(gladys, snapshot, sensor, config)),
  ]);
}
