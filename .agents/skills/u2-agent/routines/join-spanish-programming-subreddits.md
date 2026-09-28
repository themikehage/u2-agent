# Join Spanish programming subreddits

## Context
- App package / Activity where this starts: `com.reddit.frontpage` (home feed, logged in as u/Significant_Let_6361)
- Precondition: Reddit installed and logged in; search bar accessible from home.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `adb -s <SERIAL> shell monkey -p com.reddit.frontpage -c android.intent.category.LAUNCHER 1` → launch Reddit.
2. `ui snapshot` → confirm logged in ("Cuenta de Significant_Let_6361" at bottom).
3. `ui tap --text "Encuentra lo que quieras"` → focus search bar.
4. **BEFORE typing non-ASCII (`programación`)**: check IME with `adb shell settings get secure default_input_method`. If it is NOT `com.github.uiautomator/.AdbKeyboard`, activate it (`adb shell ime enable` + `ime set`) FIRST. Gboard corrupts accented chars via clipboard.
5. `ui input --text "programación"` (verify response says `input_method: "adb_keyboard"`) → `ui press --key enter` → results list.
6. `ui snapshot --limit 60` → communities under "Comunidades" heading.
7. For each target community (biggest first: r/devsarg, r/programacion, r/taquerosprogramadores, r/programacionESP, r/programadores):
   - `ui tap --ref @N` on `Text "r/<name>"` in results → community page opens (tap by `--ref`, NOT `--text` — BOM in names).
   - `ui snapshot` → find `Button "Unirse a r/<name>"` handle (NOTE: text has invisible BOM char `\uFEFF` after "r/"; tap by `--ref @N`, NEVER by --text).
   - `ui tap --ref @N` → verify snapshot now shows `Button "Salir de r/<name>"`.
   - `ui tap --ref @N` on "Volver" → back to results.
8. Optional: if a "Recursos"/welcome bottom sheet appears after joining, tap `Button "Cerrar hoja"` then re-snapshot to verify.

## Postcondition
- Reddit home feed visible; subscriptions include 5 (Spanish) programming communities: r/programacion, r/devsarg, r/taquerosprogramadores, r/programacionESP, r/programadores.

## Known Pitfalls
- Subreddit names in the app contain an invisible BOM (`r/﻿devsarg`); selectors using `--text "Unirse a r/devsarg"` FAIL. Always snapshot first and tap by `--ref @N`.
- Typing "programación" with LatinIME/Gboard active + `ui.input` uses `input_method: "clipboard"` and CORRUPTS the accented char (`programaci��n`). Before typing non-ASCII: activate AdbKeyboard (`adb shell ime set com.github.uiautomator/.AdbKeyboard`), tap field, `am broadcast -a ADB_KEYBOARD_CLEAR_TEXT`, retype (will report `input_method: "adb_keyboard"`), then restore Gboard via `ime set com.google.android.inputmethod.latin/...` before finishing.
- As of Aug 2026, the 4 big communities were ALREADY subscribed; only r/programadores needed joining (952 members, tiny but the largest of the remaining ones). The other remaining results (r/programar ~2, r/programacion_Arg ~5 weekly) are not worth joining.
- `ui scroll` can throw `TRANSIENT` SecurityException; fall back to `ui swipe --from-pos 540,1600 --to-pos 540,600`.
- Device serial: `192.168.1.19:5555` (WiFi); device can appear `offline` and needs `adb disconnect` + `adb connect` before use.
