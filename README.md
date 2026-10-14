# ecobee for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings
**ecobee thermostats** and their **SmartSensors** (room sensors) into Gladys, through the ecobee
cloud: readings, setpoints, modes, comfort settings, holds, vacations, occupancy.

> **Developed without the hardware: feedback welcome.** The integration is built and tested
> against published answers of the ecobee API (the fixtures of Home Assistant and the objects of
> the ecobee API documentation), not against a real thermostat or account. Please report what
> works and what does not in the [issues](https://github.com/guim31/gladys-ecobee/issues).

## Features

- **Sign-in with the ecobee account** (email and password, like the ecobee app), two-step
  verification by authenticator app or SMS included. ecobee no longer issues developer API keys;
  a key you still have works too, with its PIN.
- **One device per thermostat**: indoor temperature and humidity, heat and cool setpoints, mode
  (off, heat, cool, auto), auxiliary heat only (heat pumps), operating state (idle, heating,
  cooling), fan always on, fan running, comfort setting (schedule, Home, Away, Sleep), the comfort
  setting in effect, the hold in effect (until when), and the thermostat's occupancy sensor.
- **One device per remote sensor**: temperature and occupancy.
- **Commands**: setpoint, mode, fan, comfort setting, resume the program. A change made from
  Gladys is a hold **until the next program change** by default, like in the ecobee app.
- **Units**: the features follow the unit shown by the thermostat (°F or °C), or the one you
  choose; Gladys also converts the readings to each user's unit.
- **Gladys 5.2 thermostat**: the features use the core's thermostat category (target
  temperature, mode, preset, operating state), so the Gladys thermostat can drive an ecobee as an
  external thermostat.
- **Scene actions**: resume the program, set a comfort setting for a duration, start a vacation,
  cancel the vacation.
- **Scene triggers**: somebody detected / nobody detected around a thermostat (all its sensors),
  new ecobee alert (filter reminder, maintenance...).
- **Dashboard widget** "ecobee thermostat": temperature, setpoint lower/raise, mode and comfort
  setting forms.

## Requirements

- Gladys Assistant **5.2.0** or later (thermostat preset feature, widget button forms).
- An ecobee account with at least one thermostat (ecobee3, ecobee3 lite, ecobee4, SmartThermostat,
  Premium, Enhanced, Essential...), connected to the internet.

## Installation

1. In Gladys, open **Integrations**, then **Install from GitHub**, and give
   `https://github.com/guim31/gladys-ecobee` (or install **ecobee** from the catalog once it is
   listed).
2. In the **Configuration** tab, enter the email and password of your ecobee account and save.
   If your account uses two-step verification, run the **Enter the verification code** action.
3. Open the **Discovery** tab and add the thermostats and sensors.

The user guide is in [`docs/en.md`](docs/en.md) ([fr](docs/fr.md), [de](docs/de.md),
[es](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- **Sign-in**: the same Auth0 universal login as the ecobee web portal (`auth.ecobee.com`,
  authorization code + PKCE, the portal's public client id), as `python-ecobee-api` 0.4.4 and Home
  Assistant do. The refresh token is kept in `/data/ecobee-session.json` (never the password) and
  renews the one-hour access token. If ecobee ends the session, the integration signs in again
  with the stored password, unless the account asks for a verification code.
- **Reading**: one request (`GET /1/thermostat`, every thermostat of the account) every
  `refresh_minutes` (3 minimum, the pace ecobee asks for), plus one a few seconds after a
  command. The integration runs its own timer: the core's polling is a fallback only
  (GladysAssistant/Gladys#3198). Only changed values are published, every value at least every
  6 hours.
- **Commands**: `setHold` (setpoints with both heat and cool temperatures, the fan with the
  current setpoints, comfort settings), `resumeProgram`, `createVacation` / `deleteVacation`, and
  `settings.hvacMode`.

## Limitations

- The account sign-in follows the ecobee web portal: a change of its login pages can break it
  until an update. Two-step verification by push notification or email link is not supported.
- Readings every 3 minutes at best: occupancy and operating state lag accordingly.
- Not supported: humidifier, dehumidifier and ventilator settings, comfort setting sensors, air
  quality, weather, program editing.
- Developed without the hardware or an account (see above).

## Development

```bash
npm install
npm test              # node --test, against the SDK's fake Gladys and a fake ecobee
npm run lint
npm run format:check
npm run probe         # a real sign-in attempt, read-only (see scripts/probe.mjs)
```

`scripts/probe.mjs` tries the real client against ecobee: with the fake account it uses by
default, ecobee must refuse it cleanly; with `ECOBEE_EMAIL` / `ECOBEE_PASSWORD` (and
`ECOBEE_MFA_CODE` if needed) it signs in and reads the thermostats, read-only, printing no secret
and no name.

Releases are made by the **Release** workflow (Actions → Release); never edit the versions by
hand. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [python-ecobee-api](https://github.com/nkgilley/python-ecobee-api) by Nolan Gilley and
  contributors (MIT): the Auth0 sign-in steps (identifier, password, MFA challenges, PKCE), the
  public client of the ecobee web portal, the thermostat functions.
- Home Assistant's [`ecobee`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/ecobee)
  integration (Apache-2.0): the mapping of modes, presets, holds and equipment status, the
  3-minute pace, the fan hold carrying the setpoints, and the fixture
  `test/fixtures/ecobee/home-assistant.json`.
- The ecobee API documentation (developer.ecobee.com).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by ecobee. "ecobee" is a trademark of
its owner.

## License

Apache-2.0
