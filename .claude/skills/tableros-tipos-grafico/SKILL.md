---
name: tableros-tipos-grafico
description: Explica el soporte de tipos de gráfico (barra/línea/torta) en los tableros de Ventas y Compras de este proyecto. Úsalo cuando se pida agregar, tocar o depurar el selector "Tipo de gráfico", el partial views/grafico-cuerpo.ejs, o el parámetro tipoGrafico en las rutas de /tableros.
---

# Tipos de gráfico en los tableros Ventas y Compras

## Qué cambió

Antes, los tableros especiales "Ventas" (`tableros/ventas.yaml`, tipo
`ventas_mensual`) y "Compras" (`tableros/compras.yaml`, tipo
`compras_mensual`) solo dibujaban sus gráficos como barras, sin importar
nada más. El tablero genérico (`views/tablero-detalle.ejs`) sí soportaba
barra/línea/torta desde antes (vía `def.grafico.tipo_grafico`, editable
por el comando de chat `cambiar tipo de grafico a <tipo> en <id>`), pero
Ventas y Compras no pueden editarse por chat (son "tipo especial", ver
`TABLEROS_ESPECIALES` en `src/chat.js`), así que esa vía no les servía.

Ahora los tres gráficos de Ventas (Top productos, Ventas por vendedor,
Top clientes) y los dos de Compras (Top productos comprados, Total por
proveedor) también soportan línea y torta, elegibles con un selector
"Tipo de gráfico" en la misma barra de filtros donde están período/
empresa/vendedor (o proveedor).

## Cómo funciona

1. **Partial reutilizable**: `views/grafico-cuerpo.ejs` contiene toda la
   lógica de renderizado (barras con `<div class="bar-fill">`, línea con
   un `<svg><polyline>`, torta con `conic-gradient`) que antes estaba
   duplicada/solo disponible en `tablero-detalle.ejs`. Recibe `grafico`
   (`{ titulo, entradas, max }`) y `tipo` (`'barra' | 'linea' | 'torta'`,
   default `'barra'`), y también maneja el caso "sin datos".
2. **Selector en el formulario de filtros**: `views/ventas-mensual.ejs`
   y `views/compras-mensual.ejs` agregan un `<select name="tipoGrafico">`
   dentro del `<form method="GET">` existente. Al enviar el formulario
   (botón "Aplicar"), el valor viaja como query param, igual que
   `periodo`/`empresa`/`vendedor`/`proveedor` — no hay JS nuevo, es el
   mismo patrón de recarga de página que ya usaban los demás filtros.
3. **Validación en el backend**: `src/routes/tableros.js` define
   `TIPOS_GRAFICO_VALIDOS` (`Set(['barra','linea','torta'])`) y
   `tipoGraficoDesdeQuery(query)`, que devuelve el valor si es válido o
   `'barra'` por defecto. Esto se usa en las dos rutas especiales
   (`ventas_mensual`, `compras_mensual`) y el resultado se agrega al
   objeto `filtros` que ya se pasaba a la vista.
4. **La vista pasa `filtros.tipoGrafico`** a cada `include('grafico-cuerpo', { grafico: <X>, tipo: filtros.tipoGrafico })`.

El tablero genérico (`tablero-detalle.ejs`) también fue migrado a usar
este mismo partial en vez de tener su propia copia del código — mismo
comportamiento que antes, ahora sin duplicación.

## Archivos tocados

- `views/grafico-cuerpo.ejs` (nuevo) — el partial con las 3 variantes de render.
- `views/tablero-detalle.ejs` — usa el partial en vez de código inline.
- `views/ventas-mensual.ejs` — selector + partial en sus 3 gráficos.
- `views/compras-mensual.ejs` — selector + partial en sus 2 gráficos.
- `src/routes/tableros.js` — `TIPOS_GRAFICO_VALIDOS`, `tipoGraficoDesdeQuery()`, y el campo `tipoGrafico` agregado a `filtros` en ambas rutas especiales.

## Si hay que extender esto

- **Nuevo tipo de gráfico** (ej. "área" o "dona"): agregarlo primero en
  `grafico-cuerpo.ejs` (una rama más del `if/else if`), sumarlo a
  `TIPOS_GRAFICO_VALIDOS` en `tableros.js`, y agregar la opción al
  `<select>` en las vistas donde deba aparecer.
- **Un tablero especial nuevo** (otro `src/*-mensual.js` + su vista):
  reusar `include('grafico-cuerpo', { grafico, tipo: filtros.tipoGrafico })`
  para cada gráfico en vez de escribir barras a mano, y agregar el mismo
  bloque de `<select id="tipoGrafico">` al formulario de filtros.
- El comando de chat `cambiar tipo de grafico a <tipo> en <id>` sigue
  sin aplicar a Ventas/Compras (siguen bloqueados por
  `TABLEROS_ESPECIALES`) porque su preferencia de tipo vive en la URL
  (query param), no en un YAML — no hay nada que ese comando pueda
  escribir. Si en el futuro se quiere controlar esto por chat, habría
  que decidir dónde persistir la preferencia (sesión, cookie, o un YAML
  de configuración aparte), no reusar `guardarSiValido`.
