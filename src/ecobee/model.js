// -----------------------------------------------------------------------------
// From the raw thermostat object of the API to a plain snapshot, and the unit
// conversions. Pure functions: no network, no Gladys.
//
// Facts of the API this module relies on (ecobee API documentation, the
// fixtures of Home Assistant and python-ecobee-api):
// - every temperature is in tenths of °F (`actualTemperature: 712` = 71.2 °F),
//   setpoints included, and -5002 (unknown) / -5003 (calibrating) mean "no
//   value"; the remote sensors give the same tenths as strings ("712"), or
//   "unknown";
// - `settings.useCelsius` says which unit the thermostat displays;
// - `events` lists the holds, vacations and utility events in priority
//   order: the first running one is the one in effect; without any, the
//   program (`program.currentClimateRef`) runs;
// - `equipmentStatus` is a comma-separated list of what runs right now
//   ("heatPump,auxHeat1,fan"), empty when idle.
// -----------------------------------------------------------------------------

/** Values ecobee uses for "no reading". */
const UNKNOWN_READINGS = new Set([-5002, -5003]);

// The default ranges of the ecobee settings, in tenths of °F, for a thermostat
// object that does not carry them (the fixtures of Home Assistant do not).
const DEFAULT_HEAT_RANGE = [450, 920];
const DEFAULT_COOL_RANGE = [650, 920];
const DEFAULT_HEAT_COOL_DELTA = 50;

const HEATING_EQUIPMENT = new Set([
  'heatPump',
  'heatPump2',
  'heatPump3',
  'auxHeat1',
  'auxHeat2',
  'auxHeat3',
]);
const COOLING_EQUIPMENT = new Set(['compCool1', 'compCool2']);

/** The ecobee HVAC modes. */
export const HVAC_MODES = ['off', 'heat', 'cool', 'auto', 'auxHeatOnly'];

/** The three comfort settings every ecobee program has. */
export const STANDARD_CLIMATES = ['home', 'away', 'sleep'];

/** The commercial names of the model numbers (Home Assistant's table). */
export const MODEL_NAMES = {
  idtSmart: 'ecobee Smart',
  idtEms: 'ecobee Smart EMS',
  siSmart: 'ecobee Si Smart',
  siEms: 'ecobee Si EMS',
  athenaSmart: 'ecobee3',
  athenaEms: 'ecobee3 EMS',
  corSmart: 'Carrier/Bryant Cor',
  nikeSmart: 'ecobee3 lite',
  nikeEms: 'ecobee3 lite EMS',
  apolloSmart: 'ecobee4',
  vulcanSmart: 'ecobee SmartThermostat with voice control',
  aresSmart: 'ecobee Smart Thermostat Premium',
  artemisSmart: 'ecobee Smart Thermostat Enhanced',
  attisRetail: 'ecobee Smart Thermostat Essential',
  attisPro: 'ecobee Smart Thermostat Lite',
};

/** A reading in tenths of °F, or null when ecobee has none. */
export function tenths(value) {
  if (value === null || value === undefined || value === '' || value === 'unknown') {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || UNKNOWN_READINGS.has(number)) {
    return null;
  }
  return number;
}

const round = (value, step) => Math.round(value / step) * step;
const clean = (value) => Number(value.toFixed(2));

/**
 * Tenths of °F in the unit of the features.
 * @param {number|null} value tenths of °F
 * @param {'celsius'|'fahrenheit'} unit
 * @param {number} step the resolution of the result (0.1 for a reading,
 *   0.5 °C or 1 °F for a setpoint, like the ecobee screen)
 */
export function fromTenths(value, unit, step = 0.1) {
  if (value === null || value === undefined) {
    return null;
  }
  const fahrenheit = value / 10;
  const converted = unit === 'celsius' ? ((fahrenheit - 32) * 5) / 9 : fahrenheit;
  return clean(round(converted, step));
}

/** A temperature in the unit of the features, in tenths of °F for the API. */
export function toTenths(value, unit) {
  const fahrenheit = unit === 'celsius' ? (Number(value) * 9) / 5 + 32 : Number(value);
  return Math.round(fahrenheit * 10);
}

/** The setpoint resolution of the thermostat screen, in the feature unit. */
export const setpointStep = (unit) => (unit === 'celsius' ? 0.5 : 1);

const asBoolean = (value) => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
};

/** A key safe in an external id: letters, digits, dashes. */
export const safeKey = (value) =>
  String(value)
    .trim()
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** "2026-10-14" + "18:00:00" → a comparable timestamp (thermostat wall clock, as UTC). */
function wallClock(date, time = '00:00:00') {
  if (!date) {
    return null;
  }
  const value = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  return Number.isFinite(value) ? value : null;
}

const YEAR_MS = 365 * 24 * 3600 * 1000;

/**
 * What overrides the program right now, from the first running event.
 * @returns {{ kind: 'none'|'climate'|'temperature'|'vacation'|'other', type?: string,
 *   name?: string, climateRef?: string, endDate?: string, endTime?: string, indefinite?: boolean }}
 */
