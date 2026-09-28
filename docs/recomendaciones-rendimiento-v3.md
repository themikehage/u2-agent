# u2bun — Recomendaciones de Rendimiento y Eficiencia (v3)

Documento de trabajo que **complementa** a la v1 (`docs/recomendaciones-rendimiento.md`) y a la v2 (`docs/recomendaciones-rendimiento-v2.md`). Cada recomendación cita evidencia (`archivo:línea`), impacto estimado y propuesta concreta. Prioridades: **P0** (bloquea o degrada cada interacción), **P1** (rendimiento/correctitud relevante), **P2** (ergonomía/consistencia).

> Origen: ejecución real de "like en Facebook" sobre `Mi_9_SE` (serial wifi `192.168.1.19:5555`). Los dos bugs de esta sesión ya están en revisión; esta v3 documenta su **causa raíz** y el fix de rendimiento, además de hallazgos nuevos.

---

## 1. Resolver el serial UNA vez, antes de construir el daemon (P0)

### Evidencia
- Todos los handlers `ui.*` construyen `new DaemonClient(ctx.serial)` (`ui.ts:422, 549, 629, 701, 754, 817, 886, 945, 997, 1077`).
- Cuando el CLI se invoca **sin** `--serial`, `ctx.serial` queda `undefined`. `DaemonClient.getActivePort()` llama `getDaemonConfigPath(this.serial)` (`client.ts:29`), que ejecuta `serial.replace(...)` sobre `undefined` (`server.ts:14`) → `TypeError: undefined is not an object (evaluating 'serial.replace')`.
- El path directo SÍ auto-resuelve el serial (`ui.ts:437` y `498`: `ctx.serial = session.serial` tras `connect()`), pero ese valor llega **después** de que el daemon ya falló.

### Impacto
Cada comando `ui.*` cae al fallback de RPC directo (cold-connect: `adb devices` + `forward` + `ping` + `dumpHierarchy` completo, 200–500 ms cada uno). El camino sub-15 ms del daemon queda **inutilizado de forma permanente** para todo el que no pase `--serial` a mano. Es el mayor costo de latencia observado en la sesión.

### Recomendación
1. Resolver el serial **una vez** al inicio del CLI (usar la lógica de `device auto` / `selectTargetDevice`) y guardarlo en `ctx.serial` **antes** de ejecutar cualquier handler. El valor ya está disponible vía `DeviceSession`; solo falta mover la resolución al arranque.
2. `DaemonClient` debe fallar explícito si `serial` es `undefined` (`UsageError`) en vez de crashear con `serial.replace`. Un guard temprano convierte un crash críptico en un error accionable.
3. (Verificación de regresión) Correr `ui snapshot` y `ui tap` sin `--serial` con un solo dispositivo online y confirmar que NO aparece `Daemon ... failed, falling back to direct RPC` en `stderr`.

---

## 2. La deduplicación colapsa jerarquías anidadas (P0)

### Evidencia
- `rectOverlapRatio` (`resolver.ts:13-30`) devuelve `intersectionArea / minArea`. Un elemento pequeño **totalmente contenido** en un contenedor grande produce ratio `1.0`, que supera el umbral de merge `0.85` (`ui.ts:134`).
- `deduplicateAndFilterElements` (`ui.ts:76-179`) mergea cualquier par con ratio `≥ 0.85`, **sin distinguir** ancestro/descendiente ni comparar áreas.
- Resultado observado en Facebook: `ui dump` devolvió `element_count: 1` (solo "Félix Fernandez de Pinedo") cuando el árbol crudo tenía ~50 nodos accionables (botón "Me gusta", "Comentar", "Compartir", etc.). El motor de selectores no puede alcanzar el botón de like, y el agente no puede distinguir "pantalla vacía" de "árbol colapsado".

### Recomendación
1. **No mergear ancestro↔descendiente**: solo mergear elementos cuyo `intersectionArea / maxArea` sea alto (i.e. áreas comparables). Cambiar `minArea` por `maxArea` en el merge de dedup (no en el matcher de `--bounds`, que sí quiere min). Un hijo dentro de un padre grande pasaría de ratio `1.0` a `≈0.12`, evitando el colapso.
2. **Nunca mergear dos elementos con `text`/`contentDesc` distintos y no vacíos**: si ambos tienen etiqueta semántica, son entidades distintas (un botón no debe tragarse a su contenedor ni a otro botón).
3. **Exponer el colapso**: devolver `raw_count` (nodos pre-dedup) junto a `element_count` en `ui.snapshot` / `ui.dump`. El valor ya se calcula (`totalCount` en `ui.ts:447`) pero no se emite. Así el agente sabe cuántos elementos se ocultaron.
4. (Regresión) Añadir un test con un dump sintético anidado (padre `[0,0][1080,2340]` + hijo botón `[0,1835][132,1967]`) que verifique que el botón **sobrevive** al dedup.

---

## 3. `ui dump --filter` está muerto y no hay escape hatch sin dedup (P1)

### Evidencia
- `ui.dump` declara `filter: z.enum(["actionable","all"])` (`ui.ts:483`) pero el handler **ignora** el flag: siempre llama `parseXmlDump(xml, ...)` (`ui.ts:501`).
- `parseXmlDump` **siempre** aplica `deduplicateAndFilterElements` al final (`ui.ts:349`). No existe ninguna vía para obtener la lista de elementos **sin** deduplicar.
- Consecuencia: `resolveSelector` opera solo sobre elementos ya colapsados; un elemento que el dedup se traga (como el "Me gusta" de Facebook) es **inalcanzable por selector**, aunque esté en el `raw_xml`.

