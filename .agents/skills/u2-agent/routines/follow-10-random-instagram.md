# Follow 10 random accounts on Instagram

## Context
- App package / Activity where this starts: `com.instagram.android` (home feed / Explore grid)
- Precondition: Instagram installed and logged in.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `adb -s <SERIAL> shell monkey -p com.instagram.android -c android.intent.category.LAUNCHER 1` → launch Instagram.
2. `ui tap --text "Buscar y explorar"` (bottom tab) → Explore grid of random accounts.
3. `ui snapshot` → grid shows `Button "Reel de <username> en la fila X, columna Y"` per tile.
4. For each target tile: `ui tap --ref @N` → reel opens. `ui snapshot` → find `Button "Seguir"` handle. `ui tap --ref @N` → verify it flips to `"Siguiendo"`.
5. Back to grid: `ui press --key back` → re-snapshot (grid refreshed).
6. In home feed, suggestion rows expose `Button "Seguir"` with `contentDesc "Seguir a <name>"`. Follow via `ui dump` + grep `contentDesc "Seguir a"` → `ui tap --ref @N`.

## Postcondition
- ≥10 accounts followed (confirmed by buttons showing "Siguiendo").

## Known Pitfalls
- Reel tiles are random every visit; pick any. Collab reels show a "Colaboradores" panel with 2 follow buttons — follow both (they're separate accounts).
- The "Seguir" button next to a collab username sometimes toggles only the collab panel; if ambiguous, tap the collaborator rows (e.g. `Text "get.ta.grip"` / `Button "Seguir"` under "Colaboradores") individually.
- Home feed: suggestion follow buttons change labels to "Siguiendo" but the row re-renders; verify via `ui dump` grep `contentDesc "Sigue(s) a <name>"`.
- A `Cerrar` dialog (bottom sheet) can appear; tap `Button "Cerrar"` before continuing.
- Device serial: `192.168.1.19:5555` (WiFi).
