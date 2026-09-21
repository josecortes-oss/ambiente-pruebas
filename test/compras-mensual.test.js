const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const odooClient = require('../src/odoo-client');
const { obtenerDatosCompras } = require('../src/compras-mensual');

describe('obtenerDatosCompras', () => {
  test('arma el dominio de purchase.order con el proveedor filtrado y agrega por proveedor/producto', async (t) => {
    const llamadas = [];
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args, kwargs) => {
      llamadas.push({ modelo, metodo, args, kwargs });
      if (modelo === 'res.company') return [{ id: 1, name: 'Empresa Test' }];
      if (modelo === 'purchase.order' && metodo === 'read_group' && args[1][0] === 'partner_id' && !args[0].length) {
        return [{ partner_id: [20, 'Proveedor Test'] }]; // listado de proveedores disponibles
      }
      if (modelo === 'purchase.order' && metodo === 'search_read') {
        return [{ name: 'P00001', partner_id: [20, 'Proveedor Test'], date_order: '2026-01-01 00:00:00', amount_total: 700, state: 'purchase' }];
      }
      if (modelo === 'purchase.order' && metodo === 'read_group') {
        return [{ partner_id: [20, 'Proveedor Test'], amount_total: 700 }];
      }
      if (modelo === 'purchase.order.line' && metodo === 'read_group') {
        return [{ product_id: [2, 'Insumo Test'], price_subtotal: 400 }];
      }
      throw new Error(`llamada no esperada: ${modelo}.${metodo}`);
    });

    const datos = await obtenerDatosCompras({ periodo: 'todos', empresaId: null, proveedorId: 20 });

    assert.deepEqual(datos.empresas, [{ id: 1, name: 'Empresa Test' }]);
    assert.deepEqual(datos.proveedores, [{ id: 20, nombre: 'Proveedor Test' }]);
    assert.equal(datos.filas.length, 1);
    assert.equal(datos.graficoProveedores.titulo, 'Total comprado por proveedor');
    assert.deepEqual(datos.graficoProveedores.entradas, [['Proveedor Test', 700]]);
    assert.equal(datos.graficoProductos.titulo, 'Top 10 productos comprados');
    assert.deepEqual(datos.graficoProductos.entradas, [['Insumo Test', 400]]);

    // El filtro de proveedor debe aplicarse tanto a purchase.order como,
    // vía order_id.partner_id, a purchase.order.line.
    const llamadaOrdenes = llamadas.find((l) => l.modelo === 'purchase.order' && l.metodo === 'search_read');
    assert.deepEqual(llamadaOrdenes.args[0], [['partner_id', '=', 20]]);

    const llamadaLineas = llamadas.find((l) => l.modelo === 'purchase.order.line');
    assert.deepEqual(llamadaLineas.args[0], [['product_id', '!=', false], ['order_id.partner_id', '=', 20]]);
  });
});
