# Comment on Instagram posts

## Context
- App package / Activity where this starts: `com.instagram.android` (home feed)
- Precondition: Instagram installed and logged in; AdbKeyboard IME active (see SKILL.md §1.4 — activate with `ime set` if not).

## Steps
inside u2bun (workdir: `u2bun/`)

1. `adb -s <SERIAL> shell monkey -p com.instagram.android -c android.intent.category.LAUNCHER 1` → launch Instagram.
2. Ensure AdbKeyboard IME is active: `adb -s <SERIAL> shell settings get secure default_input_method` must be `com.github.uiautomator/.AdbKeyboard`. If not: `ime enable` + `ime set` (SKILL.md §1.4).
3. `ui snapshot` → find a post. Scroll with `ui swipe --from-pos 540,2000 --to-pos 540,800` until a post shows its action bar.
4. When the post's action bar is visible, tap `Button "Comentar"` (near the like count) → comments sheet opens.
5. `ui snapshot` → find the composer `Input` (placeholder varies: "Únete a la conversación…", "Añade un comentario para <name>", "¿Qué opinas de esto?"). Tap it to focus.
6. `ui input --text "<comentario>"` → MUST report `input_method: "adb_keyboard"`. If it reports `"clipboard"`, STOP — the IME is not active or the text is corrupted: activate IME, `adb shell am broadcast -a ADB_KEYBOARD_CLEAR_TEXT`, retype.
7. Find the post button: `ui dump --filter actionable` → grep `contentDesc "Publicar"` → it's an `ImageView` (id `layout_comment_thread_post_button_icon`). Tap by `--ref @N` (text selector "Publicar" FAILS — it's a contentDesc, not text).
8. Verify: `ui snapshot` → comment count button incremented by 1 and composer cleared back to placeholder.

## Postcondition
- Comment count incremented; your comment shows as `<username>` in the comment list; composer reset.

## Known Pitfalls
- "Publicar" is an ImageView with contentDesc, not text — `--text "Publicar"` fails; use `--ref` from a dump.
- The enter key does NOT post comments on Instagram; only the "Publicar" button does.
- Composer placeholder varies per post; locate the `Input` node by class, not text.
- Non-ASCII: verify `input_method: "adb_keyboard"`; a "clipboard" response means corruption. `ui input --clear-first` does NOT clear a field already containing corrupted text — it appends; use `ADB_KEYBOARD_CLEAR_TEXT` broadcast instead.
- Back from comments sheet returns to home feed; comment stays posted (verify in feed: "<username> <comentario>").
- Device serial: `192.168.1.19:5555` (WiFi).