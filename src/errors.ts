export enum ExitCode {
  SUCCESS = 0,
  USAGE = 1,
  DEVICE = 2,
  NOT_FOUND = 3,
  PROVISION = 4,
  TIMEOUT = 5,
  INTERNAL = 10,
}

export class U2Error extends Error {
  public readonly code: string;
  public readonly exitCode: ExitCode;
  public readonly retryable: boolean;
  public readonly hint: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    exitCode: ExitCode,
    retryable: boolean,
    hint: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "U2Error";
    this.code = code;
    this.exitCode = exitCode;
    this.retryable = retryable;
    this.hint = hint;
    this.details = details;
  }
}

export class UsageError extends U2Error {
  constructor(message: string, hint: string = "Run u2-agent <domain> <tool> --help") {
    super("USAGE", message, ExitCode.USAGE, false, hint);
  }
}

export class DeviceNoneError extends U2Error {
  constructor(message: string = "No ADB devices connected") {
    super("DEVICE_NONE", message, ExitCode.DEVICE, true, "Connect USB or `adb connect <ip>`");
  }
}

export class DeviceAmbiguousError extends U2Error {
  constructor(serials: string) {
    super(
      "DEVICE_AMBIGUOUS",
      `Multiple ADB devices connected (${serials}). Must specify --serial`,
      ExitCode.DEVICE,
      false,
      "Pass --serial <serial> from `u2-agent device list`"
    );
  }
}

export class DeviceNotFoundError extends U2Error {
  constructor(serial: string) {
    super(
      "DEVICE_NOT_FOUND",
      `Requested device serial '${serial}' not found in ADB device list`,
      ExitCode.DEVICE,
      true,
      "Verify connection with `u2-agent device list` or run `u2-agent device reconnect`"
    );
  }
}

export class DeviceUnauthorizedError extends U2Error {
  constructor(serial: string) {
    super(
      "DEVICE_UNAUTHORIZED",
      `Device '${serial}' is unauthorized`,
      ExitCode.DEVICE,
      true,
      "Accept the RSA prompt on the device screen"
    );
  }
}

export class DeviceOfflineError extends U2Error {
  constructor(serial: string, cause?: string) {
    const detail = cause ? `: ${cause}` : "";
    super(
      "DEVICE_OFFLINE",
      `Device '${serial}' is offline${detail}`,
      ExitCode.DEVICE,
      true,
      `Run u2-agent device reconnect --serial ${serial}`
    );
  }
}

export class RuntimeDownError extends U2Error {
  constructor(serial: string, cause?: string) {
    const detail = cause ? `: ${cause}` : "";
    super(
      "UIAUTOMATOR_DOWN",
      `uiautomator2 server is down on device '${serial}'${detail}`,
      ExitCode.PROVISION,
      true,
      "Run `u2-agent setup install` or let u2-agent auto-start the runtime"
    );
  }
}


export class ADBUnavailableError extends U2Error {
  constructor(message: string = "`adb` command not found on system PATH") {
    super("ADB_UNAVAILABLE", message, ExitCode.DEVICE, false, "Install Android platform-tools or set ADB_PATH");
  }
}

export class SelectorNotFoundError extends U2Error {
  constructor(selectorDesc: string) {
    super(
      "SELECTOR_NOT_FOUND",
      `No UI element matched selector: ${selectorDesc}`,
      ExitCode.NOT_FOUND,
      false,
      "Re-dump hierarchy with `u2-agent ui dump --filter actionable`"
    );
  }
}

export class AppNotFoundError extends U2Error {
  constructor(pkg: string) {
    super("APP_NOT_FOUND", `Application package '${pkg}' not found`, ExitCode.NOT_FOUND, false, "Use `app list` to verify package name");
  }
}

export class ProvisionBlockedError extends U2Error {
  constructor(message: string, hint: string = "Enable 'Install via USB' in Developer options", details?: Record<string, unknown>) {
    super("PROVISION_BLOCKED", message, ExitCode.PROVISION, false, hint, details);
  }
}

export class ProvisionFailedError extends U2Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PROVISION_FAILED", message, ExitCode.PROVISION, true, "Run `setup diagnose` for details", details);
  }
}

export class TimeoutError extends U2Error {
  constructor(message: string) {
    super("TIMEOUT", message, ExitCode.TIMEOUT, true, "Raise `--timeout`, or run reconnect first");
  }
}

export class PostconditionFailedError extends U2Error {
  constructor(message: string) {
    super("POSTCONDITION_FAILED", message, ExitCode.TIMEOUT, false, "Re-dump; the UI state may have changed");
  }
}

export class TransientError extends U2Error {
  constructor(message: string) {
    super("TRANSIENT", message, ExitCode.TIMEOUT, true, "Retry once, then reconnect");
  }
}

export class InternalError extends U2Error {
  constructor(message: string) {
    super("INTERNAL", message, ExitCode.INTERNAL, false, "Report the command + JSON envelope");
  }
}
