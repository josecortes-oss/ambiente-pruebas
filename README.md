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
   Orden actual: Ventas (1), Compras (2).

5b. **Página de inicio** (`GET /tableros`, `views/tableros-inicio.ejs`): ya no
    redirige a un tablero — muestra, dentro del mismo canvas de siempre, un
    hero "Escribe en Chat que necesitas construir en Tableros"
    con chips de las combinaciones dimensión+medida más usadas de Ventas y
    Compras (`SUGERENCIAS_HERO` en `src/routes/tableros.js`). Cada chip
    dispara un evento `chat-enviar-comando` (`document.dispatchEvent`) que
    `views/chat-panel.ejs` escucha y envía como si el usuario lo hubiera
    escrito — mismo mecanismo que ya usaba el topbar para abrir el
    historial, para no acoplar la página al chat directamente. Las
    sugerencias se filtran contra `semantica.resolverConcepto` antes de
    mostrarse, para que un concepto renombrado o borrado desde `/semantica`
    nunca deje un chip roto. Los tableros ya creados siguen accesibles por
    las pestañas del topbar, como siempre.

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
   "ayuda". Tres tipos de comandos:
   - **Consulta de datos de Ventas/Compras** (`top productos [de <período>]`,
     `top clientes [de ...]`, `ventas por vendedor [de ...]`, `ventas de <período>`,
     `campos de <modelo>`, `listar tableros`): reutilizan `obtenerDatosVentasMensuales`
     (mismas agregaciones del tablero "Ventas") o `fields_get` directo, siempre por la
     conexión de servicio.
   - **Consulta de datos de CRM, Financiero, Inventario y Producción**
     (`src/consultas-modulos.js`, sin filtro de período — son resúmenes directos):
     - CRM (`crm.lead`): `pipeline crm`, `top oportunidades`,
       `oportunidades por etapa`, `oportunidades por vendedor`.
     - Financiero (`account.move`): `facturas pendientes`, `top clientes facturacion`,
       `facturas por estado`.
     - Inventario (`stock.quant`, restringido a ubicaciones internas):
       `top productos en stock`, `stock de <producto>` (busca por nombre, `ilike`),
       `productos sin stock`.
     - Producción (`mrp.production`): `resumen produccion`, `produccion por estado`,
       `top productos producidos` (solo órdenes terminadas).

     Estas consultas no pasan por `validateDefinition` antes de ejecutarse (no son
     tableros, son código fijo que ya referencia campos reales verificados contra
     Odoo durante el desarrollo), a diferencia de los tableros YAML.
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
10. **Capa semántica** (`semantica/conceptos.yaml`, `src/semantica.js`): un
    diccionario de negocio → modelo/campo real de Odoo, para no tener que
    conocer nombres técnicos al pedir un tablero. Cada concepto tiene
    `modulo`, `modelo`, `campo`, `tipo` (`dimension` o `medida`, con
    `agregacion` para medidas), `etiqueta`, `descripcion` y, opcionalmente,
    un `dominio` base (ej. `valor_esperado` en CRM solo cuenta oportunidades
    abiertas). Se derivó de lo que ya usaban Ventas/Compras y
    `src/consultas-modulos.js` — no son campos inventados, y
    `validarConceptos()` (comando `validar conceptos`) confirma contra Odoo,
    vía `fields_get`, que cada modelo/campo sigue existiendo — misma lógica
    que `validateDefinition`, pero para la capa semántica en sí.

    El chat actúa como un agente simple sobre esta capa (determinista, sin
    IA — ver punto 7): **lee** (`conceptos`, `conceptos de <modulo>`),
    **sugiere** (`sugerir tablero de <modulo>[ con <conceptos>]`, muestra el
    YAML propuesto sin guardar nada) y **crea** (`crear tablero <id> de
    <modulo>[ con <conceptos>]`) tableros combinando conceptos. Sin `con`,
    usa `sugerirConceptosPorDefecto` (hasta 2 dimensiones + 1 medida del
    modelo con más conceptos en ese módulo, para no mezclar, por ejemplo,
    conceptos de cabecera de venta con conceptos de línea de venta). El
    tablero que resulta es un tablero genérico normal (mismo formato que
    cualquier YAML de `tableros/`) y pasa por `guardarSiValido`/
    `validateDefinition` igual que `crear tablero <id>: modelo ...` — la
    capa semántica solo evita escribir modelo/campo a mano, no se salta
    ninguna validación.

    Toda solicitud de "sugerir"/"crear tablero ... con <conceptos>" pasa
    siempre por esta capa para interpretarse — nunca arma la definición del
    tablero a mano fuera de `construirDefinicionDesdeConceptos`. Si el
    usuario escribe mal un concepto (ej. "clientes" en vez de "cliente"),
    `sugerirConceptoParecido` (distancia de edición/Levenshtein,
    `src/semantica.js`) busca el nombre real más cercano dentro del mismo
    módulo y el chat responde `"clientes" no existe — ¿quisiste decir
    "cliente"?` en lugar de solo rechazar la solicitud — la forma en la que
    el agente "sugiere mejoras" cuando no puede interpretar literalmente lo
    pedido.