### Recomendación
1. Implementar `--filter all` de verdad: `parseXmlDump(xml, includeSystemBars)` sin el paso final de dedup (extraer un parámetro `dedupe: boolean = true`).
2. **Fallback del resolver**: cuando `resolveSelector` no encuentra match sobre la lista dedup, reintentar sobre la lista cruda antes de lanzar `SELECTOR_NOT_FOUND`. Elimina la clase de fallo "el elemento existe pero el dedup lo ocultó".
3. Mantener `raw_xml` solo bajo `--raw` (ya es así) para no inflar tokens por defecto.

---

## 4. Tap por coordenadas crudas (`--pos X,Y`) (P1)

### Evidencia
- `ui.tap` no tiene modo de coordenada: solo selectores (`ref`, `text`, `description`, `bounds`, etc. — `ui.ts:522-529`). `tools show ui.tap` lo confirma: no hay `pos`.
- En la sesión, para likear el post (elemento inalcanzable por selector) hubo que abusar de `ui swipe --from-pos X,Y --to-pos X,Y --duration 80`. Como el botón de like es `long-clickable="true"`, el swipe al mismo punto se registró como **long-press** y abrió el selector de reacciones en vez de likear.

### Recomendación
1. Añadir `pos: z.string().optional()` a `ui.tap` (formato `"X,Y"`) que llame directamente `client.click(x, y)` sin resolver selector ni hacer dump previo. Es el fallback determinista cuando un elemento no es seleccionable.
2. Documentar explícitamente que `ui swipe` con origen = destino **equivale a long-press** sobre elementos long-clickable (no es un tap). O bien añadir `ui tap --pos` y dejar `swipe` como gesto puro.
3. (Consistencia) El `--bounds` selector debería seguir siendo la vía "semántica" preferida; `--pos` es el escape de último recurso.

---

## 5. Umbrales de overlap divergentes (P2)

### Evidencia
Existen tres umbrales distintos para el mismo concepto (solapamiento de rectángulos):
- `0.85` — merge en dedup (`ui.ts:134`).
- `0.80` — match de selector `--bounds` (`resolver.ts:56`).
- `0.90` — desambiguación de matches (`resolver.ts:105`).

### Recomendación
Consolidar en una única constante documentada (p. ej. `OVERLAP_MERGE = 0.85`, `OVERLAP_MATCH = 0.80`, `OVERLAP_AMBIGUOUS = 0.90`) con comentario que explique por qué difieren. Reduce el riesgo de regresiones silenciosas al tocar cualquiera de los tres.

---

## 6. `ui.dump` trunca en orden de documento; `ui.snapshot` ordena por relevancia (P2)

### Evidencia
- `ui.snapshot` aplica `sortByRelevance(...).slice(0, limit)` (`ui.ts:448-450`).
- `ui.dump` hace `elements.slice(0, limit)` **en orden de documento**, sin ordenar (`ui.ts:503-505`).
- El mismo elemento puede quedar dentro del top-30 en un comando y fuera en el otro, según la vía usada.

### Recomendación
Aplicar el mismo `sortByRelevance` en `ui.dump` antes del truncado (o documentar que `dump` es "orden de documento" a propósito). Un solo criterio de orden reduce la confusión del agente entre ambos comandos.

---

## 7. Salida UTF-8 explícita en Windows (P2)

### Evidencia
En `ui dump --raw` sobre Windows, los `content-desc` con acentos (`"Félix"`, `"Botón"`) se capturan como `F????lix` / `Bot????n`. El árbol de uiautomator2 es UTF-8; la pérdida ocurre en la codificación de `stdout`.

### Recomendación
1. Asegurar que `process.stdout`/`stderr` escriban UTF-8 de forma explícita (Bun en Windows puede heredar la codificación de la consola). El proyecto hermano `u2ctl` ya lo contempla (`AGENTS.md`: "UTF-8 stdout/stderr explicitly handled", `PYTHONUTF8=1`).
2. Añadir un test que fuerce un `content-desc` con caracteres no-ASCII y verifique que llega intacto por `stdout` (no como `????`).

---

## Resumen de prioridades

| # | Recomendación | Prioridad | Impacto |
|---|---|---|---|
| 1 | Resolver serial una vez antes del daemon | P0 | Restaura el camino sub-15 ms; elimina fallback frío en TODOS los comandos |
| 2 | Fix dedup ancestro↔descendiente + emitir `raw_count` | P0 | Selector alcanza elementos reales; el agente distingue "colapsado" de "vacío" |
| 3 | `--filter all` real + fallback de resolver a lista cruda | P1 | Escape hatch para elementos que el dedup oculta |
| 4 | `ui tap --pos X,Y` (click crudo) | P1 | Fallback determinista sin abusar de `swipe` |
| 5 | Consolidar umbrales de overlap | P2 | Menos regresiones silenciosas |
| 6 | Unificar orden de truncado dump/snapshot | P2 | Consistencia top-30 |
| 7 | UTF-8 explícito en Windows | P2 | `content-desc` legibles, menos tokens basura |

---

## Benchmarking sugerido (suma a v1 §9 y v2 §6)

1. **Daemon warm sin `--serial`**: `ui tap --ref @1` sobre feed denso; objetivo `< 15 ms` y **cero** warnings `Daemon ... failed`.
2. **Dedup anidado**: dump sintético con contenedor full-width + botón hijo; el botón debe sobrevivir (`element_count` refleja el botón, `raw_count` reporta el total).
3. **Fallback de resolver**: elemento presente solo en `raw_xml` debe ser alcanzable vía selector tras el fallback (no `SELECTOR_NOT_FOUND`).
4. **UTF-8**: `content-desc` con `á/é/ñ` debe llegar intacto por `stdout`.
