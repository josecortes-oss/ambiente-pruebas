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
   sistema sin tocar código. Ejemplo (`tableros/ventas.yaml`):

   ```yaml
   titulo: "Órdenes de Venta"
   modulo: ventas
   modelo: sale.order
   campos:
     - campo: name
       etiqueta: "Orden"
     - campo: amount_total
       etiqueta: "Total"
   dominio: []
   orden: "date_order desc"
   limite: 80
   grafico:
     titulo: "Total vendido por cliente"
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

### Agregar un nuevo tablero

Basta con crear un archivo `.yaml` en `tableros/` con `modelo`, `campos` y,
opcionalmente, `titulo`, `modulo`, `dominio`, `orden` y `limite`. No requiere
reiniciar código de negocio: se valida y se lista automáticamente.

### Ejecutar

```bash
npm install
npm start   # http://localhost:3000
```

Variables de entorno usadas (`ambiente-pruebas.env`, no se sube al repo):
`ODOO_URL`, `ODOO_DB`, `ODOO_LOGIN`, `ODOO_API_KEY` (conexión de servicio a
la base de datos) y `SESSION_SECRET`. El login de cada persona en el
formulario web usa su propio usuario y contraseña de Odoo, no estas
variables.
