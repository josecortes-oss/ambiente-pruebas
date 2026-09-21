const odooClient = require('./odoo-client');
const { rangoPeriodo, agrupadoAEntradas } = require('./agregaciones');

function construirDominioOrdenes({ periodo, empresaId, proveedorId }) {
  const dominio = [];
  const rango = rangoPeriodo(periodo);
  if (rango) {
    dominio.push(['date_order', '>=', rango[0]]);
    dominio.push(['date_order', '<', rango[1]]);
  }
  if (empresaId) dominio.push(['company_id', '=', empresaId]);
  if (proveedorId) dominio.push(['partner_id', '=', proveedorId]);
  return dominio;
}

/** Mismo filtro pero expresado sobre purchase.order.line, vía order_id.<campo>. */
function construirDominioLineas({ periodo, empresaId, proveedorId }) {
  const dominio = [['product_id', '!=', false]];
  const rango = rangoPeriodo(periodo);
  if (rango) {
    dominio.push(['order_id.date_order', '>=', rango[0]]);
    dominio.push(['order_id.date_order', '<', rango[1]]);
  }
  if (empresaId) dominio.push(['order_id.company_id', '=', empresaId]);
  if (proveedorId) dominio.push(['order_id.partner_id', '=', proveedorId]);
  return dominio;
}

async function obtenerDatosCompras({ periodo, empresaId, proveedorId }) {
  const dominioOrdenes = construirDominioOrdenes({ periodo, empresaId, proveedorId });
  const dominioLineas = construirDominioLineas({ periodo, empresaId, proveedorId });

  const [empresas, proveedoresDisponibles, filas, porProveedor, porProducto] = await Promise.all([
    odooClient.executeKw('res.company', 'search_read', [[]], { fields: ['id', 'name'] }),
    // Lista de proveedores independiente del filtro actual, para que elegir
    // uno no haga desaparecer a los demás del selector.
    odooClient.executeKw('purchase.order', 'read_group', [[], ['partner_id'], ['partner_id']], {}),
    odooClient.executeKw('purchase.order', 'search_read', [dominioOrdenes], {
      fields: ['name', 'partner_id', 'date_order', 'amount_total', 'state'],
      order: 'date_order desc',
      limit: 200,
    }),
    odooClient.executeKw('purchase.order', 'read_group', [dominioOrdenes, ['amount_total'], ['partner_id']], {
      orderby: 'amount_total desc',
      limit: 20,
    }),
    odooClient.executeKw('purchase.order.line', 'read_group', [dominioLineas, ['price_subtotal'], ['product_id']], {
      orderby: 'price_subtotal desc',
      limit: 10,
    }),
  ]);

  const proveedores = proveedoresDisponibles
    .filter((p) => p.partner_id)
    .map((p) => ({ id: p.partner_id[0], nombre: p.partner_id[1] }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return {
    empresas,
    proveedores,
    filas,
    graficoProveedores: {
      titulo: 'Total comprado por proveedor',
      ...agrupadoAEntradas(porProveedor, 'partner_id', 'amount_total', 20),
    },
    graficoProductos: {
      titulo: 'Top 10 productos comprados',
      ...agrupadoAEntradas(porProducto, 'product_id', 'price_subtotal', 10),
    },
  };
}

module.exports = { obtenerDatosCompras };
