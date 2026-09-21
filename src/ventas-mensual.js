const odooClient = require('./odoo-client');
const { rangoPeriodo, agrupadoAEntradas } = require('./agregaciones');

function construirDominioOrdenes({ periodo, empresaId, vendedorId }) {
  const dominio = [];
  const rango = rangoPeriodo(periodo);
  if (rango) {
    dominio.push(['date_order', '>=', rango[0]]);
    dominio.push(['date_order', '<', rango[1]]);
  }
  if (empresaId) dominio.push(['company_id', '=', empresaId]);
  if (vendedorId) dominio.push(['user_id', '=', vendedorId]);
  return dominio;
}

/** Mismo filtro pero expresado sobre sale.order.line, vía order_id.<campo>. */
function construirDominioLineas({ periodo, empresaId, vendedorId }) {
  const dominio = [['product_id', '!=', false]];
  const rango = rangoPeriodo(periodo);
  if (rango) {
    dominio.push(['order_id.date_order', '>=', rango[0]]);
    dominio.push(['order_id.date_order', '<', rango[1]]);
  }
  if (empresaId) dominio.push(['order_id.company_id', '=', empresaId]);
  if (vendedorId) dominio.push(['order_id.user_id', '=', vendedorId]);
  return dominio;
}

async function obtenerDatosVentasMensuales({ periodo, empresaId, vendedorId }) {
  const dominioOrdenes = construirDominioOrdenes({ periodo, empresaId, vendedorId });
  const dominioLineas = construirDominioLineas({ periodo, empresaId, vendedorId });

  const [empresas, vendedoresDisponibles, filas, porCliente, porVendedor, porProducto] = await Promise.all([
    odooClient.executeKw('res.company', 'search_read', [[]], { fields: ['id', 'name'] }),
    // Lista de vendedores independiente del filtro actual, para que elegir
    // uno no haga desaparecer a los demás del selector.
    odooClient.executeKw('sale.order', 'read_group', [[], ['user_id'], ['user_id']], {}),
    odooClient.executeKw('sale.order', 'search_read', [dominioOrdenes], {
      fields: ['name', 'partner_id', 'user_id', 'date_order', 'amount_total', 'state'],
      order: 'date_order desc',
      limit: 200,
    }),
    odooClient.executeKw('sale.order', 'read_group', [dominioOrdenes, ['amount_total'], ['partner_id']], {
      orderby: 'amount_total desc',
      limit: 10,
    }),
    odooClient.executeKw('sale.order', 'read_group', [dominioOrdenes, ['amount_total'], ['user_id']], {
      orderby: 'amount_total desc',
    }),
    odooClient.executeKw('sale.order.line', 'read_group', [dominioLineas, ['price_subtotal'], ['product_id']], {
      orderby: 'price_subtotal desc',
      limit: 10,
    }),
  ]);

  const vendedores = vendedoresDisponibles
    .filter((v) => v.user_id)
    .map((v) => ({ id: v.user_id[0], nombre: v.user_id[1] }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return {
    empresas,
    vendedores,
    filas,
    graficoClientes: { titulo: 'Top clientes', ...agrupadoAEntradas(porCliente, 'partner_id', 'amount_total', 10) },
    graficoVendedores: {
      titulo: 'Ventas por vendedor',
      ...agrupadoAEntradas(porVendedor, 'user_id', 'amount_total', 20),
    },
    graficoProductos: {
      titulo: 'Top 10 productos',
      ...agrupadoAEntradas(porProducto, 'product_id', 'price_subtotal', 10),
    },
  };
}

module.exports = { obtenerDatosVentasMensuales };
