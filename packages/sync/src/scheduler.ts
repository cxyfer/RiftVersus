import { Cron, CronPattern } from "croner";

export interface ScheduleHandle {
  readonly running: boolean;
  stop(): void;
}

export interface ScheduleOptions {
  cron: string;
  timezone: string;
  run(): Promise<unknown>;
  onError?(error: unknown): void;
  createSchedule?(cron: string, timezone: string, callback: () => void): { stop(): void };
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid scheduler timezone: ${timezone}`);
  }
}

function defaultSchedule(cron: string, timezone: string, callback: () => void): { stop(): void } {
  return new Cron(cron, { timezone, protect: true }, callback);
}

export function scheduleSync(options: ScheduleOptions): ScheduleHandle {
  validateTimezone(options.timezone);
  new CronPattern(options.cron, options.timezone);
  let running = false;
  let stopped = false;
  const tick = () => {
    if (running || stopped) return;
    running = true;
    let result: Promise<unknown>;
    try {
      result = options.run();
    } catch (error) {
      options.onError?.(error);
      running = false;
      return;
    }
    void result
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => { running = false; });
  };
  const schedule = (options.createSchedule ?? defaultSchedule)(options.cron, options.timezone, tick);
  return {
    get running() { return running; },
    stop() {
      if (stopped) return;
      stopped = true;
      schedule.stop();
    },
  };
}
