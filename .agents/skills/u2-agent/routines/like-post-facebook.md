# Like a post on Facebook

## Context
- App package / Activity where this starts: `com.facebook.katana` (home feed)
- Precondition: Facebook feed is visible with at least one post rendered.
- Device: use whatever ADB device is online (`device list`), e.g. `192.168.1.19:5555`.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `bun run src/index.ts app start --package com.facebook.katana --json`
2. `bun run src/index.ts ui scroll --direction down --json`  (repeat until a post with a Like button is on screen)
3. `bun run src/index.ts ui dump --raw --json`  → find the like button: `content-desc` contains `Botón "Me gusta"`. Note its `bounds`.
4. Long-press the like button center to open the reaction picker: `bun run src/index.ts ui swipe --from-pos <cx>,<cy> --to-pos <cx>,<cy> --duration 80 --json`
5. `bun run src/index.ts ui tap --description "Me gusta" --json`  (reaction picker buttons ARE actionable, unlike the post like button)

## Postcondition
- Like button `content-desc` flips to `Botón "Me gusta" pulsado. Toca dos veces y mantén pulsado para cambiar la reacción.` and a `1` counter appears next to the icon (bounds grow ~40px wider).

## Known Pitfalls
- The like button (`content-desc` starts with `Botón "Me gusta"`) is NOT in the actionable `ui dump` output: u2bun's `deduplicateAndFilterElements` collapses Facebook's deep nested ViewGroup/FrameLayout hierarchy down to 1 element, so `ui tap --desc-contains "Me gusta"` fails with `SELECTOR_NOT_FOUND`. Only the raw XML (`--raw`) exposes it.
- `ui tap` has no raw-coordinate mode, so tap by coordinate = `ui swipe --from-pos X,Y --to-pos X,Y`. The like button is `long-clickable="true"`, so a short-duration same-point swipe registers as a LONG-PRESS and opens the reaction picker — which is actually convenient: tap the clean `Me gusta` dialog button there.
- Facebook obfuscates `resource-id` to `(name removed)` and its accessibility strings are verbose/inconsistent (the pre-like desc even wrongly says "reaccionar al comentario" for a POST like button).
- The daemon falls back to direct RPC on every command (`Daemon ... failed: undefined is not an object (evaluating 'serial.replace')`); harmless but noisy.
