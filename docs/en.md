# ecobee

## 1. Overview

This integration brings your **ecobee thermostats** and their **SmartSensors** (room sensors) into
Gladys: temperature, humidity, heat and cool setpoints, mode, comfort setting (Home / Away /
Sleep), holds, what the equipment is doing, and occupancy. You can change the setpoint, the
mode, the fan and the comfort setting from Gladys, resume the program, and start or cancel a
vacation from a scene.

It talks to the ecobee cloud, like the ecobee app: the thermostat needs an internet connection.

> Developed without the hardware: feedback welcome. This integration is not affiliated with
> ecobee.

## 2. Requirements

- Gladys Assistant **5.2.0** or later.
- An ecobee account (the one of the ecobee app) with at least one thermostat.
- If your account uses two-step verification: your authenticator app, or your phone for the SMS
  code. Push notifications and email links are not supported.
- Optional: a **developer API key**, if you still have one (ecobee stopped issuing them in 2024).

## 3. Configuration

Install the integration from the Gladys integration store, then open its **Configuration** tab.

**Sign in with your ecobee account (recommended)**

1. Enter the **email** and **password** you use in the ecobee app, and save.
2. Without two-step verification, the status turns green and the thermostats appear in the
   **Discovery** tab.
3. With two-step verification, the status asks for the code: run the **Enter the verification
   code** action with the 6-digit code of your authenticator app, or of the SMS ecobee just sent
   (within 10 minutes).

The integration then keeps a session (refresh token) in its `/data` volume and renews it by
itself. The password stays in the Gladys configuration; it is used again only if ecobee ends the
session. **Sign in and test** reads the thermostats and tells how many were found. **Sign out**
deletes the stored session.

**With a developer API key (optional)**

Enter the key in **API key** and save (it replaces the email and password). Run **Get a PIN**: on
ecobee.com, open **My Apps**, **Add application**, and enter the PIN within its validity. The
integration notices the authorization by itself.

**Settings**

- **Temperature unit**: the unit of the features: the one shown by the thermostat (default),
  Celsius or Fahrenheit. Gladys also converts the readings to each user's preferred unit.
- **Hold changes made from Gladys**: a setpoint or a comfort setting changed from Gladys is a
  _hold_, like in the ecobee app. By default it lasts **until the next program change**; you can
  choose until changed, 2 hours, 4 hours, or the hold action set on the thermostat.
- **Refresh interval**: how often ecobee is read, 3 minutes minimum.
- **Language of the feature names**: names given to the features when a device is added.

Then add the devices from the **Discovery** tab.

## 4. Devices

**One device per thermostat**

| Feature                 | What it is                                                                    |
| ----------------------- | ----------------------------------------------------------------------------- |
| Temperature, Humidity   | indoor readings of the thermostat                                             |
| Heat setpoint           | target in heating (only if the thermostat drives heating)                     |
| Cool setpoint           | target in cooling (only if it drives cooling)                                 |
| Mode                    | off, heat, cool, auto (the options depend on the equipment)                   |
| Auxiliary heat only     | heat pumps only: the auxiliary heat runs alone (emergency heat)               |
| Operating state         | idle, heating, cooling                                                        |
| Fan always on           | on: the fan runs continuously; off: automatic                                 |
| Fan running             | the fan runs right now                                                        |
| Comfort setting         | schedule (follow the program), Home, Away, Sleep — writing it sets a hold     |
| Current comfort setting | the name of the comfort setting in effect, custom ones included               |
| Hold                    | the override in effect: schedule, hold until a time, permanent hold, vacation |
| Occupancy               | the thermostat's own occupancy sensor (not on the ecobee3 lite)               |

Writing **Schedule** (value 0) on the comfort setting resumes the program: every hold is
cancelled, and a running vacation too. In auto mode the cool setpoint is kept at least the
thermostat's minimum gap above the heat setpoint.

**One device per remote sensor** (SmartSensor, room sensor): temperature and occupancy.

The thermostat features use the core's thermostat category: the **thermostat** of Gladys 5.2 can
drive an ecobee as an _external_ thermostat (pick the heat setpoint as its target and the mode as
its mode feature).

