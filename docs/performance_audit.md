# u2bun — Auditoría Profesional de Rendimiento y Velocidad

> **Sesión de referencia**: YouTube → search "tarta red velvet" → like  
> **Dispositivo**: Mi_9_SE `192.168.1.19:5555` (Wi-Fi ADB)  
> **Stack**: Bun/TypeScript, daemon HTTP local, uiautomator2 via u2client

---

## Resumen Ejecutivo

La arquitectura es sólida en su diseño principal: daemon persistente + handles `@N` es la decisión correcta. Los problemas críticos no son de diseño sino de **gaps en la capa de CLI** que obligan al agente a pagar rondas extra de ADB dump cuando debería ser trivial. Cada dump extra sobre Wi-Fi cuesta 800ms–2s.

---

## 🔴 P0 — Crítico (cada token y cada segundo)

### 1. `--ref @N` falla silenciosamente con error USAGE (bug de tipo)

**Observado en sesión**: `ui tap --ref @12` falla con `Expected string, received boolean`.

**Causa**: En [`cli.ts:75`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/cli.ts#L75), cuando un flag `--ref` no tiene valor siguiente (porque `@12` empieza con `@`, no con `-`), el parser lo trata como boolean `true` en lugar de tomar el siguiente argumento como string.

```typescript
// cli.ts:70-76 — parseArgs
const next = rawArgs[i + 1];
if (next !== undefined && !next.startsWith("-")) {  // ← BUG: @12 no empieza con -
  toolArgs[toSnakeCase(param)] = parseTypedValue(next);
  i++;
} else {
  toolArgs[toSnakeCase(param)] = true;  // ← @12 cae aquí como boolean
}
```

**Impacto**: El handle `@N` — la feature más rápida del sistema (sub-15ms, sin dump) — queda inutilizable desde CLI. El agente cae al fallback `--text`/`--desc-contains`, que requiere un dump completo.

**Fix**: Cambiar la condición a `!next.startsWith("-") || next.startsWith("@")`:
```typescript
if (next !== undefined && (!next.startsWith("-") || next.startsWith("@"))) {
```

---

### 2. `ui state` hace dump completo — no es "ultra-fast"

**Observado en código**: [`server.ts:197`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/daemon/server.ts#L197) — `/state` endpoint llama a `dumpHierarchy(true)`, parsea todo el XML, deduplica, y recalcula fingerprint. Exactamente lo mismo que `/snapshot`.

**Lo que debería ser**: Un `adb shell dumpsys window windows | grep mCurrentFocus` o un RPC de `currentPackageName` solamente — sin XML dump.

**Impacto**: `ui state` anuncia ser "fast screen state hash without rendering tree" pero internamente es tan caro como `ui snapshot`. Un agente que lo usa para verificar si la pantalla cambió paga el mismo costo que un snapshot completo.

**Fix**: Separar el path de `state` para que use solo `client.deviceInfo()` + `currentPackageName`. Si el fingerprint es necesario, cachearlo en el daemon y compararlo con el último conocido sin re-parsear.

---

### 3. `ui type` falla cuando el campo ya está enfocado

**Observado en sesión**: `ui type --text "tarta red velvet" --description "Buscar en YouTube"` → `SELECTOR_NOT_FOUND` porque el selector busca por `contentDesc` Y `text` en un solo elemento, pero el campo enfocado es un `Input` y el texto aún no existe.

**Causa**: En [`server.ts:429`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/daemon/server.ts#L429), `parseSelectorArgs(args)` incluye `text` del argumento `--text` en la query del selector:

```typescript
// El --text de ui type se usa TANTO como selector como como texto a tipear
const hasSelector = Boolean(args.ref || args.text_contains || ...)
```

El problema: `--text` es ambiguo — es el texto a tipear, no un selector. Cuando el campo ya está enfocado y el agente usa `ui type --text "query"`, el selector construido busca un elemento con `text="query"` que no existe.

**Fix**: Usar `--value` (o `--input`) para el texto a tipear, o documentar explícitamente que `ui type` sólo acepta selectors por `--description`/`--ref`/etc., y que `--text` en este contexto ES el selector (no el texto). La confusión actual genera errores inevitables.

---

## 🟠 P1 — Alto Impacto

### 4. Daemon cold-start: hasta 1050ms de polling (35 × 30ms)

**Código**: [`client.ts:100-107`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/daemon/client.ts#L100-L107):
```typescript
for (let i = 0; i < 35; i++) {
  await new Promise((r) => setTimeout(r, 30));
  port = await this.getActivePort();
  ...
}
```

Cada iteración tiene `setTimeout(30)` + `fetch(/ping, timeout:300)` + `fetch(/ping, timeout:500)`. En el peor caso: 35 × (30 + 500) = **18.5s de espera posible** antes de lanzar el error. En el caso típico (Bun inicia en ~200ms), el agente espera 7–8 iteraciones innecesarias.

**Fix**: Backoff exponencial partiendo de 20ms, con un check de readiness por pipe (archivo de PID ready) en lugar de polling HTTP puro. Alternativamente, el servidor puede escribir el config JSON ANTES de que el puerto esté listo, y el cliente puede esperar solo el ping.

---

### 5. Doble llamada a `deviceInfo()` en `/snapshot`

**Código**: [`server.ts:116`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/daemon/server.ts#L116) llama `client.deviceInfo()` para obtener `packageName`. Luego en línea 128 llama `getScreenDimensions(client)` que internamente TAMBIÉN llama `client.deviceInfo()` (si no está cacheado todavía).

```typescript
// snapshot handler
const info = await client.deviceInfo();        // llamada 1
packageName = info.currentPackageName;
...
const { width, height } = await self.getScreenDimensions(client);  // llamada 2 → deviceInfo()
```

**Fix**: Pasar `info` directamente a `getScreenDimensions` o extraer `width/height` del mismo `info` ya obtenido y cachearlo:
```typescript
this.deviceInfoCache = { width: info.displayWidth || 1080, height: info.displayHeight || 2340 };
```

---

### 6. `computeScreenFingerprint` usa SHA-256 sobre datos ya procesados, con sort

**Código**: [`ui.ts:35-42`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/domains/ui.ts#L35-L42):
```typescript
const tuples = elements.map(e => `${e.resourceId}:${e.text}:${e.contentDesc}:...`);
tuples.sort();
const raw = tuples.join("|");
return createHash("sha256").update(raw, "utf-8").digest("hex").slice(0, 16);
```

SHA-256 es overkill para detectar cambios de pantalla. Un hash FNV-1a o xxHash de 32 bits es 4–8× más rápido. El `sort()` también es O(n log n) innecesario — el orden de los elementos ya es determinista si el XML dump lo es.

**Fix**: Reemplazar SHA-256 con un hash rápido no criptográfico (FNV-1a en JS puro son ~10 líneas). Evaluar si el sort es necesario dado que uiautomator siempre emite el árbol en orden top-down.

---

### 7. `deduplicateAndFilterElements`: grid de celdas recalculada en cada call

**Código**: [`ui.ts:92-201`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/domains/ui.ts#L92-L201) — Se construye un spatial grid de 150px²/celda para detectar solapamientos, iterando O(n²) en el peor caso con los candidatos por celda.

Problema: este proceso se ejecuta en CADA snapshot/dump, incluso cuando la pantalla no cambió (fingerprint idéntico).

**Fix**: Cachear el resultado de `deduplicateAndFilterElements` en el daemon keyed por fingerprint del XML crudo. Si el XML no cambió, devolver el resultado cacheado directamente.

---

## 🟡 P2 — Mejoras Moderadas

### 8. `ui dump` no usa daemon — cold-start en cada invocación

**Código**: [`ui.ts:616`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/domains/ui.ts#L616) — `ui.dump` handler crea siempre un `DeviceSession` nuevo:
```typescript
const session = new DeviceSession(ctx.serial, ctx.timeout);
const client = await session.connect();
```

No pasa por el daemon. Esto significa que cada `ui dump` paga el costo de un port-forward ADB + conexión HTTP al uiautomator2 runtime (~200–400ms extra sobre Wi-Fi).

**Fix**: Agregar `use_daemon: true` a `ui.dump` igual que `ui.snapshot`. El daemon ya tiene la conexión al runtime establecida y caliente.

---

### 9. Output `renderOutput` tiene lógica de detección frágil (duck typing)

**Código**: [`output.ts:137-151`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/output.ts#L137-L151) — detecta si imprimir `"ok"` chequeando `res.tapped || res.success || res.pressed || res.swiped || ...`

Si un futuro comando tiene un resultado que no matchea ninguno de esos campos, cae al `JSON.stringify(res, null, 2)` — violando la invariante de output compacto.

**Fix**: Hacer la detección explícita por `envelope.command` (ya está disponible) en lugar de duck typing sobre el resultado. Cada comando conoce su tipo de output.

---

### 10. `ui type` — selector `--text` ambiguo (UX de agente)

Ya mencionado en P0/3 pero hay otra dimensión: en la SKILL.md se documenta que `--text` es un selector, pero en `ui type` el `--text` es el texto a tipear. Un agente nuevo que lee la tabla de selectores va a asumir que puede usar `ui type --text "algo a tipear"` con semántica de selector + tipo, lo cual es el bug #3.

**Fix de UX**: Renombrar el argumento del texto a tipear como `--value` en `ui type`, o actualizar la SKILL.md con una advertencia explícita.

---

## 📊 Tabla de Impacto Resumida

| # | Hallazgo | Latencia ahorrada | Tokens ahorrados | Dificultad |
|---|---|---|---|---|
| 1 | Bug `--ref @N` en CLI parser | 800ms–2s por acción | ~50% en flujo handle-first | Trivial (1 línea) |
| 2 | `ui state` hace dump completo | 500ms–1.5s | N/A | Moderada |
| 3 | `ui type` selector ambiguo | 1–2 rounds extra | 30–80 tokens/error | Baja |
| 4 | Daemon cold-start polling | 200ms–1s típico | N/A | Baja |
| 5 | Doble `deviceInfo()` en snapshot | ~50ms | N/A | Trivial |
| 6 | SHA-256 en fingerprint | ~2ms/call | N/A | Baja |
| 7 | Dedup no cacheado | ~5ms/call | N/A | Moderada |
| 8 | `ui dump` sin daemon | 200–400ms | N/A | Baja |
| 9 | Output duck typing frágil | — | futuro leak | Baja |

---

## Observación de Sesión Real

Durante la tarea YouTube el agente realizó **18 comandos** para un flujo que con `--ref @N` funcional requeriría **~10**. Los 8 extras se deben directamente al bug #1 (handles inutilizables → fallback a dump + selector de texto).

**Costo real observado**: ~90 segundos para abrir YouTube, buscar y dar like.  
**Estimado con bug #1 corregido**: ~45–50 segundos (mismo flujo, mitad de rondas ADB).

---

> **Recomendación inmediata**: Corregir el bug del parser CLI (#1) — es una línea de código y desbloquea la feature de handles que es la razón de ser del daemon.
