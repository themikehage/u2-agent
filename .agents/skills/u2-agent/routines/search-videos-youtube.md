# Search for videos on YouTube

## Context
- App package / Activity where this starts: `com.google.android.youtube` (home feed)
- Precondition: device unlocked and on the launcher home screen.

## Steps
inside u2bun (workdir: `u2bun/`)

1. Launch YouTube. `app start` fails; use monkey directly:
   `adb -s <SERIAL> shell monkey -p com.google.android.youtube -c android.intent.category.LAUNCHER 1`
   (Alternative: tap launcher "YouTube" icon.) Confirm with `ui snapshot`.
2. `bun run src/index.ts --serial <SERIAL> ui snapshot`  → confirm home feed (bottom nav: Inicio/Shorts/Crear/Suscripciones/Tú).
3. `bun run src/index.ts --serial <SERIAL> ui snapshot` → find "Buscar" handle, then `ui tap --ref @N` (or `ui tap --text "Buscar"`). Opens search screen (EditText auto-focused).
4. `bun run src/index.ts --serial <SERIAL> ui input --text "<query>"` → types into focused field.
5. `bun run src/index.ts --serial <SERIAL> ui press --key enter` → submit search.
6. `bun run src/index.ts --serial <SERIAL> ui snapshot` → results list.

### Collecting the top-N videos (scroll + save)
7. `bun run src/index.ts --serial <SERIAL> ui swipe --from-pos 540,1200 --to-pos 540,400` → scroll down one page.
8. `sleep 1.5` then `ui snapshot` → capture visible video cards (content-desc contains `- reproducir Short` or `- ver vídeo`).
9. Repeat steps 7–8 until N unique videos collected (each snapshot shows ~5-6 cards; ~3-4 scrolls needed for 10).
10. Save the deduplicated list to a markdown file (e.g. `videos_<query>.md`): title, channel, duration, views.

## Postcondition
- Results show the channel card and video cards with content-desc containing "<title> - <channel> - <N> visualizaciones - <time> - ver vídeo".
- A saved markdown file lists the N collected videos.

## Known Pitfalls
- `app start --package com.google.android.youtube` returns `APP_NOT_FOUND` despite the package being listed in `app list`; launch via `monkey` (see step 1). Also, its main activity is `Shell$HomeActivity` — the `$` breaks `am start -n`, use monkey.
- `app list` only lists third-party packages by default; YouTube is a system package, so it won't show up there.
- The search button (top-right) matched by text "Buscar"; re-snapshot before tapping by ref if the handle shifts.
- After tapping search, the `EditText` ("Buscar en YouTube") is auto-focused, so `ui input` types directly into it without a separate tap.
- `ui input` uses clipboard+paste internally, so accented/special chars type correctly.
- Snapshot is sparse (~6 actionable cards); to build a list of N videos, scroll repeatedly and dedupe across snapshots. Some cards are only "Button" with no text (sponsored/video thumbnails).
- `ui swipe` REQUIRES `--from-pos X,Y --to-pos X,Y` (or explicit x/y flags); it errors with `USAGE` otherwise.
- Device serial: `192.168.1.19:5555` (WiFi) — the old `da0f5e72` (USB) no longer applies.