export function activeOverride(events = []) {
  const event = events.find((candidate) => candidate && candidate.running === true);
  if (!event) {
    return { kind: 'none' };
  }
  const start = wallClock(event.startDate, event.startTime);
  const end = wallClock(event.endDate, event.endTime);
  // Undocumented: an indefinite hold ends years later (Home Assistant's heuristic).
  const indefinite = start !== null && end !== null && end - start > YEAR_MS;
  const common = {
    type: event.type,
    name: event.name,
    endDate: event.endDate,
    endTime: event.endTime,
    indefinite,
  };
  if (event.type === 'vacation') {
    return { kind: 'vacation', ...common };
  }
  if (event.type === 'hold') {
    return event.holdClimateRef
      ? { kind: 'climate', climateRef: event.holdClimateRef, ...common }
      : { kind: 'temperature', ...common };
  }
  return { kind: 'other', ...common };
}

/** The "what runs" list of equipmentStatus. */
export function equipmentOf(status) {
  return String(status ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 0 idle, 1 heating, 2 cooling (THERMOSTAT_OPERATING_STATE of Gladys). */
export function operatingState(equipment) {
  if (equipment.some((item) => HEATING_EQUIPMENT.has(item))) return 1;
  if (equipment.some((item) => COOLING_EQUIPMENT.has(item))) return 2;
  return 0;
}

function capabilityValue(sensor, type) {
  const capability = (sensor.capability ?? []).find((item) => item.type === type);
  return capability === undefined ? undefined : capability.value;
}

/** A remote (or built-in) sensor of the thermostat. */
function parseSensor(sensor) {
  const temperature = capabilityValue(sensor, 'temperature');
  const occupancy = capabilityValue(sensor, 'occupancy');
  const humidity = capabilityValue(sensor, 'humidity');
  return {
    id: String(sensor.id ?? ''),
    // The pairing code printed on the sensor is stable; the id ("rs:100")
    // is only unique within one thermostat.
    key: safeKey(sensor.code ?? sensor.id ?? sensor.name),
    code: sensor.code ?? null,
    name: String(sensor.name ?? sensor.id ?? 'Sensor'),
    type: sensor.type,
    inUse: sensor.inUse === true,
    hasTemperature: temperature !== undefined,
    temperature: tenths(temperature),
    hasOccupancy: occupancy !== undefined,
    occupancy: asBoolean(occupancy),
    hasHumidity: humidity !== undefined,
    humidity: humidity === undefined ? null : tenths(humidity),
  };
}

/**
 * The snapshot of one thermostat.
 * @param {object} raw an element of thermostatList
 */
export function parseThermostat(raw) {
  const runtime = raw.runtime ?? {};
  const settings = raw.settings ?? {};
  const program = raw.program ?? {};
  const sensors = (raw.remoteSensors ?? []).map(parseSensor);
  const own = sensors.find((sensor) => sensor.type === 'thermostat') ?? null;
  const equipment = equipmentOf(raw.equipmentStatus);
  const heatStages = Number(settings.heatStages ?? 0);
  const coolStages = Number(settings.coolStages ?? 0);
  const hasHeatPump = settings.hasHeatPump === true;
  const range = (low, high, fallback) => [
    tenths(settings[low]) ?? fallback[0],
    tenths(settings[high]) ?? fallback[1],
  ];
  const humidity = tenths(runtime.actualHumidity);

  return {
    id: String(raw.identifier),
    name: String(raw.name ?? raw.identifier),
    modelNumber: raw.modelNumber ?? null,
    modelName: MODEL_NAMES[raw.modelNumber] ?? 'ecobee',
    connected: runtime.connected !== false,
    useCelsius: settings.useCelsius === true,
    temperature: tenths(runtime.actualTemperature),
    humidity: humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null,
    desiredHeat: tenths(runtime.desiredHeat),
    desiredCool: tenths(runtime.desiredCool),
    hvacMode: HVAC_MODES.includes(settings.hvacMode) ? settings.hvacMode : 'off',
    fanMode: runtime.desiredFanMode === 'on' ? 'on' : 'auto',
    equipment,
    operatingState: operatingState(equipment),
    fanRunning: equipment.includes('fan'),
    canHeat: heatStages > 0 || hasHeatPump,
    canCool: coolStages > 0,
    hasHeatPump,
    // A heat pump has an auxiliary (emergency) heat source: "auxHeatOnly" is
    // a mode then (Home Assistant offers its switch on the same condition).
    hasAuxHeat: hasHeatPump,
    heatRange: range('heatRangeLow', 'heatRangeHigh', DEFAULT_HEAT_RANGE),
    coolRange: range('coolRangeLow', 'coolRangeHigh', DEFAULT_COOL_RANGE),
    heatCoolMinDelta: tenths(settings.heatCoolMinDelta) ?? DEFAULT_HEAT_COOL_DELTA,
    holdAction: settings.holdAction ?? 'nextTransition',
    thermostatTime: raw.thermostatTime ?? null,
    climates: (program.climates ?? []).map((climate) => ({
      ref: climate.climateRef,
      name: String(climate.name ?? climate.climateRef),
      isOccupied: climate.isOccupied !== false,
      heatTemp: tenths(climate.heatTemp),
      coolTemp: tenths(climate.coolTemp),
    })),
    currentClimateRef: program.currentClimateRef ?? null,
    override: activeOverride(raw.events),
    vacations: (raw.events ?? [])
      .filter((event) => event?.type === 'vacation')
      .map((event) => event.name),
    hasOccupancy: Boolean(own?.hasOccupancy),
    occupancy: own?.occupancy ?? null,
    sensors: sensors.filter((sensor) => sensor.type !== 'thermostat'),
    alerts: (raw.alerts ?? [])
      .filter((alert) => alert && alert.acknowledgeRef)
      .map((alert) => ({
        ref: String(alert.acknowledgeRef),
        text: String(alert.text ?? '').trim(),
        type: alert.alertType ?? null,
        notificationType: alert.notificationType ?? null,
        severity: alert.severity ?? null,
      })),
  };
}

/** The climate an ecobee ref names on this thermostat, if any. */
export const climateOf = (snapshot, ref) =>
  snapshot.climates.find((climate) => climate.ref === ref) ?? null;

/** The climate the thermostat aims for: the held one, else the program's. */
export function effectiveClimate(snapshot) {
  const ref =
    snapshot.override.kind === 'climate'
      ? snapshot.override.climateRef
      : snapshot.currentClimateRef;
  return climateOf(snapshot, ref) ?? (ref ? { ref, name: ref, isOccupied: ref !== 'away' } : null);
}

/**
 * Whether anybody is detected around the thermostat: its own sensor and the
 * remote ones. null when no sensor reports occupancy.
 */
export function homeOccupied(snapshot) {
  const readings = [
    snapshot.hasOccupancy ? snapshot.occupancy : undefined,
    ...snapshot.sensors.filter((sensor) => sensor.hasOccupancy).map((sensor) => sensor.occupancy),
  ].filter((value) => value === true || value === false);
  if (readings.length === 0) {
    return null;
  }
  return readings.includes(true);
}

/**
 * Hold parameters (setHold `holdType`, `holdHours`) for a duration choice.
 * @param {string} choice `next_transition` | `indefinite` | `hours_2` |
 *   `hours_4` | `thermostat` (the "hold action" set on the thermostat)
 * @param {object} snapshot
 */
export function holdParams(choice, snapshot) {
  const hoursMatch = /^hours_(\d+)$/.exec(choice ?? '');
  if (hoursMatch) {
    return { holdType: 'holdHours', holdHours: Number(hoursMatch[1]) };
  }
  if (choice === 'indefinite') {
    return { holdType: 'indefinite' };
  }
  if (choice === 'thermostat') {
    switch (snapshot.holdAction) {
      case 'useEndTime2hour':
        return { holdType: 'holdHours', holdHours: 2 };
      case 'useEndTime4hour':
        return { holdType: 'holdHours', holdHours: 4 };
      case 'indefinite':
        return { holdType: 'indefinite' };
      default:
        // nextPeriod, askMe: the app's own default.
        return { holdType: 'nextTransition' };
    }
  }
  return { holdType: 'nextTransition' };
}

/**
 * The heat and cool hold temperatures for a new setpoint, in tenths of °F.
 * In auto mode the cool setpoint must stay at least `heatCoolMinDelta` above
 * the heat one, so the other side moves when the gap is too small; in any
 * other mode ecobee advises to hold both at the same value.
 * @param {object} snapshot
 * @param {'heat'|'cool'} side
 * @param {number} value tenths of °F
 */
export function holdTemperatures(snapshot, side, value) {
  const clamp = (number, [low, high]) => Math.min(high, Math.max(low, number));
  if (snapshot.hvacMode !== 'auto') {
    const target = clamp(value, side === 'heat' ? snapshot.heatRange : snapshot.coolRange);
    return { heatHoldTemp: target, coolHoldTemp: target };
  }
  const delta = snapshot.heatCoolMinDelta;
  let heat = snapshot.desiredHeat ?? snapshot.heatRange[0];
  let cool = snapshot.desiredCool ?? snapshot.coolRange[1];
  if (side === 'heat') {
    heat = clamp(value, snapshot.heatRange);
    cool = Math.max(cool, heat + delta);
  } else {
    cool = clamp(value, snapshot.coolRange);
    heat = Math.min(heat, cool - delta);
  }
  return { heatHoldTemp: heat, coolHoldTemp: cool };
}

/**
 * Start and end of a vacation of `days` days from now, in the thermostat's
 * wall clock (thermostatTime: "2026-10-14 10:21:33").
 */
export function vacationWindow(thermostatTime, days, now = new Date()) {
  const parsed = thermostatTime ? Date.parse(`${thermostatTime.replace(' ', 'T')}Z`) : NaN;
  const start = Number.isFinite(parsed) ? new Date(parsed) : now;
  // Starting in a minute: a vacation that starts in the past is refused.
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  const end = new Date(start.getTime() + days * 24 * 3600 * 1000);
  const date = (value) => value.toISOString().slice(0, 10);
  const time = (value) => value.toISOString().slice(11, 19);
  return { startDate: date(start), startTime: time(start), endDate: date(end), endTime: time(end) };
}
