import { describe, expect, test } from "bun:test";
import {
  COLD_START_TIMEOUT_MS,
  POLL_INITIAL_INTERVAL_MS,
  POLL_MAX_INTERVAL_MS,
  pollUntil,
} from "../../src/runtime/runtime";

function createClock() {
  let current = 0;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
  };
}

describe("pollUntil (u2 runtime cold-start polling)", () => {
  test("returns immediately when already ready (hot path never sleeps)", async () => {
    const clock = createClock();
    const result = await pollUntil(async () => true, {
      timeoutMs: COLD_START_TIMEOUT_MS,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toBe(true);
    expect(clock.sleeps).toEqual([]);
  });

  test("returns true once the probe succeeds before the deadline", async () => {
    const clock = createClock();
    let calls = 0;

    const result = await pollUntil(
      async () => {
        calls += 1;
        return calls >= 4;
      },
      { timeoutMs: 10_000, now: clock.now, sleep: clock.sleep }
    );

    expect(result).toBe(true);
    expect(calls).toBe(4);
  });

  test("uses bounded exponential backoff and caps at maxIntervalMs", async () => {
    const clock = createClock();
    let calls = 0;

    const result = await pollUntil(
      async () => {
        calls += 1;
        return calls >= 5;
      },
      {
        timeoutMs: 60_000,
        initialIntervalMs: 100,
        maxIntervalMs: 400,
        now: clock.now,
        sleep: clock.sleep,
      }
    );

    expect(result).toBe(true);
    expect(clock.sleeps).toEqual([100, 200, 400, 400]);
  });

  test("returns false at the deadline and never sleeps past it", async () => {
    const clock = createClock();

    const result = await pollUntil(async () => false, {
      timeoutMs: 1_000,
      initialIntervalMs: 500,
      maxIntervalMs: 500,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toBe(false);
    const totalSlept = clock.sleeps.reduce((sum, ms) => sum + ms, 0);
    expect(totalSlept).toBeLessThanOrEqual(1_000);
  });

  test("a ~10s cold start succeeds now but failed under the old 5s budget (regression)", async () => {
    const readyAtMs = 10_000;
    const check = (clock: ReturnType<typeof createClock>) => async () => clock.now() >= readyAtMs;

    const generous = createClock();
    const newResult = await pollUntil(check(generous), {
      timeoutMs: COLD_START_TIMEOUT_MS,
      now: generous.now,
      sleep: generous.sleep,
    });
    expect(newResult).toBe(true);

    const old = createClock();
    const oldResult = await pollUntil(check(old), {
      timeoutMs: 5_000,
      now: old.now,
      sleep: old.sleep,
    });
    expect(oldResult).toBe(false);
  });

  test("cold-start budget is realistic for emulators and slow devices (>= 20s)", () => {
    expect(COLD_START_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
  });

  test("poll interval constants are sane", () => {
    expect(POLL_INITIAL_INTERVAL_MS).toBeGreaterThan(0);
    expect(POLL_MAX_INTERVAL_MS).toBeGreaterThanOrEqual(POLL_INITIAL_INTERVAL_MS);
  });
});
