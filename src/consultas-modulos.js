// Consultas de solo lectura para los módulos que no tienen tablero propio
// (CRM, Financiero/Facturación, Inventario, Producción). A diferencia de
// ventas_mensual/compras_mensual, no tienen filtros de período por
// querystring: son resúmenes directos que alimentan comandos del chat.
const odooClient = require('./odoo-client');
const { agrupadoAEntradas } = require('./agregaciones');

// ---- CRM (crm.lead) ----

async function obtenerPipelineCRM() {
  const dominio = [['type', '=', 'opportunity'], ['active', '=', true]];
  const [cantidad, grupos] = await Promise.all([
    odooClient.executeKw('crm.lead', 'search_count', [dominio]),
    odooClient.executeKw('crm.lead', 'read_group', [dominio, ['expected_revenue'], []], {}),
  ]);
  const total = grupos[0] ? grupos[0].expected_revenue || 0 : 0;
  return { cantidad, total };
}

async function obtenerTopOportunidades(limite = 10) {
  const dominio = [['type', '=', 'opportunity'], ['active', '=', true]];
  const filas = await odooClient.executeKw('crm.lead', 'search_read', [dominio], {
    fields: ['name', 'partner_id', 'stage_id', 'expected_revenue'],
    order: 'expected_revenue desc',
    limit: limite,
  });
  return filas.map((f) => ({
    nombre: f.name,
    cliente: f.partner_id ? f.partner_id[1] : 'Sin contacto',
    etapa: f.stage_id ? f.stage_id[1] : 'Sin etapa',
    monto: f.expected_revenue || 0,
  }));
}

async function obtenerOportunidadesPorEtapa() {
  const dominio = [['type', '=', 'opportunity'], ['active', '=', true]];
  const grupos = await odooClient.executeKw('crm.lead', 'read_group', [dominio, ['expected_revenue'], ['stage_id']], {
    orderby: 'expected_revenue desc',
  });
  return agrupadoAEntradas(grupos, 'stage_id', 'expected_revenue', 20);
}

async function obtenerOportunidadesPorVendedor() {
  const dominio = [['type', '=', 'opportunity'], ['active', '=', true]];
  const grupos = await odooClient.executeKw('crm.lead', 'read_group', [dominio, ['expected_revenue'], ['user_id']], {
    orderby: 'expected_revenue desc',
  });
  return agrupadoAEntradas(grupos, 'user_id', 'expected_revenue', 20);
}

// ---- Financiero / Facturación (account.move) ----

const ESTADOS_NO_PAGADOS = ['not_paid', 'partial'];

async function obtenerFacturasPendientes() {
  const dominio = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ESTADOS_NO_PAGADOS]];
  const [cantidad, grupos] = await Promise.all([
    odooClient.executeKw('account.move', 'search_count', [dominio]),
    odooClient.executeKw('account.move', 'read_group', [dominio, ['amount_residual'], []], {}),
  ]);
  const total = grupos[0] ? grupos[0].amount_residual || 0 : 0;
  return { cantidad, total };
}

async function obtenerTopClientesFacturacion() {
  const dominio = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
  const grupos = await odooClient.executeKw('account.move', 'read_group', [dominio, ['amount_total'], ['partner_id']], {
    orderby: 'amount_total desc',
    limit: 10,
  });
  return agrupadoAEntradas(grupos, 'partner_id', 'amount_total', 10);
}

async function obtenerFacturasPorEstado() {
  const dominio = [['move_type', '=', 'out_invoice']];
  const grupos = await odooClient.executeKw('account.move', 'read_group', [dominio, ['amount_total'], ['state']], {
    orderby: 'amount_total desc',
  });
  return agrupadoAEntradas(grupos, 'state', 'amount_total', 10);
}

// ---- Inventario (stock.quant) ----

const DOMINIO_UBICACION_INTERNA = [['location_id.usage', '=', 'internal']];

async function obtenerTopProductosStock() {
  const grupos = await odooClient.executeKw('stock.quant', 'read_group', [DOMINIO_UBICACION_INTERNA, ['quantity'], ['product_id']], {
    orderby: 'quantity desc',
    limit: 10,
  });
  return agrupadoAEntradas(grupos, 'product_id', 'quantity', 10);
}

async function obtenerStockDeProducto(nombreProducto) {
  const dominio = [...DOMINIO_UBICACION_INTERNA, ['product_id.name', 'ilike', nombreProducto]];
  const grupos = await odooClient.executeKw('stock.quant', 'read_group', [dominio, ['quantity'], ['product_id']], {
    orderby: 'quantity desc',
    limit: 20,
  });
  return grupos.map((g) => ({ producto: g.product_id[1], cantidad: g.quantity || 0 }));
}

async function obtenerProductosSinStock(limite = 15) {
  const dominio = [...DOMINIO_UBICACION_INTERNA, ['quantity', '<=', 0]];
  const filas = await odooClient.executeKw('stock.quant', 'search_read', [dominio], {
    fields: ['product_id', 'quantity'],
    limit: limite,
  });
  const vistos = new Set();
  const productos = [];
  for (const f of filas) {
    const nombre = f.product_id ? f.product_id[1] : 'Sin producto';
    if (!vistos.has(nombre)) {
      vistos.add(nombre);
      productos.push(nombre);
    }
  }
  return productos;
}

// ---- Producción (mrp.production) ----

const ESTADOS_PRODUCCION_ABIERTOS = ['draft', 'confirmed', 'progress', 'to_close'];

async function obtenerResumenProduccion() {
  const [cantidad, pendientes] = await Promise.all([
    odooClient.executeKw('mrp.production', 'search_count', [[]]),
    odooClient.executeKw('mrp.production', 'search_count', [[['state', 'in', ESTADOS_PRODUCCION_ABIERTOS]]]),
  ]);
  return { cantidad, pendientes };
}

async function obtenerProduccionPorEstado() {
  const grupos = await odooClient.executeKw('mrp.production', 'read_group', [[], ['product_qty'], ['state']], {
    orderby: 'product_qty desc',
  });
  return agrupadoAEntradas(grupos, 'state', 'product_qty', 10);
}

async function obtenerTopProductosProducidos() {
  const dominio = [['state', '=', 'done']];
  const grupos = await odooClient.executeKw('mrp.production', 'read_group', [dominio, ['product_qty'], ['product_id']], {
    orderby: 'product_qty desc',
    limit: 10,
  });
  return agrupadoAEntradas(grupos, 'product_id', 'product_qty', 10);
}

module.exports = {
  obtenerPipelineCRM,
  obtenerTopOportunidades,
  obtenerOportunidadesPorEtapa,
  obtenerOportunidadesPorVendedor,
  obtenerFacturasPendientes,
  obtenerTopClientesFacturacion,
  obtenerFacturasPorEstado,
  obtenerTopProductosStock,
  obtenerStockDeProducto,
  obtenerProductosSinStock,
  obtenerResumenProduccion,
  obtenerProduccionPorEstado,
  obtenerTopProductosProducidos,
};
