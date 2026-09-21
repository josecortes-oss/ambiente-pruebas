const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const odooClient = require('../src/odoo-client');
const consultas = require('../src/consultas-modulos');

describe('consultas-modulos — CRM', () => {
  test('obtenerPipelineCRM filtra oportunidades abiertas y suma expected_revenue', async (t) => {
    const llamadas = [];
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      llamadas.push({ modelo, metodo, args });
      if (metodo === 'search_count') return 17;
      if (metodo === 'read_group') return [{ expected_revenue: 320200 }];
      throw new Error('llamada no esperada');
    });
    const { cantidad, total } = await consultas.obtenerPipelineCRM();
    assert.equal(cantidad, 17);
    assert.equal(total, 320200);
    for (const l of llamadas) {
      assert.deepEqual(l.args[0], [['type', '=', 'opportunity'], ['active', '=', true]]);
    }
  });

  test('obtenerTopOportunidades devuelve nombre/cliente/etapa/monto ordenados por Odoo', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => [
      { name: 'Oportunidad A', partner_id: [1, 'Cliente A'], stage_id: [2, 'Qualified'], expected_revenue: 5000 },
      { name: 'Oportunidad B', partner_id: false, stage_id: false, expected_revenue: 1000 },
    ]);
    const resultado = await consultas.obtenerTopOportunidades();
    assert.deepEqual(resultado[0], { nombre: 'Oportunidad A', cliente: 'Cliente A', etapa: 'Qualified', monto: 5000 });
    assert.deepEqual(resultado[1], { nombre: 'Oportunidad B', cliente: 'Sin contacto', etapa: 'Sin etapa', monto: 1000 });
  });

  test('obtenerOportunidadesPorEtapa/PorVendedor agregan con agrupadoAEntradas', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => [
      { stage_id: [1, 'New'], user_id: [2, 'Vendedor'], expected_revenue: 300 },
    ]);
    const porEtapa = await consultas.obtenerOportunidadesPorEtapa();
    assert.deepEqual(porEtapa.entradas, [['New', 300]]);
    const porVendedor = await consultas.obtenerOportunidadesPorVendedor();
    assert.deepEqual(porVendedor.entradas, [['Vendedor', 300]]);
  });
});

describe('consultas-modulos — Financiero', () => {
  test('obtenerFacturasPendientes solo cuenta facturas de venta publicadas y no pagadas', async (t) => {
    const llamadas = [];
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      llamadas.push(args[0]);
      if (metodo === 'search_count') return 9;
      return [{ amount_residual: 148999 }];
    });
    const { cantidad, total } = await consultas.obtenerFacturasPendientes();
    assert.equal(cantidad, 9);
    assert.equal(total, 148999);
    for (const dominio of llamadas) {
      assert.deepEqual(dominio, [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['payment_state', 'in', ['not_paid', 'partial']],
      ]);
    }
  });

  test('obtenerTopClientesFacturacion y obtenerFacturasPorEstado devuelven [etiqueta, valor] ordenados', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args, kwargs) => {
      if (kwargs.orderby === 'amount_total desc' && args[2][0] === 'partner_id') {
        return [{ partner_id: [1, 'Cliente A'], amount_total: 500 }];
      }
      return [{ state: 'posted', amount_total: 500 }];
    });
    const clientes = await consultas.obtenerTopClientesFacturacion();
    assert.deepEqual(clientes.entradas, [['Cliente A', 500]]);
    const estados = await consultas.obtenerFacturasPorEstado();
    assert.deepEqual(estados.entradas, [['posted', 500]]);
  });
});

describe('consultas-modulos — Inventario', () => {
  test('todas las consultas de stock se restringen a ubicaciones internas', async (t) => {
    const dominios = [];
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      dominios.push(args[0]);
      if (modelo !== 'stock.quant') throw new Error('modelo inesperado');
      if (metodo === 'read_group') return [{ product_id: [1, 'Producto A'], quantity: 10 }];
      return [{ product_id: [2, 'Producto B'], quantity: 0 }];
    });

    await consultas.obtenerTopProductosStock();
    await consultas.obtenerStockDeProducto('mesa');
    await consultas.obtenerProductosSinStock();

    for (const dominio of dominios) {
      assert.ok(
        dominio.some(([campo, op, valor]) => campo === 'location_id.usage' && op === '=' && valor === 'internal'),
        `el dominio ${JSON.stringify(dominio)} debería filtrar por ubicación interna`
      );
    }
  });

  test('obtenerStockDeProducto filtra por nombre con ilike', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      assert.ok(args[0].some(([campo, op, valor]) => campo === 'product_id.name' && op === 'ilike' && valor === 'mesa'));
      return [{ product_id: [1, 'Mesa Redonda'], quantity: 4 }];
    });
    const resultado = await consultas.obtenerStockDeProducto('mesa');
    assert.deepEqual(resultado, [{ producto: 'Mesa Redonda', cantidad: 4 }]);
  });

  test('obtenerProductosSinStock elimina duplicados por nombre de producto', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => [
      { product_id: [1, 'Producto A'], quantity: 0 },
      { product_id: [1, 'Producto A'], quantity: -2 },
      { product_id: [2, 'Producto B'], quantity: 0 },
    ]);
    const productos = await consultas.obtenerProductosSinStock();
    assert.deepEqual(productos, ['Producto A', 'Producto B']);
  });
});

describe('consultas-modulos — Producción', () => {
  test('obtenerResumenProduccion cuenta total y pendientes por separado', async (t) => {
    const dominios = [];
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      dominios.push(args[0]);
      return dominios.length === 1 ? 8 : 4;
    });
    const { cantidad, pendientes } = await consultas.obtenerResumenProduccion();
    assert.equal(cantidad, 8);
    assert.equal(pendientes, 4);
    assert.deepEqual(dominios[0], []);
    assert.deepEqual(dominios[1], [['state', 'in', ['draft', 'confirmed', 'progress', 'to_close']]]);
  });

  test('obtenerTopProductosProducidos solo cuenta órdenes terminadas (state = done)', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      assert.deepEqual(args[0], [['state', '=', 'done']]);
      return [{ product_id: [1, 'Producto A'], product_qty: 13 }];
    });
    const resultado = await consultas.obtenerTopProductosProducidos();
    assert.deepEqual(resultado.entradas, [['Producto A', 13]]);
  });
});
