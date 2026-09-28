import { describe, test, expect } from "bun:test";
import {
  U2Error,
  UsageError,
  DeviceNoneError,
  DeviceAmbiguousError,
  ExitCode,
} from "../../src/errors";

describe("Errors catalog", () => {
  test("UsageError has code USAGE and exit code 1", () => {
    const err = new UsageError("Invalid argument");
    expect(err.code).toBe("USAGE");
    expect(err.exitCode).toBe(ExitCode.USAGE);
    expect(err.retryable).toBe(false);
  });

  test("DeviceNoneError has code DEVICE_NONE and retryable true", () => {
    const err = new DeviceNoneError();
    expect(err.code).toBe("DEVICE_NONE");
    expect(err.exitCode).toBe(ExitCode.DEVICE);
    expect(err.retryable).toBe(true);
  });

  test("DeviceAmbiguousError contains serial list", () => {
    const err = new DeviceAmbiguousError("dev1, dev2");
    expect(err.message).toContain("dev1, dev2");
    expect(err.code).toBe("DEVICE_AMBIGUOUS");
  });
});
