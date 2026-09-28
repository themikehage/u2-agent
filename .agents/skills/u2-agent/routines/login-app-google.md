# Iniciar sesión en una app con Google

## Context
- App package / Activity where this starts: any app with "Continuar con Google" (e.g. `com.edreams.travel`).
- Precondition: app installed, not logged in; a Google account exists on the device (this device: Levi / thatdream.on@gmail.com).

## Steps
inside u2bun (workdir: `u2bun/`)

1. Launch the app: `adb -s <SERIAL> shell monkey -p <PACKAGE> -c android.intent.category.LAUNCHER 1` (monkey, not `app start`). Confirm with `ui snapshot`.
2. Handle first-run onboarding in order (snapshot after each):
   - Privacy consent: `ui tap --text "Ver conf. de privacidad"` → `ui tap --text "Aceptar y Cerrar"`.
   - Login/promo sheet: `ui tap --text "OMITIR"` if present, or proceed.
   - Main login screen: `ui tap --text "Iniciar sesión"` (NOT "como miembro Prime", which opens Prime upsell).
3. Login sheet appears with `Input "Dirección de e-mail"`, `Button "Continuar"`, and text `"Continuar con Google"`.
   - NOTE: "Continuar con Google" is often a **plain Text node, NOT clickable**. Do NOT `ui tap --text`; tap by position (its text bounds center).
4. GMS account sheet (`com.google.android.gms`): `ui snapshot` → if it shows "Cómo funciona" (first time), `ui tap --text "Continuar"`; then the account picker shows `Button "Seguir como Levi"` → `ui tap --text "Seguir como Levi"`.
5. `ui snapshot` → app shows "Cargando" then the logged-in home. Verify session: look for account-only markers (e.g. WALLET / "Precio Prime" in eDreams) rather than a profile row.
6. Save a routine note: this flow is identical across apps (Reddit, eDreams, etc.).

## Postcondition
- App home is loaded, logged in with the Google account (`thatdream.on@gmail.com`). Account-only UI elements visible.

## Known Pitfalls
- `app start --package` may fail (system packages / `$` in activity); launch via monkey.
- eDreams is WebView/React-Native-ish: `ui snapshot` may return EMPTY on splash (`[App: <pkg>]` with no elements) — wait 3-6s and re-snapshot.
- "Continuar con Google" text node bounds must be tapped by `--pos` (element not clickable in hierarchy).
- After tapping "Continuar" on the GMS "Cómo funciona" sheet, focus may land on a back/home area and drop you to the launcher (seen once) — relaunch the app with monkey and repeat.
- The GMS sheet may not appear if Google account flows were dismissed before; "Configura Iniciar sesión con Google" button restores it.
- Privacy/consent dialogs (eDreams) and Xiaomi security analysis (`com.miui.global.packageinstaller`) block first launch; dismiss with "Aceptar y Cerrar" / "Abrir".
- Device serial: `192.168.1.19:5555` (WiFi) — the old `da0f5e72` (USB) no longer applies.