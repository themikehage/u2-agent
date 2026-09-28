# Add friends on LinkedIn

## Context
- App package / Activity where this starts: `com.linkedin.android` (home feed, `LaunchActivityDefault`)
- Precondition: LinkedIn open and logged in on the home feed (bottom nav: Inicio/Mi red/Publicar/Empleos/Más).

## Steps
inside u2bun (workdir: `u2bun/`)

1. `bun run src/index.ts --serial <SERIAL> app start --package com.linkedin.android --json`
2. `bun run src/index.ts --serial <SERIAL> ui snapshot --json`  → find the "Mi red" tab ref (bottom nav).
3. `bun run src/index.ts --serial <SERIAL> ui tap --ref @N --json`  (the "Mi red" tab)
4. `bun run src/index.ts --serial <SERIAL> ui snapshot --limit 80 --json`  → find "Mostrar todas las sugerencias" and tap it, OR use the inline "Invita a … a conectar" buttons directly.
5. For each person: `ui snapshot`, then `ui tap --ref @M` on their `Invita a <nombre> a conectar` item. Verify it flips to `Pendiente. Haz clic para retirar la invitación enviada a <nombre>.`
6. When no more "Invita" buttons are visible: scroll with `ui swipe --from-pos 540,2000 --to-pos 540,800 --json` (center gutter, avoids the buttons), re-snapshot, repeat.

## Postcondition
- Each target person's card shows `Pendiente. Haz clic para retirar la invitación enviada a <nombre>.` (invitation sent, no dialog open).

## Known Pitfalls
- The "Invita" button has EMPTY `text`; its accessible label is `contentDesc="Invita a <nombre> a conectar"`. Match by ref from a fresh snapshot — do NOT loop on `--desc-contains "a conectar"`, it can resolve against stale handles and re-tap an already-sent card, opening the withdraw dialog.
- After a send, the same spot becomes a tappable `Pendiente. Haz clic para retirar…` button. Scrolling/tapping over it opens a "Retirar invitación" confirmation. To dismiss WITHOUT withdrawing, tap the LEFT button (empty `android.widget.Button` wrapping the "Cancelar" text) — not the "Retirar" view.
- Some suggestions show only `Borrar a <nombre> como sugerencia` with no "Invita" (already connected) — skip them.
- Scroll with a swipe in the center gutter (x≈540) between the two card columns to avoid hitting the "Pendiente" buttons.
