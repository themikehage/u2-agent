export interface DeviceInfo {
  serial: string;
  state: string;
  model: string;
  transport: string;
  selected?: boolean;
}

export interface ActionElement {
  index: number;
  ref?: string;
  text: string;
  resourceId?: string;
  contentDesc?: string;
  className: string;
  bounds: string;
  clickable?: boolean;
  scrollable?: boolean;
  focused?: boolean;
  visible_to_selector_engine?: boolean;
}

export interface SetupStepReport {
  name: string;
  status: "installed" | "already_present" | "skipped" | "failed";
  detail: string;
}

export interface SetupReport {
  status: "ready" | "not_ready";
  steps: SetupStepReport[];
}

export interface JsonEnvelope<T = Record<string, unknown>> {
  schema_version: "1";
  ok: boolean;
  command: string;
  device?: string;
  result?: T;
  warnings?: string[];
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    hint: string;
    details?: unknown;
  };
}
