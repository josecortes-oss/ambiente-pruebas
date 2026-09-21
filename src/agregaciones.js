// Utilidades de fecha/agregación compartidas entre los tableros de tipo
// especial (ventas_mensual, compras_mensual): no son específicas de ventas
// ni de compras, por eso viven en un módulo aparte.

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

module.exports = { PERIODOS, rangoPeriodo, agrupadoAEntradas };
