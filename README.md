# ambiente-pruebas

Repositorio de ambiente de pruebas para desarrollo.

## Tableros de consulta Odoo

Herramienta web (Express) que permite a los usuarios de Odoo consultar tableros
predefinidos sobre distintos módulos (ventas, compras, etc.) sin acceso directo
a la base de datos.

### Cómo funciona

1. **Conexión**: se realiza vía XML-RPC de Odoo (`/xmlrpc/2/common` y
   `/xmlrpc/2/object`), nunca por SQL directo. El host y la base de datos
   (`ODOO_URL`, `ODOO_DB`) se configuran una sola vez en `ambiente-pruebas.env`.
2. **Usuarios**: son los definidos en Odoo. Cada usuario inicia sesión con su
   propio login y **API key personal** de Odoo (Ajustes → Cuentas de
   desarrollador → Claves API). La app nunca usa una API key fija de servicio
   para consultar datos: cada consulta se ejecuta con las credenciales del
   usuario logueado, por lo que respeta los permisos y restricciones de
   registro que ese usuario ya tiene en Odoo.
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
   ```

4. **Evaluación semántica**: antes de mostrar cualquier tablero, la app llama
   a `fields_get` sobre el `modelo` indicado (con las credenciales del
   usuario) y verifica que:
   - el modelo exista y sea accesible para ese usuario,
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
`ODOO_URL`, `ODOO_DB`, `SESSION_SECRET`. (`ODOO_LOGIN`/`ODOO_API_KEY` quedan
como referencia de un usuario de prueba; el login real de cada persona se
hace desde el formulario web.)
