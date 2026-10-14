// -----------------------------------------------------------------------------
// The scene actions (manifest `scene_actions`). What a feature cannot say:
// a comfort setting held for a chosen time, a vacation, back to the program
// with every hold cancelled. The setpoint, the mode and the fan stay device
// features, set from a scene with the core's "control a device" action.
//
// Every action takes a `thermostat` field (source: devices): a remote sensor
// picked there stands for its thermostat.
// -----------------------------------------------------------------------------

import {
  CommandError,
  cancelVacationCommand,
  climateCommand,
  resumeCommand,
  vacationCommand,
} from './commands.js';
import { vacationWindow } from './ecobee/model.js';
import { failure } from './i18n.js';

/** The durations the set_comfort action offers, `default` being the configuration's. */
export const COMFORT_DURATIONS = ['default', 'next_transition', 'indefinite', 'hours_2', 'hours_4'];

async function run(hub, fields, build) {
  const snapshot = hub.commandTarget(fields.thermostat);
  let update;
  try {
    update = build(snapshot);
  } catch (err) {
    throw err instanceof CommandError ? failure(err.text, hub.language) : err;
  }
  await hub.send(snapshot, update);
  return snapshot;
}

export const SCENE_ACTIONS = {
  async resume_program(hub, { fields }) {
    const snapshot = await run(hub, fields, (target) => resumeCommand(target));
    hub.logger.info(`Scene: resume the program of ${snapshot.name}`);
  },

  async set_comfort(hub, { fields }) {
    const duration =
      !fields.duration || fields.duration === 'default'
        ? hub.config.hold_duration
        : fields.duration;
    const snapshot = await run(hub, fields, (target) =>
      climateCommand(target, fields.comfort, duration),
    );
    hub.logger.info(`Scene: comfort setting ${fields.comfort} (${duration}) on ${snapshot.name}`);
  },

  async start_vacation(hub, { fields }) {
    const days = Math.max(1, Math.round(Number(fields.days) || 1));
    let end;
    const snapshot = await run(hub, fields, (target) => {
      const window = vacationWindow(target.thermostatTime, days);
      end = window.endDate;
      return vacationCommand(
        target,
        {
          days,
          heat: fields.heat_setpoint,
          cool: fields.cool_setpoint,
          // Unique per thermostat: ecobee refuses two vacations of one name.
          name: `Gladys ${window.startDate}`,
        },
        hub.config,
      );
    });
    hub.logger.info(`Scene: vacation of ${days} day(s) on ${snapshot.name}`);
    return { end_date: end };
  },

  async cancel_vacation(hub, { fields }) {
    const snapshot = await run(hub, fields, (target) => cancelVacationCommand(target));
    hub.logger.info(`Scene: vacation cancelled on ${snapshot.name}`);
  },
};
