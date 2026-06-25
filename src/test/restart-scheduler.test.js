'use strict';

const HOUR_IN_MS = 60 * 60 * 1000;

function loadScheduler() {
  // Fresh require so RESTART_HOUR picks up test env.
  return require('../lib/restart-scheduler');
}

describe('restart-scheduler', () => {
  let exitSpy;
  const ORIGINAL_HOUR_ENV = process.env.DAILY_RESTART_HOUR_IN_UTC;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    delete process.env.DAILY_RESTART_HOUR_IN_UTC;
    // Capture process.exit to avoid tearing down the runner.
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    exitSpy.mockRestore();
    if (ORIGINAL_HOUR_ENV === undefined) {
      delete process.env.DAILY_RESTART_HOUR_IN_UTC;
    } else {
      process.env.DAILY_RESTART_HOUR_IN_UTC = ORIGINAL_HOUR_ENV;
    }
  });

  it('exports scheduleRestart and cancel', () => {
    const scheduler = loadScheduler();
    expect(typeof scheduler.scheduleRestart).toBe('function');
    expect(typeof scheduler.cancel).toBe('function');
  });

  it('schedules for later the same day when now is before the target hour', () => {
    jest.setSystemTime(new Date('2026-06-24T08:00:00.000Z'));
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    loadScheduler().scheduleRestart();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(3 * HOUR_IN_MS);
  });

  it('schedules for the next day when now is after the target hour', () => {
    jest.setSystemTime(new Date('2026-06-24T14:00:00.000Z'));
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    loadScheduler().scheduleRestart();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(21 * HOUR_IN_MS);
  });

  it('treats now exactly at the target hour as already passed (schedules tomorrow)', () => {
    jest.setSystemTime(new Date('2026-06-24T11:00:00.000Z'));
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    loadScheduler().scheduleRestart();

    expect(setTimeoutSpy.mock.calls[0][1]).toBe(24 * HOUR_IN_MS);
  });

  it('rolls across a month boundary when scheduling tomorrow', () => {
    jest.setSystemTime(new Date('2026-06-30T23:00:00.000Z'));
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    loadScheduler().scheduleRestart();

    expect(setTimeoutSpy.mock.calls[0][1]).toBe(12 * HOUR_IN_MS);
  });

  it('honors DAILY_RESTART_HOUR_IN_UTC override', () => {
    process.env.DAILY_RESTART_HOUR_IN_UTC = '5';
    jest.setSystemTime(new Date('2026-06-24T02:00:00.000Z'));
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    loadScheduler().scheduleRestart();

    expect(setTimeoutSpy.mock.calls[0][1]).toBe(3 * HOUR_IN_MS);
  });

  describe('DAILY_RESTART_HOUR_IN_UTC parsing', () => {
    it('honors hour 0 (midnight) instead of falling back to the default', () => {
      // Regression: || treated hour 0 as falsy. 1h delay proves 0 is honored (not 12h).
      process.env.DAILY_RESTART_HOUR_IN_UTC = '0';
      jest.setSystemTime(new Date('2026-06-24T23:00:00.000Z'));
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      loadScheduler().scheduleRestart();

      expect(setTimeoutSpy.mock.calls[0][1]).toBe(1 * HOUR_IN_MS);
    });

    it('falls back to 11:00 UTC when the value is out of range', () => {
      process.env.DAILY_RESTART_HOUR_IN_UTC = '24';
      jest.setSystemTime(new Date('2026-06-24T08:00:00.000Z'));
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      loadScheduler().scheduleRestart();

      expect(setTimeoutSpy.mock.calls[0][1]).toBe(3 * HOUR_IN_MS);
    });

    it('falls back to 11:00 UTC when the value is non-numeric', () => {
      process.env.DAILY_RESTART_HOUR_IN_UTC = 'noon';
      jest.setSystemTime(new Date('2026-06-24T08:00:00.000Z'));
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      loadScheduler().scheduleRestart();

      expect(setTimeoutSpy.mock.calls[0][1]).toBe(3 * HOUR_IN_MS);
    });

    it('falls back to 11:00 UTC for a fractional hour', () => {
      process.env.DAILY_RESTART_HOUR_IN_UTC = '11.5';
      jest.setSystemTime(new Date('2026-06-24T08:00:00.000Z'));
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      loadScheduler().scheduleRestart();

      expect(setTimeoutSpy.mock.calls[0][1]).toBe(3 * HOUR_IN_MS);
    });
  });

  it('exits the process for the dyno cycle when the timer fires', () => {
    jest.setSystemTime(new Date('2026-06-24T08:00:00.000Z'));
    loadScheduler().scheduleRestart();

    expect(exitSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3 * HOUR_IN_MS);

    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('cancel() clears the timer so the process does not exit', () => {
    jest.setSystemTime(new Date('2026-06-24T08:00:00.000Z'));
    const scheduler = loadScheduler();
    scheduler.scheduleRestart();

    scheduler.cancel();
    jest.advanceTimersByTime(48 * HOUR_IN_MS);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('cancel() is a safe no-op when nothing is scheduled', () => {
    const scheduler = loadScheduler();
    expect(() => scheduler.cancel()).not.toThrow();
  });
});
