# ambiente-pruebas

Repositorio de ambiente de pruebas para desarrollo.

## Tableros de consulta Odoo

Herramienta web (Express) que permite a los usuarios de Odoo consultar tableros
predefinidos sobre distintos módulos (ventas, compras, etc.) sin acceso directo
a la base de datos.

### Cómo funciona

1. **Conexión a la base de datos**: se realiza vía XML-RPC de Odoo
   (`/xmlrpc/2/common` y `/xmlrpc/2/object`), nunca por SQL directo. El host,
   la base de datos y la **API key de servicio** (`ODOO_URL`, `ODOO_DB`,
   `ODOO_LOGIN`, `ODOO_API_KEY`) se configuran una sola vez en
   `ambiente-pruebas.env`. Esa API key es el único método de conexión que la
   app usa para consultar Odoo (`fields_get`, `search_read`, etc.); ninguna
   consulta de datos usa la contraseña de un usuario.
2. **Usuarios**: son los definidos en Odoo. Cada usuario inicia sesión con su
   **login y contraseña de Odoo** (los mismos que usa para entrar a Odoo). Esa
   autenticación solo confirma su identidad (y, para los administradores, si
   pertenecen al grupo `base.group_system`); las consultas de los tableros
   siempre corren por la conexión de servicio del punto anterior, no con el
   usuario que inició sesión.
3. **Tableros como archivos de texto**: cada tablero es un archivo YAML en
   [tableros/](tableros/), editable directamente por el administrador del
   sistema sin tocar código. Los dos tableros que trae el repo (Ventas,
   Compras) ya usan el patrón de tipo especial (punto 6), pero un tablero
   genérico se ve así:

   ```yaml
   titulo: "Facturas"
   modulo: contabilidad
   modelo: account.move
   campos:
     - campo: name
       etiqueta: "Factura"
     - campo: amount_total
       etiqueta: "Total"
   dominio: []
   orden: "invoice_date desc"
   limite: 80
   grafico:
     titulo: "Total facturado por cliente"
     agrupar_por: partner_id
     medir: amount_total
   ```

   El bloque `grafico` (opcional) hace que el tablero muestre, apenas se
   abre, un gráfico de barras con la suma de `medir` agrupada por
   `agrupar_por` (top 8), antes de la tabla de detalle. `agrupar_por` y
   `medir` pasan por la misma evaluación semántica que el resto de los
   campos.

4. **Evaluación semántica**: antes de mostrar cualquier tablero, la app llama
   a `fields_get` sobre el `modelo` indicado (por la conexión de servicio) y
   verifica que:
   - el modelo exista y sea accesible,
   - cada `campo` listado exista en el modelo,
   - cada campo usado en `dominio` (filtros) exista en el modelo.

   Si algo falla, el tablero **no se ejecuta ni se muestra** a los usuarios
   normales. Los administradores de Odoo (grupo `base.group_system`) sí ven,
   en `/tableros`, la lista de tableros inválidos junto con el motivo exacto
   del error, para poder corregir el archivo YAML.

5. **Orden de las pestañas**: cada tablero puede declarar `posicion` (número)
   para fijar su lugar entre las pestañas del workspace; a igual `posicion` se
   ordenan por nombre de archivo. Sin `posicion`, un tablero queda al final.
   Orden actual: Ventas (1, pestaña inicial — `/tableros` redirige ahí),
   Compras (2).