11. **Administración de la capa semántica** (`/semantica`, `src/routes/
    semantica.js`, `views/semantica.ejs`): página para agregar, editar y
    eliminar conceptos sin tocar el YAML a mano. **Solo administradores**
    (grupo `base.group_system` de Odoo) — `requireAdmin` en
    `src/routes/semantica.js` verifica sesión + `has_group` antes de dejar
    pasar; sin ese grupo responde `403`. El link "🧩 Conceptos" del topbar
    (`views/topbar.ejs`) también es condicional a `esAdmin`, igual que el
    aviso de tableros inválidos.

    Cada guardado corre `guardarConcepto` → `validarConceptoIndividual`, que
    valida forma (campos obligatorios, `tipo` válido, medidas con
    `agregacion`) y, contra Odoo (`fields_get`), que el modelo exista y que
    tanto `campo` como los campos usados en `dominio` existan ahí — si algo
    falla, no se escribe nada y se muestra el error en la misma página. La
    edición no permite renombrar (el nombre es la clave primaria del
    concepto); para eso hay que eliminar y crear uno nuevo.

    `semantica/conceptos.yaml` completo se reescribe en cada guardado o
    eliminación (`yaml.dump` no preserva comentarios ni formato original);
    `src/semantica.js` antepone siempre el mismo encabezado explicativo del
    formato para que esa documentación no se pierda, aunque los comentarios
    puestos a mano dentro del cuerpo si se pierden. Por esta razón, la ruta
    del archivo es configurable en runtime (`_usarArchivoParaPruebas`, solo
    para tests): `test/semantica.test.js` la redirige a un archivo temporal
    antes de ejercitar `guardarConcepto`/`eliminarConcepto`, para que correr
    `npm test` nunca reescriba el `conceptos.yaml` real del repositorio.

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
- **`test/consultas-modulos.test.js`**: cada función de CRM/Financiero/
  Inventario/Producción — dominios correctos (p. ej. solo oportunidades
  abiertas, solo facturas de venta publicadas y no pagadas, `stock.quant`
  siempre restringido a ubicaciones internas, producción solo cuenta como
  "producido" lo que está en estado `done`) y el formato de lo que devuelven.
- **`test/semantica.test.js`**: que cada concepto tenga la forma correcta
  (medidas con `agregacion`), que `validarConceptos` detecte un campo que ya
  no existe en Odoo, que `construirDefinicionDesdeConceptos` rechace mezclar
  modelos/módulos o nombres inexistentes (y que, para un nombre mal escrito,
  `sugerirConceptoParecido` proponga el concepto real más cercano — "¿quisiste
  decir...?"), que la sugerencia por defecto de cada módulo produzca siempre
  una definición válida, y (contra un archivo temporal, nunca el real — ver
  punto 11 arriba) que `guardarConcepto` rechace forma inválida o campos que
  no existen en Odoo sin escribir nada, que el upsert funcione, que
  `eliminarConcepto` falle con un mensaje claro sobre un concepto inexistente,
  y que el encabezado explicativo sobreviva a un guardado.
- **`test/chat.test.js`**: `responderChat` — comandos de consulta de Ventas/
  Compras (incluida la regresión del bug de normalización que rompía
  `sale.order` → `saleorder`) y de CRM/Financiero/Inventario/Producción
  (que cada patrón de comando esté realmente conectado a su función, no solo
  que la función exista), el ciclo completo de edición: crear/agregar/quitar
  campo, la protección de los tableros "ventas" y "compras", y que
  `deshacerUltimoCambio` de verdad borre un tablero recién creado y restaure
  el YAML anterior en una edición, y los comandos de la capa semántica
  (`conceptos`, `sugerir tablero de <modulo>`, `crear tablero <id> de
  <modulo>[ con <conceptos>]`) — incluido que mezclar conceptos de cabecera
  y de línea se rechace antes de tocar Odoo, y que "ventas"/"compras" sigan
  protegidos aunque se use esta sintaxis nueva. Escribe archivos reales bajo
  `tableros/` con ids de prueba (`test_tmp_chat`, `test_tmp_semantica`) y los
  limpia siempre en un hook `after`.
- **`test/app.test.js`**: integración de rutas sobre `src/app.js` (la app de
  Express separada de `app.listen`, ver `src/index.js`) — sesión requerida en
  rutas protegidas, login inválido/válido, que `/tableros` muestre el hero
  "construir un tablero" con los chips de Ventas/Compras, que los tableros
  existentes (Ventas y Compras) se sigan viendo con datos reales por sus
  pestañas, y que `/semantica` respete el control de acceso: sin sesión
  redirige a `/login`, con sesión pero sin `base.group_system` responde
  `403`, y con perfil administrador lista los conceptos y muestra el link
  del topbar.

Variables de entorno usadas (`ambiente-pruebas.env`, no se sube al repo):
`ODOO_URL`, `ODOO_DB`, `ODOO_LOGIN`, `ODOO_API_KEY` (conexión de servicio a
la base de datos) y `SESSION_SECRET`. El login de cada persona en el
formulario web usa su propio usuario y contraseña de Odoo, no estas
variables.
