# Create a Reddit account with Google

## Context
- App package / Activity where this starts: `com.reddit.frontpage` (welcome screen)
- Precondition: Reddit installed, not logged in; a Google account exists on the device.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `adb -s <SERIAL> shell monkey -p com.reddit.frontpage -c android.intent.category.LAUNCHER 1` → launch Reddit.
2. `ui snapshot` → welcome screen: "El lugar más real de internet" + `Button "Empezar"`.
3. `ui tap --ref @N` on "Empezar" → sign-up sheet appears with `Button "Continuar con Google"` (also "número de teléfono" / "correo electrónico").
4. `ui tap --ref @N` on "Continuar con Google".
   - A GMS `AccountPickerActivity` shows the Google account list (select "Levi / thatdream.on@gmail.com" on this device). NOTE: this sheet exposes few accessibility nodes; tap by text "Levi" works.
5. Reddit shows "Elige tu nombre de usuario" with a suggested name already in the focused `Input` (e.g. `Significant_Let_6361`). Tap `Button "Continuar"` to accept it.
6. "Sesión iniciada como u/<name>" → "Acerca de ti" on-boarding begins:
   - **Cumpleaños**: tap the field, pick a date in the calendar picker. Pitfall: the picker's "OK"/"Cancelar" buttons are empty `Button` nodes at bottom (`[628,1841][864,1901]` Cancelar / `[888,1841][984,1901]` OK) and the month nav arrows are the empty nodes flanking the month title. Selecting a day does NOT auto-close; tap OK. The empty node at `[792,701][864,773]` toggles the previous month — use the right-side empty node `[936,701][984,773]` to go to the next month.
   - **Género**: tap `Saltar`.
   - **Idiomas**: tap `Saltar`.
   - **Personaliza tu feed**: tap `Saltar`.
   - **Personalización de anuncios**: tap `Rechazar` (NOT Aceptar).
7. `ui snapshot` → home feed loads showing the logged-in account ("Cuenta de u/<name>") and real posts.

## Postcondition
- Reddit home feed is visible, logged in as `u/<name>` via Google (account name shows at bottom: "Cuenta de Significant_Let_6361").

## Known Pitfalls
- GMS account picker (`AccountPickerActivity`) exposes minimal accessibility; tap the account by its display text (e.g. "Levi").
- Calendar: picking a day doesn't confirm; you must tap the OK button. Navigating months accidentally happens when tapping empty nodes around the title — the left empty node = previous month, right empty node = next month.
- The "Continuar" button appears disabled (grey) until a birthday is selected.
- Skip everything possible; only cumpleaños is mandatory.
- Device serial: `192.168.1.19:5555` (WiFi) — the old `da0f5e72` (USB) no longer applies.