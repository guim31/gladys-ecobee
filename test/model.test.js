// -----------------------------------------------------------------------------
// The snapshot of the thermostat object, the conversions, and the mapping to
// the Gladys features (src/ecobee/model.js, src/devices.js), on the fixtures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, unitFor } from '../src/config.js';
import { holdText, presetOf } from '../src/devices.js';
import {
  activeOverride,
  effectiveClimate,
  fromTenths,
  holdParams,
  holdTemperatures,
  homeOccupied,
  operatingState,
  equipmentOf,
  parseThermostat,
  tenths,
  toTenths,
  vacationWindow,
} from '../src/ecobee/model.js';
import { FIXTURES } from './helpers/fakeEcobee.js';

const parse = (fixture, index = 0) => parseThermostat(FIXTURES[fixture].thermostatList[index]);

test('tenths of °F: the unknown and calibrating values are no reading', () => {
  assert.equal(tenths(712), 712);
  assert.equal(tenths('712'), 712);
  assert.equal(tenths(-5002), null);
  assert.equal(tenths(-5003), null);
  assert.equal(tenths('unknown'), null);
  assert.equal(tenths(undefined), null);
});

test('conversions: °F as is, °C rounded like the thermostat screen', () => {
  assert.equal(fromTenths(712, 'fahrenheit'), 71.2);
  assert.equal(fromTenths(712, 'celsius'), 21.8);
  assert.equal(fromTenths(707, 'celsius', 0.5), 21.5);
  assert.equal(fromTenths(700, 'fahrenheit', 1), 70);
  assert.equal(toTenths(21.5, 'celsius'), 707);
  assert.equal(toTenths(70, 'fahrenheit'), 700);
  // A round trip in °C lands on the same half degree.
  for (const celsius of [16, 18.5, 20, 21.5, 23, 26.5]) {
    assert.equal(fromTenths(toTenths(celsius, 'celsius'), 'celsius', 0.5), celsius);
  }
});

test('heat pump in °F: readings, capabilities, temperature hold, aux heat running', () => {
  const snapshot = parse('heat-pump-fahrenheit');
  assert.equal(snapshot.id, '411900000101');
  assert.equal(snapshot.modelName, 'ecobee3');
  assert.equal(snapshot.temperature, 668);
  assert.equal(snapshot.humidity, 41);
  assert.equal(snapshot.hvacMode, 'heat');
  assert.deepEqual([snapshot.canHeat, snapshot.canCool, snapshot.hasAuxHeat], [true, true, true]);
  assert.deepEqual(snapshot.heatRange, [450, 790]);
  assert.equal(snapshot.operatingState, 1);
  assert.equal(snapshot.fanRunning, true);
  assert.equal(snapshot.override.kind, 'temperature');
  assert.equal(snapshot.override.indefinite, false);
  assert.equal(snapshot.hasOccupancy, true);
  assert.equal(snapshot.occupancy, false);
  assert.equal(snapshot.sensors.length, 2);
  assert.deepEqual(
    snapshot.sensors.map((sensor) => sensor.key),
    ['QX4T', 'PL7K'],
  );
  assert.equal(snapshot.sensors[1].temperature, null, 'an "unknown" reading');
  assert.equal(snapshot.alerts[0].notificationType, 'hvac');
  assert.equal(homeOccupied(snapshot), true, 'the bedroom sensor detects somebody');
  assert.equal(unitFor(normalizeConfig(), snapshot), 'fahrenheit');
});

test('Premium in °C: auto mode, indefinite Sleep hold, a planned vacation not in effect', () => {
  const snapshot = parse('premium-celsius');
  assert.equal(snapshot.useCelsius, true);
  assert.equal(snapshot.hvacMode, 'auto');
  assert.equal(snapshot.override.kind, 'climate');
  assert.equal(snapshot.override.climateRef, 'sleep');
  assert.equal(snapshot.override.indefinite, true);
  assert.equal(effectiveClimate(snapshot).name, 'Sommeil');
  assert.deepEqual(snapshot.vacations, ['Ski trip']);
  assert.equal(snapshot.operatingState, 0, 'the fan alone is not heating');
  assert.equal(snapshot.fanMode, 'on');
  assert.equal(snapshot.hasAuxHeat, false);
  assert.equal(unitFor(normalizeConfig(), snapshot), 'celsius');
  assert.equal(
    unitFor(normalizeConfig({ temperature_unit: 'fahrenheit' }), snapshot),
    'fahrenheit',
  );
});

test('heating-only lite (off, no occupancy) and cooling-only (offline, vacation)', () => {
  const lite = parse('lite-and-cool-only', 0);
  assert.deepEqual([lite.canHeat, lite.canCool, lite.hasOccupancy], [true, false, false]);
  assert.equal(lite.override.kind, 'none');
  assert.equal(homeOccupied(lite), null, 'no sensor reports occupancy');
  const cool = parse('lite-and-cool-only', 1);
  assert.deepEqual([cool.canHeat, cool.canCool], [false, true]);
  assert.equal(cool.connected, false);
  assert.equal(cool.override.kind, 'vacation');
  assert.equal(cool.operatingState, 2);
});

