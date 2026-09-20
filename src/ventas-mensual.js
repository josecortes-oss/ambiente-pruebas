const { executeKw } = require('./odoo-client');

const PERIODOS = [
  { clave: 'este_mes', etiqueta: 'Este mes' },
  { clave: 'mes_anterior', etiqueta: 'Mes anterior' },
  { clave: 'este_anio', etiqueta: 'Este año' },
  { clave: 'anio_anterior', etiqueta: 'Año anterior' },
  { clave: 'todos', etiqueta: 'Todo el histórico' },
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function fechaStr(anio, mesIndiceCero, dia) {
  return `${anio}-${pad(mesIndiceCero + 1)}-${pad(dia)} 00:00:00`;
}

/**
 * Devuelve [inicio, fin) del período pedido, como strings de fecha que Odoo
 * acepta directamente en un dominio sobre date_order. `null` = sin filtro.
 */
function rangoPeriodo(periodo) {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth();

  switch (periodo) {
    case 'este_mes':
      return [fechaStr(anio, mes, 1), fechaStr(mes === 11 ? anio + 1 : anio, mes === 11 ? 0 : mes + 1, 1)];
    case 'mes_anterior': {
      const mesAnt = mes === 0 ? 11 : mes - 1;
      const anioAnt = mes === 0 ? anio - 1 : anio;
      return [fechaStr(anioAnt, mesAnt, 1), fechaStr(anio, mes, 1)];
    }
    case 'este_anio':
      return [fechaStr(anio, 0, 1), fechaStr(anio + 1, 0, 1)];
    case 'anio_anterior':
      return [fechaStr(anio - 1, 0, 1), fechaStr(anio, 0, 1)];
    default:
      return null;
  }
}

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

function agrupadoAEntradas(grupos, campoGrupo, campoMedida, limite) {
  const entradas = grupos
    .map((g) => {
      const bruto = g[campoGrupo];
      const etiqueta = Array.isArray(bruto) ? bruto[1] : bruto === false ? 'Sin asignar' : String(bruto);
      return [etiqueta, Number(g[campoMedida]) || 0];
    })
    .filter(([, valor]) => valor !== 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite);
  const max = Math.max(...entradas.map(([, valor]) => valor), 1);
  return { entradas, max };
}

async function obtenerDatosVentasMensuales({ periodo, empresaId, vendedorId }) {
  const dominioOrdenes = construirDominioOrdenes({ periodo, empresaId, vendedorId });
  const dominioLineas = construirDominioLineas({ periodo, empresaId, vendedorId });

  const [empresas, vendedoresDisponibles, filas, porCliente, porVendedor, porProducto] = await Promise.all([
    executeKw('res.company', 'search_read', [[]], { fields: ['id', 'name'] }),
    // Lista de vendedores independiente del filtro actual, para que elegir
    // uno no haga desaparecer a los demás del selector.
    executeKw('sale.order', 'read_group', [[], ['user_id'], ['user_id']], {}),
    executeKw('sale.order', 'search_read', [dominioOrdenes], {
      fields: ['name', 'partner_id', 'user_id', 'date_order', 'amount_total', 'state'],
      order: 'date_order desc',
      limit: 200,
    }),
    executeKw('sale.order', 'read_group', [dominioOrdenes, ['amount_total'], ['partner_id']], {
      orderby: 'amount_total desc',
      limit: 10,
    }),
    executeKw('sale.order', 'read_group', [dominioOrdenes, ['amount_total'], ['user_id']], {
      orderby: 'amount_total desc',
    }),
    executeKw('sale.order.line', 'read_group', [dominioLineas, ['price_subtotal'], ['product_id']], {
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

module.exports = { PERIODOS, obtenerDatosVentasMensuales };