## 5. Dashboard widget

Add the **ecobee thermostat** widget and choose a thermostat. It shows the temperature, the
setpoint(s) and the humidity as live tiles, the mode, what runs, the comfort setting and the
hold, and four buttons:

- **Lower** / **Raise**: one step of the setpoint (0.5 °C or 1 °F); in auto, both setpoints move
  together. Hidden when the thermostat is off.
- **Mode**: a list of the thermostat's modes.
- **Comfort**: schedule, Home, Away, Sleep.

## 6. Scene triggers

- **ecobee: somebody detected** (`home_occupied`): nobody was detected around a thermostat (the
  thermostat and its sensors), now somebody is. Variables: thermostat name, sensors that detect
  somebody.
- **ecobee: nobody detected** (`home_vacant`): no sensor of the thermostat detects anybody any
  more.
- **ecobee: new alert** (`alert`): the thermostat raised an alert or a reminder (filter change,
  maintenance, temperature out of range…). Variables: thermostat name, text, type.

The occupancy of each sensor is also a device feature: use the usual "device value" trigger for a
single room. These triggers add what a single feature cannot say: the whole home.

## 7. Scene actions

- **ecobee: resume the program** (`resume_program`): cancels every hold and the running vacation.
- **ecobee: set a comfort setting** (`set_comfort`): holds Home, Away or Sleep for a chosen
  duration (the configuration's, until the next program change, until changed, 2 or 4 hours).
- **ecobee: start a vacation** (`start_vacation`): starts an ecobee vacation now for a number of
  days; without setpoints, those of the Away comfort setting. Output: the end date.
- **ecobee: cancel the vacation** (`cancel_vacation`): deletes the running and planned vacations.

The setpoint, the mode and the fan are set with the core's "Control a device" action. A remote
sensor chosen in an action stands for its thermostat.

## 8. Scene examples

- **Everybody left**: when the alarm is armed, run _set a comfort setting_ Away, until changed;
  when it is disarmed, run _resume the program_.
- **Filter reminder**: on _new alert_, send a message "{{triggerEvent.data.text}}".
- **Window open**: when an opening sensor reports open for 5 minutes, set the **Mode** to off;
  when it closes, set it back to heat.
- **Long trip**: from the calendar, run _start a vacation_ for 10 days.

## 9. Refresh and API limits

ecobee asks API clients not to read the thermostats more often than **every 3 minutes**. The
integration reads all your thermostats in one request every _Refresh interval_ (3 minutes by
default), plus one reading a few seconds after a command to show its effect. Only the values that
change are sent to Gladys, and every value at least every 6 hours. The integration refreshes by
itself and does not depend on the Gladys polling.

## 10. Troubleshooting

- **"ecobee refused the email or the password"**: check them in the ecobee app; the integration
  never retries a refused password by itself, save the configuration again.
- **The status asks for a verification code**: run _Enter the verification code_. An SMS code
  is valid about 10 minutes; past that, the action triggers a new SMS.
- **"ecobee asks for a step in a browser"**: sign in once on ecobee.com (new terms of use…), then
  save the configuration again.
- **"ecobee does not answer"**: an internet or ecobee outage; the integration retries every
  refresh interval.
- **A thermostat is offline**: it lost its connection to ecobee; its last values stay, commands
  are refused until it is back.
- Logs: the integration logs its sign-in and the problems once; `LOG_LEVEL=debug` shows every
  reading.

## 11. Limitations

- The account sign-in uses the same login page as the ecobee web portal, like Home Assistant: if
  ecobee changes it, the sign-in may break until an update.
- Two-step verification by push notification or email link is not supported.
- Readings are at most every 3 minutes: occupancy and the operating state are not instantaneous.
- Not supported: humidifier, dehumidifier and ventilator settings, the sensors of a comfort
  setting, air quality, weather, and the thermostat's own program editing.
- The feature names are fixed when a device is added to Gladys.
- Developed without the hardware or an ecobee account: tested against the published API
  responses only. Feedback welcome.
