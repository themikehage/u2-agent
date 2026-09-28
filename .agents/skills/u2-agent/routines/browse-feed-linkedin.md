# Browse the LinkedIn home feed

## Context
- App package / Activity where this starts: `com.linkedin.android` (home feed, `LaunchActivityDefault`)
- Precondition: device unlocked; LinkedIn app installed.

## Steps
inside u2bun (workdir: `u2bun/`)

1. If screen reports `locked: true`, unlock first:
   `adb -s <SERIAL> shell input keyevent KEYCODE_WAKEUP && adb -s <SERIAL> shell wm dismiss-keyguard && adb -s <SERIAL> shell input swipe 540 1400 540 800 200`
2. `bun run src/index.ts --serial <SERIAL> app start --package com.linkedin.android --json`
3. `bun run src/index.ts --serial <SERIAL> ui snapshot --include-handles --json` → if there is "Ha ocurrido un error por nuestra parte", tap the retry button (the unnamed button below the message).
4. Scroll down with `bun run src/index.ts --serial <SERIAL> ui scroll --direction down --json` + snapshot, repeating until 3–5 organic posts are collected.

## Postcondition
- Snapshot shows the first sponsored post(s) (e.g. Atlassian, "Promocionado") and then organic posts with author, hold time and reaction count.

## Known Pitfalls
- The screen may re-lock mid-task; re-run step 1.
- LinkedIn shows `@N` handles without text for post media; author, timestamp and reactions are separate elements.
- Snapshots can contain long post bodies with `&#10;` (newlines) — keep `--limit` low for readability.