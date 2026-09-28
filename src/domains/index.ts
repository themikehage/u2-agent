import type { DomainSpec } from "../registry";
import { DEVICE_DOMAIN } from "./device";
import { SETUP_DOMAIN } from "./setup";
import { DAEMON_DOMAIN } from "./daemon";
import { TOOLS_DOMAIN } from "./tools";
import { APP_DOMAIN } from "./app";
import { UI_DOMAIN } from "./ui";
import { RUN_DOMAIN } from "./run";

export const DOMAINS: DomainSpec[] = [
  DEVICE_DOMAIN,
  SETUP_DOMAIN,
  DAEMON_DOMAIN,
  TOOLS_DOMAIN,
  APP_DOMAIN,
  UI_DOMAIN,
  RUN_DOMAIN,
];

