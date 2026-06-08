# Cortex Brain — Frontmatter y configuración

## Qué es Cortex Brain

El panel **Brain** es una webview de VS Code que escanea archivos `.md`/`.mdx`
locales y construye un grafo de conocimiento: los nodos son documentos, tags,
accounts y referencias externas; las aristas representan relaciones como links,
`references`, `standards` o jerarquía de carpetas.

No requiere MongoDB — trabaja 100 % sobre el filesystem. Para abrirlo:
<kbd>Ctrl+Shift+P</kbd> → **Cortex: Open Brain**. Cortex pedirá seleccionar
una carpeta raíz (o usará el valor de `cortex.brainRootPath` si está
configurado).

## Estructura de carpetas

El directorio que elegís al abrir el panel **es el docs root**. El panel:

- Toma el primer subdirectorio bajo el root como **zona** (`accounting`, `dev`,
  `guides`, etc.). Cada zona genera su propio subárbol.
- Para cada doc, busca el `index.{md,mdx}` más cercano hacia arriba dentro de
  la misma zona. Ese es el padre (upstream).
- Si el root contiene un `index.md` o `index.mdx` directo, ese es el padre
  de todos los docs sin zona (archivos sueltos bajo el root).
- Los docs sin `index.md` ancestro en su zona quedan como `orphan` (no tienen
  aristas de árbol).

Ejemplo:

```
<root>/index.md                          (padre de todos los sueltos)
<root>/accounting/index.md               (root del subtree accounting)
<root>/accounting/page.md                (downstream de accounting/index)
<root>/accounting/sub/index.md           (downstream de accounting/index)
<root>/accounting/sub/page.md            (downstream de accounting/sub/index)
<root>/dev/index.md                      (root del subtree dev)
<root>/dev/page.md                       (downstream de dev/index)
```

Para proyectos **Astro Starlight**: elegí `src/content/docs/` como root al
abrir el panel. Las zonas serán tus carpetas bajo `docs/` (por ejemplo
`accounting/`, `guides/`).

## Frontmatter reconocido

El parser usa YAML estándar (librería `yaml`). Todos los campos son opcionales.

### Campos escalares

| Campo         | Tipo     | Uso                                                  |
| ------------- | -------- | ---------------------------------------------------- |
| `title`       | string   | Título visible del nodo (fallback: primer `# Heading`) |
| `description` | string   | Se muestra en el inspector y como tooltip             |
| `domain`      | string   | Tag opcional de dominio (se normaliza a lowercase)    |
| `layer`       | string   | Tag opcional de capa (normalizado a lowercase)        |
| `kind`        | string   | Mapea a `docKind` (page, guide, reference, etc.)      |
| `badge`       | string   | Etiqueta visible junto al título (stable, draft, …)   |

Ejemplo:

```yaml
---
title: "Mi página"
description: "Resumen corto"
domain: ventas
layer: standard
kind: page
badge: stable
---
```

### Tags

Dos formatos soportados:

```yaml
# Formato inline
tags: [foo, bar, baz]

# Formato block
tags:
  - foo
  - bar
```

Los tags se normalizan a lowercase, se trimean, y se eliminan duplicados.

### Bloque `related:`

Describe relaciones explícitas con otros documentos. El panel procesa tres
subsecciones (`references`, `standards`, `accounts`) y **dos se ignoran**
(`upstream` y `downstream` — esas se derivan automáticamente del filesystem).

```yaml
related:
  references:
    - /docs/otra-pagina
    - ./relativo.md
  standards:
    - /standards/x
  accounts:
    - "1100"
    - "9999"
  # upstream y downstream IGNORADOS — vienen del filesystem.
```

Las rutas pueden ser:

- **Absolutas** con `/` — se resuelven contra la route del doc destino.
- **Relativas** con `./` o `../` y sufijo `.md`/`.mdx`.
- **Stems sueltos** (`otra-pagina`) — resuelven si hay un único archivo con
  ese nombre base; si hay ambigüedad se reporta como `broken-ref`.

## Body: links y wikilinks

Además del frontmatter, el panel extrae relaciones desde el cuerpo del
documento:

