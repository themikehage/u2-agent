# Reporte de Oportunidades — u2bun CLI (Rendimiento y Velocidad)

**Fecha:** 2026-08-15 · **Dispositivo:** Mi 9 SE vía WiFi (`192.168.1.19:5555`) · **Bun 1.3.14**
**Enfoque:** cada token y cada segundo cuentan. Basado en mediciones reales y en toda la operación realizada (YouTube, Facebook, Facebook Lite, Reddit, Play Store, rutinas).

---

## 0. Mapa de costos actual (mediciones reales)

| Operación | Latencia observada | Desglose |
|---|---|---|
| `ui snapshot` (warm) | **0.52–0.82 s** | Bun startup (~40ms) + daemon spawn check (~50-100ms) + `deviceInfo` RPC + `dumpWindowHierarchy` RPC (~350ms en el teléfono) + parse + dedupe |
| `ui snapshot` (cold, sin daemon) | **>4 s** | + spawn de `bun run server.ts` + adb forward + `ensureU2Runtime` |
| `ui tap` (CLI completo) | **0.42–0.47 s** | Bun startup + daemon roundtrip |
| `ui tap` (daemon directo) | **0.36–0.40 s** | El RPC `click` real del dispositivo |
| `device list` | **0.05 s** | Solo `adb devices -l` |
| `--version` / `--help` | **0.04 s** | Puro startup Bun |

**Conclusión inmediata:** el CLI ya va por el daemon (bien), pero cada invocación paga **40-80ms de arranque Bun** + **50-100ms de resolución de puerto/daemon** + el costo dominante de **~350ms de `dumpWindowHierarchy` en el dispositivo**. La mayor ganancia está en eliminar dumps redundantes, no en el CLI.

---

## 1. Ruido / cosas que sobran (eliminar = tokens ahorrados)

### 1.1 El snapshot mezcla ruido semántico
- `[@N] Item "Bandeja de historias"`, `[@N] Item "Recientes"`, `[@N] Item "El Mejor equipo de la historia…"` son **duplicados** de su Button padre en la misma línea. Ejemplo real de Facebook: `[@16] Button "Amigos, pestaña 3 de 6, 8 nuevos"` + `[@30] Item "Amigos, pestaña 3 de 6, 8 nuevos"`. El dedupe por bounding-box **no detecta nodos padre-hijo con texto idéntico a distinta profundidad** → duplica tokens inútilmente.
- **Fix:** si dos elementos tienen el mismo `text`+`contentDesc` y uno es ancestro del otro, quedarse solo con el clickeable.

### 1.2 `Button` vacíos sin etiqueta
- Facebook y Reddit producen decenas de `[@N] Button` sin texto/desc (like buttons, flechas de calendario, más opciones). En nuestras sesiones fueron **inutilizables por selector** y obligaron a `--bounds`.
- **Fix propuesto:** añadir un campo `bounds` en la línea del snapshot cuando el Button está vacío (o un prefijo `x,y`). Ej: `[@7] Button @x=86,y=533`. Cuesta ~10 tokens por elemento pero **evita un `ui dump` completo (70KB → ~500 tokens)** que es lo que terminamos haciendo.

### 1.3 Envelope `--json` duplica ruido
- `ui snapshot --json` devuelve `screen_fingerprint`, `element_count`, `raw_count`, `snapshot`, `handles`, `ok`, `command`, `device`, `schema_version`, `warnings` — para un agente LLM el 80% de esas claves son **irrelevantes**.
- **Fix:** cuando el agente es LLM, el contrato real es `ui snapshot` plano (ya lo usamos). Considerar `--minimal` para solo `snapshot` + `element_count`.

### 1.4 Avisos "daemon fallback" a stderr → ruido en cada sesión
- Hemos visto repetidamente: `Warning: Daemon tap action failed, falling back to direct RPC: …`. Aunque van a stderr, el agente los lee y cuestan tokens.
- **Fix:** suprimir fallbacks esperados (p.ej. `SELECTOR_NOT_FOUND` en daemon) o consolidarlos en un único aviso al final.

