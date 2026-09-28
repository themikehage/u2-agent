# Like a video on LinkedIn

## Context
- App package / Activity where this starts: `com.linkedin.android` (home feed, `LaunchActivityDefault`)
- Precondition: LinkedIn feed visible; scroll until a video post appears.
- Device: use whatever ADB device is online (`device list`), e.g. `192.168.1.19:5555`. `da0f5e72` may be offline.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `bun run src/index.ts --serial <SERIAL> app start --package com.linkedin.android`
2. `bun run src/index.ts --serial <SERIAL> ui snapshot`  → identify a video post.
3. Scroll the feed with `bun run src/index.ts --serial <SERIAL> ui scroll --direction down` and re-snapshot until you find a video post.
4. Tap the reaction state: `bun run src/index.ts --serial <SERIAL> ui tap --desc-contains "Estado del botón de reacción" --expect-desc-contains "ninguna reacción" --expect-element-absent`

## Postcondition
- Reaction state flips to `Estado del botón de reacción: recomendar` and the counter increments by 1 (e.g. `1.490` → `1.491`).

## Known Pitfalls
- A video post is identified by a mute button (`Silenciar`) and a duration text like `00:19` (also shows `Volver a ver` when it ends). Image posts show `Ver imagen` instead.
- `ui scroll --direction down` moves the feed DOWN (reveals posts below); `up` scrolls back toward the top.
- The like button itself has EMPTY `content-desc`/`text`. Tap the sibling reaction-state element via `--desc-contains "Estado del botón de reacción"`, which shares the same center coordinate.
- Gestures like `ui swipe --from-pos X,Y --to-pos X,Y` are now fully supported with kebab-case or snake_case flags.
