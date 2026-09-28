# Follow a Facebook page and like its posts

## Context
- App package / Activity where this starts: `com.facebook.katana` (any screen)
- Precondition: Facebook installed and logged in.

## Steps
inside u2bun (workdir: `u2bun/`)

1. Open the profile URL forcing the full Facebook app (Lite steals the intent otherwise):
   `adb -s <SERIAL> shell am force-stop com.facebook.lite`
   `adb -s <SERIAL> shell am start -a android.intent.action.VIEW -d "<profile_url>" -p com.facebook.katana`
2. `ui snapshot --limit 60` → confirm the page loaded (cover photo, followers count, name).
3. Follow: `ui tap --ref @N` on the `Button "Seguir"` (near the name). Verify → snapshot shows `Button "Siguiendo"`.
4. Scroll down to the posts: `ui swipe --from-pos 540,1700 --to-pos 540,500`.
5. For each visible post, tap its like button by **coordinates** (`ui tap --bounds`), because Facebook does not expose the like button text in the accessibility tree (it appears as an empty `Button` in the dump).
   - Find like button bounds from `ui dump`: it is the leftmost empty `Button` in each post's action row (`[0,y1][132,y2]`-ish), immediately followed by the empty `Comentar` and `Compartir` buttons.
   - Center of like button ≈ `(66, (y1+y2)/2)`.
6. Verify each like visually: `adb -s <SERIAL> exec-out screencap -p > /tmp/like.png`, then sample pixels with PIL — the like icon turns **blue** when active. Blue signature: `b > 150 and b - r > 60` (e.g. `(8,102,255)` in light mode, `(162,197,255)` in dark mode).

## Postcondition
- Page shows `Siguiendo`; each targeted post shows a blue (active) like button, verified by pixel color.

## Known Pitfalls
- Opening a Facebook URL via plain `am start -a android.intent.action.VIEW` is hijacked by Facebook Lite (`com.facebook.lite`), which exposes NO accessibility tree (React Native). Force-stop Lite and pass `-p com.facebook.katana`.
- The like button (`Button "Me gusta"`) is an empty Button in the hierarchy — no text/desc to select by. Tap by `--bounds` from `ui dump`.
- Tapping the like button by bounds sometimes opens the post in full-screen view instead of liking (layout shifts after the previous like). After tapping, re-dump to locate the like button's NEW bounds before tapping the next post.
- The page only shows ~2-3 posts per screen; the first post in the feed (e.g. pinned "12 may.") may need extra scrolls. Some posts at the screen edge are still tappable by bounds.
- After tapping a post's photo area (not the action row) the post opens full-screen; press `Atrás` to return to the list.
- Dark-mode Facebook renders the active like icon in lighter blue `(162,197,255)`; adjust the pixel check accordingly.
- Device serial: `192.168.1.19:5555` (WiFi) — the old `da0f5e72` (USB) no longer applies.