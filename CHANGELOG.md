# Changelog

Historial de cambios de `ambiente-pruebas`, agrupado por hito. Formato:
fecha del commit, mensaje, hash corto. No sigue Keep a Changelog al pie de
la letra (no hay versiones de release), es un resumen legible del `git log`.

## 2026-09-30

- **c97ce1e** — Agregar vista previa en vivo desde el chat y selector de
  tipo de gráfico. "sugerir tablero de `<modulo>` con `<conceptos>`" ahora
  ejecuta contra Odoo y renderiza el resultado en el panel central
  (`/tableros/vista-previa`) en vez de solo mostrar el YAML como texto.
  Ventas y Compras Mensual suman un selector "Tipo de gráfico"
  (barra/línea/torta). El render de gráficos se deduplicó en el partial
  `views/grafico-cuerpo.ejs`. Ver skill [`vista-previa-chat`](.claude/skills/vista-previa-chat/SKILL.md).

## 2026-09-21 — Capa semántica, chat como agente e interpretación de comandos

- **0f37ef8** — Comando "consultar `<medida>` por `<dimension>`": el chat
  interpreta y ejecuta contra Odoo en el momento, sin crear ni guardar
  ningún tablero.
- **3d03a64** — Conceptos de control de lotes en la capa semántica
  (módulo inventario): `lote`, `numero_lote`, `producto_lote`,
  `cantidad_lote`.
- **f9719d5** — Comando "cambiar tipo de grafico a barra|linea|torta en
  `<id>`" para tableros genéricos. Ver skill
  [`tableros-tipos-grafico`](.claude/skills/tableros-tipos-grafico/SKILL.md).
- **2b22ff9** / **fc5a1b9** — Versionador de tableros: historial completo
  y persistente de cada tablero genérico (`tableros/.versiones/`), con
  comandos de chat (`versiones de`, `ver version`, `restaurar version`,
  `eliminar versiones`) y un panel visual en el topbar (🕘 Historial) para
  no depender solo del chat.
- **c244622**, **9a74b71**, **bcf0c15**, **ca75d4d**, **424e86f** — Rediseño
  del hero de `/tableros`: título "Espacio Listo", atajos "Armar Tablero
  General de Ventas/Compras", sugerencias del hero como chips.
- **389b9a2** — El agente sugiere el concepto correcto (distancia de
  edición) cuando el chat recibe un nombre mal escrito.
- **5ba78a9** — El prompt "construir un tablero" pasa a ser la landing
  principal de `/tableros`.
- **e2ce8c1** — UI de administración (`/semantica`, solo admins) para
  gestionar conceptos de la capa semántica sin tocar YAML a mano.
- **f129e71** — Se agrega la capa semántica
  (`semantica/conceptos.yaml` + `src/semantica.js`) y el chat pasa a ser
  un agente determinista sobre ella (sin LLM).
- **4835a7b** — Comandos de consulta de CRM, Financiero, Inventario y
  Producción.
- **b05b4cd** — Filtros interactivos en el tablero de Compras.

## 2026-09-20 — Fundación del proyecto

- **f147316** — Suite de tests automatizados (`node:test`, sin
  dependencias nuevas).
- **b88e98a** — Rediseño como workspace de 3 columnas (chat + canvas +
  inspector).
- **ac06882** — Se reemplaza el chat con LLM por un parser de comandos
  fijos (determinista, sin costo de API).
- **ce378ec** — Primer chat (con Claude) en la página principal.
- **3604f95**, **b32b14c** — Se fusiona el dashboard de ventas mensuales
  con el tablero "Ventas"; orden de pestañas.
- **79f3790** — Primer gráfico de barras en cada tablero.
- **5e7bb0b** — Se separa el login de usuario de la conexión de servicio
  a Odoo (API key propia, nunca la contraseña del usuario).
- **bf36d4f** — Herramienta de tableros de Odoo con validación semántica
  contra `fields_get`.
- **4591449** — Primer script de consulta a Odoo (órdenes de venta) vía
  XML-RPC.
- **7085663** — Scaffold inicial de la API Express.
- **8f0a10e** — Commit inicial.