6. **Tableros de tipo especial** (`src/agregaciones.js` + un módulo por
   tablero): cuando un tablero necesita combinar dos modelos y filtros
   interactivos que el motor genérico de `campos`/`grafico` no soporta, sigue
   este patrón: un `tipo` propio en el YAML, un módulo `src/<tipo>.js` con su
   lógica, una vista propia, y una entrada en `CAMPOS_POR_TIPO`
   (`src/tableros.js`) para que la evaluación semántica lo siga cubriendo.
   `src/agregaciones.js` (`PERIODOS`, `rangoPeriodo`, `agrupadoAEntradas`) es
   compartido entre ambos: el cálculo de rango de fechas y la agregación
   "grupos de Odoo → [etiqueta, valor] ordenados" no son específicos de
   ventas ni de compras.

   - **Ventas** (`tableros/ventas.yaml`, `tipo: ventas_mensual`,
     `src/ventas-mensual.js`): combina `sale.order` y `sale.order.line`.
     - **Filtros** (por querystring, recargan la página): período, empresa
       (`res.company`) y vendedor (`user_id`). El selector de vendedor
       siempre lista a todos los vendedores con ventas registradas, sin
       importar el filtro activo, para poder cambiar de uno a otro sin
       perder opciones.
     - **Gráficos**: top 10 productos (`sale.order.line` agrupado por
       `product_id`, sumando `price_subtotal`), top clientes y ventas por
       vendedor (`sale.order` agrupado por `partner_id`/`user_id`, sumando
       `amount_total`).
   - **Compras** (`tableros/compras.yaml`, `tipo: compras_mensual`,
     `src/compras-mensual.js`): el mismo patrón sobre `purchase.order` y
     `purchase.order.line`, con **proveedor** (`partner_id`) en vez de
     vendedor.
     - **Filtros**: período, empresa y proveedor (mismo criterio: el
       selector de proveedor siempre lista a todos los proveedores con
       compras registradas).
     - **Gráficos**: top 10 productos comprados (`purchase.order.line`
       agrupado por `product_id`) y total comprado por proveedor
       (`purchase.order` agrupado por `partner_id`).

7. **Chat del panel principal** (`/tableros`, `src/chat.js` + `src/routes/chat.js`):
   **sin IA** — un parser de comandos de texto fijos (expresiones regulares), sin costo
   ni credenciales externas. Cada mensaje se compara contra una lista de patrones
   (`COMANDOS` en `src/chat.js`); si no coincide ninguno, responde sugiriendo escribir
   "ayuda". Dos tipos de comandos:
   - **Consulta de datos** (`top productos [de <período>]`, `top clientes [de ...]`,
     `ventas por vendedor [de ...]`, `ventas de <período>`, `campos de <modelo>`,
     `listar tableros`): reutilizan `obtenerDatosVentasMensuales` (mismas agregaciones
     del tablero "Ventas") o `fields_get` directo, siempre por la conexión de servicio.
   - **Edición de tableros genéricos** (`crear tablero ...`, `agregar/quitar campo ...`,
     `agregar grafico a ...`, `eliminar tablero ...`): modifican el objeto y llaman a
     `guardarSiValido`, que **reutiliza `validateDefinition`** (la misma evaluación
     semántica de los tableros normales) antes de escribir el YAML — si el campo o
     modelo no existe en Odoo, no se guarda nada y se devuelve el error. Los tableros
     especiales "ventas" y "compras" (`TABLEROS_ESPECIALES` en `src/chat.js`) están
     excluidos de todos los comandos de edición porque su lógica vive en código, no
     en YAML genérico.

   Ver la lista completa de comandos escribiendo `ayuda` en el chat, o en la constante
   `AYUDA` de `src/chat.js`.

8. **Diseño del workspace** (`views/layout-head.ejs`, `views/topbar.ejs`,
   `views/chat-panel.ejs`, `views/inspector.ejs`): cada tablero se ve como un
   workspace de 3 columnas — chat a la izquierda, el tablero (filtros, KPIs,
   gráficos, tabla) al centro, y un panel inspector a la derecha que se abre
   al hacer click en un gráfico marcado como `card selectable`. El inspector
   muestra el contexto semántico real de ese gráfico (métrica, dimensión,
   modelo, archivo donde está definido) tomado directamente de sus atributos
   `data-*`, que la ruta rellena con los valores reales del `grafico` del
   tablero — no hay una copia paralela de esa información.