test('the sparse fixture of Home Assistant parses, number identifiers included', () => {
  const snapshots = FIXTURES['home-assistant'].thermostatList.map(parseThermostat);
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.id),
    ['8675309', '8675308', '8675307'],
  );
  assert.equal(snapshots[0].override.kind, 'climate');
  assert.equal(snapshots[0].override.climateRef, 'away');
  // "away" is not among the climates of this fixture: still an Away preset.
  assert.equal(presetOf(snapshots[0]), 2);
  assert.equal(snapshots[2].humidity, null, 'no actualHumidity');
  assert.equal(snapshots[0].sensors[0].key, 'WKRP');
});

test('equipment: heating wins, then cooling, else idle', () => {
  assert.equal(operatingState(equipmentOf('heatPump,auxHeat1,fan')), 1);
  assert.equal(operatingState(equipmentOf('compCool2,fan')), 2);
  assert.equal(operatingState(equipmentOf('fan,humidifier')), 0);
  assert.equal(operatingState(equipmentOf('')), 0);
});

test('the first running event is the one in effect', () => {
  assert.equal(activeOverride([]).kind, 'none');
  assert.equal(activeOverride([{ type: 'vacation', running: false }]).kind, 'none');
  assert.equal(activeOverride([{ type: 'demandResponse', running: true }]).kind, 'other');
  const override = activeOverride([
    { type: 'hold', running: false, holdClimateRef: 'home' },
    {
      type: 'hold',
      running: true,
      holdClimateRef: '',
      startDate: '2026-10-14',
      startTime: '10:00:00',
      endDate: '2035-01-01',
      endTime: '00:00:00',
    },
  ]);
  assert.deepEqual([override.kind, override.indefinite], ['temperature', true]);
});

test('the Gladys preset: schedule, held comfort, vacation, custom comfort settings', () => {
  const base = parse('heat-pump-fahrenheit');
  assert.equal(presetOf({ ...base, override: { kind: 'none' } }), 0);
  assert.equal(presetOf({ ...base, override: { kind: 'climate', climateRef: 'sleep' } }), 4);
  assert.equal(presetOf({ ...base, override: { kind: 'climate', climateRef: 'home' } }), 5);
  assert.equal(presetOf({ ...base, override: { kind: 'vacation' } }), 2);
  // An occupied custom comfort setting reads as comfort, a temperature hold as the program's.
  assert.equal(presetOf({ ...base, override: { kind: 'climate', climateRef: 'smart1' } }), 5);
  assert.equal(presetOf(base), 5);
});

test('the hold text, in the language of the configuration', () => {
  const base = parse('heat-pump-fahrenheit');
  assert.equal(holdText(base, 'en'), 'Hold until 8:30 AM');
  assert.equal(holdText(base, 'fr'), 'Maintien jusqu’à 08:30');
  assert.equal(holdText({ ...base, override: { kind: 'none' } }, 'de'), 'Zeitplan');
  assert.equal(holdText(parse('premium-celsius'), 'es'), 'Mantenido sin límite');
  assert.match(holdText(parse('lite-and-cool-only', 1), 'en'), /^Vacation until Oct 18/);
});

test('hold durations: the configuration, or the hold action of the thermostat', () => {
  const snapshot = parse('lite-and-cool-only');
  assert.deepEqual(holdParams('next_transition', snapshot), { holdType: 'nextTransition' });
  assert.deepEqual(holdParams('indefinite', snapshot), { holdType: 'indefinite' });
  assert.deepEqual(holdParams('hours_4', snapshot), { holdType: 'holdHours', holdHours: 4 });
  assert.deepEqual(holdParams('thermostat', snapshot), { holdType: 'holdHours', holdHours: 2 });
  assert.deepEqual(holdParams('thermostat', parse('premium-celsius')), { holdType: 'indefinite' });
  assert.deepEqual(
    holdParams('thermostat', parse('lite-and-cool-only', 1)),
    { holdType: 'nextTransition' },
    'askMe',
  );
});

test('hold temperatures: equal in heat mode, the gap kept in auto, clamped to the ranges', () => {
  const heat = parse('heat-pump-fahrenheit');
  assert.deepEqual(holdTemperatures(heat, 'heat', 720), { heatHoldTemp: 720, coolHoldTemp: 720 });
  assert.deepEqual(holdTemperatures(heat, 'heat', 900), { heatHoldTemp: 790, coolHoldTemp: 790 });
  const auto = parse('premium-celsius'); // heat 644, cool 770, delta 40
  assert.deepEqual(holdTemperatures(auto, 'heat', 700), { heatHoldTemp: 700, coolHoldTemp: 770 });
  assert.deepEqual(holdTemperatures(auto, 'heat', 750), { heatHoldTemp: 750, coolHoldTemp: 790 });
  assert.deepEqual(holdTemperatures(auto, 'cool', 660), { heatHoldTemp: 620, coolHoldTemp: 660 });
});

test('a vacation window starts a minute from the thermostat clock', () => {
  assert.deepEqual(vacationWindow('2026-10-14 22:15:30', 3), {
    startDate: '2026-10-14',
    startTime: '22:16:00',
    endDate: '2026-10-17',
    endTime: '22:16:00',
  });
  const fallback = vacationWindow(null, 1, new Date('2026-12-31T23:59:30Z'));
  assert.deepEqual([fallback.startDate, fallback.endDate], ['2027-01-01', '2027-01-02']);
});