### 1.5 `app list` incluye paquetes de runtime/ruido
- Lista `com.github.uiautomator`, `Mono.Android.*`, `com.google.android.safetycore`, `com.amazon.aa.attribution` — ruido para un agente que busca apps.
- **Fix:** `--third-party-only` por defecto + filtrar `Mono.*`/`uiautomator`.

---

## 2. Lo que falta (mejoras que aceleran el proceso)

### 2.1 **`ui screenshot` como herramienta de diagnóstico integrada**
- Hoy para verificar un like hay que: `adb exec-out screencap` + script PIL externo. Muy lento y fuera del CLI.
- **Fix:** comando `ui screenshot` que guarde el PNG y devuelva `{path, width, height}` + opción `--analyze` que devuelva los colores dominantes de regiones (para verificar botones azules/estados sin visión LLM). Ahorra ~5-10 pasos por verificación.

### 2.2 **Selector por `--pos X,Y` para el snapshot**
- Los elementos vacíos (like buttons) se resolvieron con `--bounds`, pero el bounds cambia tras cada scroll. 
- **Fix:** `ui tap --pos X,Y` ya existe y es rápido; falta un `ui snapshot --include-empty` o `--with-bounds` para poder usarlo con precisión.

### 2.3 **`ui state` / comparación de pantalla**
- Tener un hash compacto del estado para detectar "cambió/no cambió" sin re-enviar el snapshot completo.
- Hoy `changed: yes/no` existe en el header del snapshot; exponerlo como comando dedicado `ui state` ahorra tokens cuando solo se quiere verificar el cambio.

### 2.4 **`app start` — fallo observado con YouTube pese al fallback**
- El código YA intenta `resolve-activity` y cae a `monkey` (app.ts:74-92), pero en la sesión YouTube falló igualmente con `APP_NOT_FOUND`. Causa probable: `resolve-activity` devolvió algo y `am start` falló, o el stdout/stderr de `monkey` contenía "Error", y el check de la línea 95 (`stderr.includes("Error")`) convirtió un arranque parcial en error.
- **Fix:** cuando `resolve-activity` tenga éxito, ignorar stderr de advertencia y verificar arranque con `app current`; sólo si eso falla, `monkey`. Reportar `launcher: true` cuando se usó monkey. (Observado y re-implementado a mano 3+ veces en sesión.)

### 2.5 **Reconocimiento de "pantalla de bloqueo / notificaciones"**
- 4 veces el flujo colapsó porque el snapshot mostraba `com.android.systemui` con notificaciones (pantalla bloqueada) y `uiautomator dump` fallaba con `exit 137`.
- **Fix:** detectar `mCurrentFocus` con un RPC rápido y reportar `locked: true` en el snapshot; sugerir `device unlock` (keyevent 224 + swipe) automáticamente.

### 2.6 **Modo batch persistente (`run steps` con sesión larga)**
- `run steps` existe pero cada `ui.snapshot` intermedio va por el daemon igual. Para flujos largos (seguir página + like × 5 + verificación) el agente ejecuta ~15 comandos CLI = **15 × ~450ms + overhead de salida**.
- **Fix:** un modo "REPL/stream" donde el daemon acumule snapshots y diffs, y el CLI solo reciba el delta. O un `--listen` que mantenga una sesión abierta para acciones rápidas.

### 2.7 **Rutinas como JSON ejecutable (no solo markdown)**
- Las rutinas `*.md` son para humanos; el agente debe leerlas y traducirlas a comandos. 
- **Fix:** formato `.steps.json` junto a cada rutina para ejecutarse directamente con `run steps --file`. Elimina el paso de "leer y traducir".

---

## 3. Mejoras estructurales

### 3.1 El cuello de botella real es `dumpWindowHierarchy` (~350ms)
- Se llama una vez por `snapshot`, y de nuevo por cada `tap` con `--expect-*`, `press`, `type`, etc. El RPC de uiautomator2 es lento por diseño.
- **Fix:** 
  - **Cache de jerarquía:** el daemon ya cachea elementos entre snapshot y acción (`self.elements`) — **usarlo para `press`/`type` que hoy re-dump tras la acción** aunque no lo necesiten. `press` y `type` hacen un dump completo SOLO para actualizar el fingerprint (server.ts:393-396, 410-413). (`swipe`/`scroll` ya no re-dump — correcto.)
  - **`--expect-*` lazy:** solo re-dump si hay expect; hoy `type` SIEMPRE re-dump y `press` idem.
  - Verificar si `dumpWindowHierarchy(compressed=false)` es necesario; probar `true` en toda la cadena.