9. **Deshacer / Historial** (`src/chat.js`: `registrarRespaldo`,
   `obtenerUltimoCambio`, `deshacerUltimoCambio`; ruta `POST /chat/deshacer`):
   antes de que un comando de chat escriba o borre un archivo de tablero, se
   guarda en memoria el contenido anterior (o `null` si el tablero no
   existía). El botón **Deshacer** del topbar restaura ese único respaldo —
   es un nivel, no un historial multi-versión — y el botón **Historial**
   muestra en el inspector cuál fue el último cambio pendiente de deshacer.

### Agregar un nuevo tablero

Basta con crear un archivo `.yaml` en `tableros/` con `modelo`, `campos` y,
opcionalmente, `titulo`, `modulo`, `dominio`, `orden`, `limite`, `grafico` y
`posicion`. No requiere reiniciar código de negocio: se valida y se lista
automáticamente. Un tablero con necesidades especiales (varios modelos,
filtros interactivos) sigue el patrón de `ventas_mensual`/`compras_mensual`:
un `tipo` propio, un módulo `src/<tipo>.js` (reutilizando `src/agregaciones.js`
para períodos/agregación), lógica dedicada en `src/routes/tableros.js`, una
vista propia, y su entrada correspondiente en `CAMPOS_POR_TIPO`
(`src/tableros.js`) para que la evaluación semántica lo cubra igual. Si ese
`tipo` no debe editarse por chat, agrégalo también a `TABLEROS_ESPECIALES`
en `src/chat.js`.

### Ejecutar

```bash
npm install
npm start   # http://localhost:3000
```

### Pruebas automatizadas

```bash
npm test    # node --test test/
```

Usa el test runner nativo de Node (`node:test` + `node:assert`), sin
dependencias nuevas. Nunca se conecta a Odoo de verdad: `src/odoo-client.js`
se expone como objeto (`const odooClient = require('./odoo-client')`, nunca
desestructurado) precisamente para que los tests puedan reemplazar
`odooClient.executeKw`/`odooClient.authenticate` con `t.mock.method(...)` y
quedar completamente aislados de la red.

- **`test/agregaciones.test.js`**: `rangoPeriodo` — invariantes de cada período
  (p. ej. `mes_anterior` termina justo donde empieza `este_mes`), sin
  necesidad de fijar la fecha del sistema; y `agrupadoAEntradas` — conversión
  de grupos de Odoo a `[etiqueta, valor]` ordenados, etiqueta "Sin asignar" y
  límite de entradas.
- **`test/tableros.test.js`**: `validateDefinition` — la evaluación semántica
  en sí: modelo/campo faltante o inexistente, campos usados en `dominio` o en
  `grafico`, y los tipos especiales `ventas_mensual`/`compras_mensual` contra
  `CAMPOS_POR_TIPO`.
- **`test/compras-mensual.test.js`**: `obtenerDatosCompras` — que el dominio
  de `purchase.order`/`purchase.order.line` incluya el proveedor filtrado, y
  que las agregaciones (top proveedores, top productos) salgan correctas.
- **`test/chat.test.js`**: `responderChat` — comandos de consulta (incluida
  la regresión del bug de normalización que rompía `sale.order` → `saleorder`),
  y el ciclo completo de edición: crear/agregar/quitar campo, la protección
  de los tableros "ventas" y "compras", y que `deshacerUltimoCambio` de verdad
  borre un tablero recién creado y restaure el YAML anterior en una edición.
  Escribe archivos reales bajo `tableros/` con un id de prueba
  (`test_tmp_chat`) y los limpia siempre en un hook `after`.
- **`test/app.test.js`**: integración de rutas sobre `src/app.js` (la app de
  Express separada de `app.listen`, ver `src/index.js`) — sesión requerida en
  rutas protegidas, login inválido/válido, y que `/tableros` redirige al
  primer tablero válido con datos reales de la página renderizada (Ventas y
  Compras).

Variables de entorno usadas (`ambiente-pruebas.env`, no se sube al repo):
`ODOO_URL`, `ODOO_DB`, `ODOO_LOGIN`, `ODOO_API_KEY` (conexión de servicio a
la base de datos) y `SESSION_SECRET`. El login de cada persona en el
formulario web usa su propio usuario y contraseña de Odoo, no estas
variables.
