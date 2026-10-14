# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

### Added

- ecobee thermostats and SmartSensors in Gladys (5.2.0 or later), through the
  ecobee cloud.
- Sign-in with the email and password of the ecobee account, two-step
  verification by authenticator app or SMS included (“Enter the verification
  code” action), or with a developer API key and its PIN. The session is kept
  in `/data`, never the password.
- One device per thermostat: temperature, humidity, heat and cool setpoints,
  mode, auxiliary heat only (heat pumps), operating state, fan always on, fan
  running, comfort setting (schedule, Home, Away, Sleep), comfort setting in
  effect, hold in effect, occupancy.
- One device per remote sensor: temperature and occupancy.
- Commands from Gladys held until the next program change by default, like in
  the ecobee app; other durations in the configuration.
- Features in the unit of the thermostat (°F or °C), or the one chosen.
- Scene actions: resume the program, set a comfort setting for a duration,
  start a vacation, cancel the vacation.
- Scene triggers: somebody detected / nobody detected around a thermostat, new
  ecobee alert.
- Dashboard widget “ecobee thermostat”: temperature, setpoint lower and raise,
  mode and comfort setting.
- The integration reads ecobee by itself every 3 minutes (the pace ecobee asks
  for), configurable, and publishes only the changes.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-ecobee/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-ecobee/releases/tag/v1.0.1