- Markdown links: `[texto](/path)` o `[texto](./relativo.md)`.
- HTML: `<a href="/path">…</a>`.
- Wikilinks: `[[NombrePagina]]` (se resuelve por stem).

**Importante**: los links dentro de bloques de código fenced (`` ``` ``) y
spans de código inline (`` `[a](/b)` ``) se ignoran. Esto permite documentar
ejemplos de URL sin generar relaciones falsas.

## Accounts (opcional)

Si tu workspace usa una convención de rutas para identificar accounts
(por ejemplo `/manual-cuentas/<texto>/<numero>/`), puedes activar la
extracción automática desde el body con el setting:

| Setting                            | Tipo            | Default | Uso                                                |
| ---------------------------------- | --------------- | ------- | -------------------------------------------------- |
| `cortex.brainAccountPattern`       | string (regex)  | `""`    | Regex con un capture group para extraer account IDs |

Cuando el setting está vacío (default), solo se procesan los accounts
declarados explícitamente en `related.accounts` del frontmatter.

Ejemplo para el patrón legacy usado en workspaces _jean_d_arc_:

```json
"cortex.mdxGraphAccountPattern": "/manual-cuentas/[^)\\s\"']+(\\d{4,})/?"
```

El **capture group** `(\d{4,})` debe capturar el account ID que aparecerá como
nodo en el grafo. Si el regex es inválido, la extensión registra un warning y
desactiva la extracción sin bloquear el resto del scan.

## Issues que pueden aparecer en el inspector

Al hacer clic en un nodo, el inspector muestra los issues asociados:

| Kind              | Significado                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| `cycle`           | El doc participa de un ciclo en aristas upstream/downstream (raro)          |
| `broken-ref`      | Un link o `related` no resolvió a ningún nodo. Detalle: `<relation>: <href>` |
| `self-reference`  | El doc se referencia a sí mismo                                             |
| `orphan`          | El doc no tiene upstream ni downstream (común en modo flat)                 |
| `truncated`       | El scan alcanzó `cortex.mdxGraphMaxFiles` (default 800). Hay más archivos.  |

El chip **'Scan truncated (N/+)'** en el toolbar indica que el scan se cortó.
Para escanear más archivos: aumentar `cortex.mdxGraphMaxFiles`.

## Settings completos

| Setting                            | Tipo               | Default                              | Uso                                                |
| ---------------------------------- | ------------------ | ------------------------------------ | -------------------------------------------------- |
| `cortex.brainRootPath`             | string             | `""`                                 | Carpeta raíz predeterminada al abrir el panel      |
| `cortex.mdxGraphMaxFiles`          | number             | `800`                                | Máximo de archivos escaneados por refresh           |
| `cortex.brainAccountPattern`       | string (regex)     | `""`                                 | Regex con capture group para extraer accounts       |

## Refresh y file watcher

El panel se actualiza automáticamente:

- **File watcher**: al guardar cualquier `.md`/`.mdx` dentro de la raíz, con
  un debounce de 500 ms (BRAIN-02).
- **Cache por mtime**: cada archivo se cachea por su timestamp de modificación.
  Si no hubo cambios, el re-scan es casi instantáneo (BRAIN-04).
- **Refresh manual**: el botón **Refresh** en el toolbar sigue disponible.
- **Re-scan automático**: cambios en `cortex.brainAccountPattern` disparan un
  nuevo scan sin intervención.

## Limitaciones conocidas

- **Workspaces > 800 docs**: se muestra el chip 'Scan truncated'. Aumentar
  `cortex.mdxGraphMaxFiles` si es necesario.
- **Symlinks**: no se siguen; cada archivo se procesa una sola vez.
- **Solo YAML**: frontmatter en TOML o JSON no es soportado.
- **Layout orbit**: con nodos de más de 20 vecinos del mismo tipo puede
  saturarse visualmente. Usar layout **flow** para conjuntos densos.
- **Una sola raíz**: el panel muestra un solo workspace a la vez. Para cambiar,
  usar **Cortex: Open Brain** de nuevo.
