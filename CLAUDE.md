# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm install
npm start                        # arranca en http://localhost:3000
npm run dev                      # con --watch
npm test                         # node --test test/  (toda la suite)
node --test test/chat.test.js    # un solo archivo de test
node --test test/chat.test.js --test-name-pattern="restaurar"   # un test puntual
```

No hay linter ni build configurados. Los tests usan el runner nativo de Node
(`node:test` + `node:assert`), sin dependencias nuevas, y **nunca se conectan
a Odoo real**: `src/odoo-client.js` se exporta como objeto (nunca
desestructurado) justo para que los tests reemplacen
`odooClient.executeKw`/`odooClient.authenticate` con `t.mock.method(...)`.

Variables de entorno (`ambiente-pruebas.env`, no se sube al repo):
`ODOO_URL`, `ODOO_DB`, `ODOO_LOGIN`, `ODOO_API_KEY` (conexión de servicio,
única vía de acceso a datos de Odoo) y `SESSION_SECRET`. El login web de
cada persona usa su propio usuario/contraseña de Odoo — solo confirma
identidad y grupo (`base.group_system` = admin); nunca se usa para consultar
datos.

## Arquitectura

Express + EJS + XML-RPC contra Odoo, **sin acceso SQL directo y sin LLM**
(el chat es un parser de comandos por regex, determinista). Piezas
principales, todas bajo `src/`:

- **`odoo-client.js`**: único punto de conexión XML-RPC a Odoo
  (`fields_get`, `search_read`, `read_group`, `authenticate`). Todo lo
  demás pasa por acá.
- **Tableros genéricos** (`tableros.js` + archivos `.yaml` en `tableros/`):
  un tablero es un YAML con `modelo`, `campos`, `dominio`, `grafico`, etc.,
  editable a mano por un admin. Antes de mostrarse, `validateDefinition`
  llama a `fields_get` y verifica que modelo/campos/dominio existan en Odoo
  de verdad; si falla, el tablero no se muestra a usuarios normales (los
  admins sí ven el motivo del error en `/tableros`).
- **Tableros de tipo especial** (`agregaciones.js` + un módulo por tablero,
  ej. `ventas-mensual.js`/`compras-mensual.js`): para cuando un tablero
  necesita combinar modelos y filtros interactivos que el motor genérico no
  cubre. Patrón: `tipo` propio en el YAML → módulo `src/<tipo>.js` → vista
  propia → entrada en `CAMPOS_POR_TIPO` (`tableros.js`) para que la
  evaluación semántica lo siga cubriendo. Si ese tipo no debe editarse por
  chat, se agrega a `TABLEROS_ESPECIALES` en `chat.js` (caso de "ventas" y
  "compras": su lógica vive en código, no en YAML).
- **Capa semántica** (`semantica.js` + `semantica/conceptos.yaml`):
  diccionario negocio → modelo/campo real de Odoo (`modulo`, `modelo`,
  `campo`, `tipo`: `dimension`/`medida`, `dominio` opcional). Permite pedir
  tableros por nombre de negocio sin conocer nombres técnicos.
  `construirDefinicionDesdeConceptos` arma la definición del tablero desde
  ahí y siempre termina pasando por `validateDefinition` igual que un YAML
  escrito a mano — la capa semántica nunca se salta la validación.
- **Chat** (`chat.js` + `routes/chat.js`): un array `COMANDOS` de
  `{ patron: RegExp, accion }`. Tres familias de comandos: (1) consulta de
  datos de Ventas/Compras/CRM/Financiero/Inventario/Producción
  (`consultas-modulos.js`, siempre lectura); (2) edición de tableros
  genéricos (`crear/agregar/quitar campo/eliminar tablero`,
  `cambiar tipo de grafico`) que reutiliza `validateDefinition` antes de
  escribir cualquier YAML; (3) capa semántica (`conceptos`, `consultar
  <medida> por <dimension>`, `sugerir/crear tablero de <modulo> con
  <conceptos>`). Todos comparten `sugerirConceptoParecido` (distancia de
  edición) para proponer el nombre correcto cuando un concepto está mal
  escrito.
- **Deshacer / versionado**: `registrarRespaldo`/`deshacerUltimoCambio` en
  `chat.js` es un respaldo de un solo nivel en memoria. `versiones.js` es el
  historial completo y persistente (`tableros/.versiones/<id>.yaml`, nunca
  se comitea — ver `.gitignore`): cada guardado válido agrega una versión;
  "restaurar" también queda versionado (el historial solo crece, nunca se
  reescribe). Ambos mecanismos respetan `TABLEROS_ESPECIALES`.
- **Rutas** (`routes/tableros.js`, `routes/chat.js`, `routes/semantica.js`):
  `ejecutarTableroGenerico()` centraliza consulta + agregación + formateo
  para cualquier tablero genérico (usado tanto por `/tableros/:id` como por
  `/tableros/vista-previa`, que ejecuta en vivo la sugerencia del chat sin
  guardar nada). `/semantica` (alta/edición/borrado de conceptos) requiere
  `base.group_system` vía `requireAdmin`.
- **Vistas** (`views/`): workspace de 3 columnas — chat a la izquierda,
  tablero al centro, inspector a la derecha (se abre con click en un
  gráfico `card selectable`, mostrando su contexto semántico real desde
  atributos `data-*`, sin copia paralela de esa info).
  `views/grafico-cuerpo.ejs` es el partial compartido para las 3 variantes
  de gráfico (`barra`/`linea`/`torta`) — todas las vistas que dibujan un
  gráfico lo incluyen con `include('grafico-cuerpo', { grafico, tipo })` en
  vez de duplicar el render.

### Agregar un tablero nuevo

Un YAML en `tableros/` con `modelo` + `campos` alcanza para el caso
genérico — se valida y lista solo, sin reiniciar código. Para necesidades
especiales, seguir el patrón `ventas_mensual`/`compras_mensual` descrito
arriba.

### Convención de skills del proyecto

`.claude/skills/` documenta features no triviales a medida que se agregan
(ver `tableros-tipos-grafico/SKILL.md` como ejemplo). Al terminar un cambio
de arquitectura o un comando de chat nuevo, conviene sumar una skill
equivalente con: qué cambió, cómo funciona, archivos tocados, y cómo
extenderlo.
