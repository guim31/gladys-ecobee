# ecobee fixtures

Responses of `GET https://api.ecobee.com/1/thermostat` (`thermostatList`), used
by the tests instead of the network.

- `home-assistant.json`: the fixture of the Home Assistant `ecobee`
  integration (`tests/components/ecobee/fixtures/ecobee-data.json`,
  Apache-2.0, home-assistant/core at commit `ffc459df`), copied as is. It is
  sparse (no `thermostatTime`, no ranges, no `useCelsius`) and mixes a string
  and a number `identifier`: the parser must cope.
- `heat-pump-fahrenheit.json`: an ecobee3 with a heat pump and auxiliary heat,
  in °F, a temperature hold until the next period, two remote sensors (one
  without a reading), a filter reminder alert. The field set follows the
  objects of the ecobee API documentation (Thermostat, Settings, Runtime,
  Event, Program, RemoteSensor, Alert).
- `premium-celsius.json`: an ecobee Smart Thermostat Premium in °C, auto mode,
  an indefinite Sleep hold, a vacation planned (not running), air quality
  capabilities the integration ignores.
- `lite-and-cool-only.json`: an ecobee3 lite heating only (switched off, no
  occupancy sensor) and a cooling-only thermostat offline from ecobee during
  a running vacation.

Identifiers, sensor codes and names are invented. Developed without the
hardware: these files are not captures of a real account.