### 3.2 Doble parse + doble dedupe por snapshot
- `parseXmlDump(xml, ..., false)` (sin dedupe) y luego `deduplicateAndFilterElements(rawElements)` = parsea todo, luego re-procesa. En `ui.dump` igual.
- **Fix:** `parseXmlDump` con un flag interno que dedupe en un solo pase.

### 3.3 `ensureU2Runtime` en cada conexión es caro
- `DeviceSession.connect()` → `selectTargetDevice` (`adb devices`) + `forwardPort` (`adb forward`) + `ensureU2Runtime` + `ping`. Para el daemon esto ocurre una vez (ok), pero en el **fallback directo** (cuando el daemon falla) se repite por cada comando.
- **Fix:** si el daemon está vivo, el fallback directo debería **levantar/reusar** un session cacheado en vez de reconstruir.

### 3.4 El inicio del daemon es frágil y lento
- Cold start: `DaemonClient.ensureDaemon()` hace poll cada 50ms × 20 intentos, y en medio se hacen `adb forward` y `ensureU2Runtime` que pueden tardar 2-4s.
- **Fix:** arrancar el daemon **una sola vez** (el config JSON ya persiste); verificar que `daemon stop` + siguiente snapshot no provoque el ciclo completo (lo vimos: después de `daemon stop`, un snapshot tardó >4s y luego quedó "colgado" hasta timeout).

### 3.5 `resolveSelector` devuelve `rawElements` para matching pero los handles del snapshot son del set dedupeado
- Inconsistencia: `ui.tap --ref @N` usa los handles dedupeados (bien), pero cuando no hay ref se hace matching sobre `rawElements` + `dedupe`. Dos fuentes de verdad → riesgo de mismatch y de hacer parse doble.
- **Fix:** una única lista canónica en el daemon (`self.elements`) usada por snapshot Y action.

### 3.6 Tipado Zod duplicado en el hot path
- `tool.inputSchema.parse` + `tool.outputSchema.parse` + `expect.schema.safeParse` por cada invocación. En comandos simples (`tap`, `swipe`) es overhead trivial (~1ms), pero en `run steps` se acumula.
- **Fix:** para comandos de alta frecuencia (`tap`, `swipe`, `press`), un `--fast` que salte Zod y valide solo en `--strict`.

---

## 4. Impacto cuantificado (orden de magnitud)

- Eliminar dumps redundantes en `press`/`swipe`/`type` (sin `--expect-*`): **ahorra ~350ms × 3-5 comandos por flujo**.
- `--include-empty` con bounds en snapshot: **ahorra un `ui dump --raw` (70KB → ~0) por elemento vacío**, que en FB/Reddit eran 3-5 por pantalla.
- Arranque de daemon una sola vez + reuso del fallback: **evita 2-4s por ciclo cold**.
- Batch con diffs: en el flujo "seguir + like×5 + verificar", de ~15 comandos CLI (~7s) a ~1 sesión (~2s).
- Dedupe padre-hijo: **elimina ~15-25% de líneas duplicadas** en feeds de redes sociales.

---

## 5. Quick wins ordenados por coste/beneficio

1. **(Bajo esfuerzo, alto impacto)** No re-dump tras `press`/`type` sin `--expect-*` — solo devolver `ok` (y el fingerprint si es necesario).
2. **(Bajo esfuerzo)** `app start` → fallback a `monkey` automático.
3. **(Bajo esfuerzo)** Dedupe ancestro-hijo con texto idéntico.
4. **(Medio)** `ui screenshot --analyze` para verificación de estados por color.
5. **(Medio)** `--include-empty`/`--with-bounds` en snapshot para elementos vacíos.
6. **(Medio)** Detección de pantalla bloqueada (`locked: true` + hint de desbloqueo).
7. **(Alto)** Reusar la sesión cacheada del daemon en el fallback directo.
8. **(Alto)** Formato `.steps.json` de rutinas + `run steps --file`.
9. **(Alto)** Modo sesión/stream con diffs para flujos largos.