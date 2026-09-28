# Comment on a Facebook post

## Context
- App package / Activity where this starts: `com.facebook.katana` (home feed)
- Precondition: Facebook feed is open and logged in; a post with comments is visible.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `adb -s <SERIAL> shell monkey -p com.facebook.katana -c android.intent.category.LAUNCHER 1` → launch Facebook.
2. `ui snapshot --limit 60` → find the post; the "Comentar" button appears as `Button "Comentar"` with a `Item "<N>"` view count next to it.
3. `ui tap --ref @N` on `Comentar` → opens the comments sheet.
4. `ui snapshot` → find `Input "Escribe un comentario…"` (empty composer at the bottom).
5. `ui tap --ref @N` on the composer input, then `ui input --text "<comment text>"`.
6. `ui snapshot --limit 60` → find `Button "Enviar"` (appears once text is entered).
7. `ui tap --ref @N` on `Enviar`.
8. `ui snapshot` → composer resets to `Input "Escribe un comentario público..."` (confirms submission).
9. If a group-join prompt appears ("Preguntas para participantes" / "Ya está casi todo listo para que puedas publicar"), tap `Cerrar` → then `Salir` on the "¿Salir sin responder?" dialog.
10. Scroll the comments list and verify the comment text appears (e.g. `Button "<comment text>"`).

## Postcondition
- The comment text is visible in the post's comment list.

## Known Pitfalls
- After submitting, Facebook may show a "join group" prompt if the post is in a group. Tap `Cerrar` then `Salir` (NOT "Responder preguntas") to return to the comments.
- The "Comentar" button is not always in the first 30 snapshot lines; use `--limit 60` or scroll.
- `ui input` handles accented/special chars correctly (clipboard+paste or AdbKeyboard IME).
- Handles shift after each screen change; always re-snapshot before tapping.
- Device serial: `192.168.1.19:5555` (WiFi) — the old `da0f5e72` (USB) no longer applies.