const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const odooClient = require('../src/odoo-client');
const { responderChat, obtenerUltimoCambio, deshacerUltimoCambio } = require('../src/chat');

const TABLEROS_DIR = path.join(__dirname, '..', 'tableros');
const ID_PRUEBA = 'test_tmp_chat';
const ARCHIVO_PRUEBA = path.join(TABLEROS_DIR, `${ID_PRUEBA}.yaml`);

// Los campos que realmente usan los tableros reales (ventas.yaml/compras.yaml),
// para que "listar tableros" pueda validarlos sin tocar Odoo de verdad.
const CAMPOS_REALES = {
  'sale.order': ['name', 'partner_id', 'user_id', 'company_id', 'date_order', 'amount_total', 'state'],
  'sale.order.line': ['order_id', 'product_id', 'price_subtotal'],
  'purchase.order': ['name', 'partner_id', 'company_id', 'date_order', 'amount_total', 'state'],
  'purchase.order.line': ['order_id', 'product_id', 'price_subtotal'],
};

function fieldsGetFalso(campos) {
  const resultado = {};
  for (const campo of campos) resultado[campo] = { string: campo, type: 'char' };
  return resultado;
}

async function mockFieldsGet(modelo, metodo) {
  assert.equal(metodo, 'fields_get');
  return fieldsGetFalso(CAMPOS_REALES[modelo] || []);
}

async function mockDatosVentas(modelo, metodo, args, kwargs) {
  if (modelo === 'res.company' && metodo === 'search_read') return [{ id: 1, name: 'Empresa Test' }];
  if (modelo === 'sale.order' && metodo === 'read_group') {
    const [, fields, groupby] = args;
    if (fields[0] === 'user_id') return [{ user_id: [5, 'Vendedor Test'] }];
    if (groupby[0] === 'partner_id') return [{ partner_id: [10, 'Cliente Test'], amount_total: 1000 }];
    if (groupby[0] === 'user_id') return [{ user_id: [5, 'Vendedor Test'], amount_total: 500 }];
  }
  if (modelo === 'sale.order' && metodo === 'search_read') {
    return [{
      name: 'S00001', partner_id: [10, 'Cliente Test'], user_id: [5, 'Vendedor Test'],
      date_order: '2026-01-01 00:00:00', amount_total: 500, state: 'sale',
    }];
  }
  if (modelo === 'sale.order.line' && metodo === 'read_group') {
    return [{ product_id: [1, 'Producto Test'], price_subtotal: 300 }];
  }
  throw new Error(`llamada no esperada en el mock: ${modelo}.${metodo}`);
}

function limpiarArchivoPrueba() {
  if (fs.existsSync(ARCHIVO_PRUEBA)) fs.unlinkSync(ARCHIVO_PRUEBA);
}

after(limpiarArchivoPrueba);

describe('responderChat — comandos de consulta', () => {
  test('"ayuda" (y variantes de mayúsculas/signos) responde con la lista de comandos', async () => {
    const r1 = await responderChat('ayuda');
    assert.match(r1.respuesta, /Comandos disponibles/);
    const r2 = await responderChat('¿AYUDA?');
    assert.match(r2.respuesta, /Comandos disponibles/);
  });

  test('comando no reconocido sugiere escribir "ayuda"', async () => {
    const r = await responderChat('esto no es un comando válido');
    assert.match(r.respuesta, /No reconozco ese comando/);
  });

  test('"listar tableros" valida y lista los tableros reales del repositorio', async (t) => {
    t.mock.method(odooClient, 'executeKw', mockFieldsGet);
    const r = await responderChat('listar tableros');
    assert.match(r.respuesta, /- ventas:/);
    assert.match(r.respuesta, /- compras:/);
    assert.doesNotMatch(r.respuesta, /INVALIDO/);
  });

  test('"campos de <modelo>" no distingue mayúsculas ni se confunde con los puntos del modelo', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo) => {
      assert.equal(modelo, 'sale.order'); // si "Sale.Order" llegara sin punto, esto fallaría
      return mockFieldsGet(modelo, metodo);
    });
    const r = await responderChat('Campos de Sale.Order');
    assert.match(r.respuesta, /Campos de sale\.order/);
    assert.match(r.respuesta, /- name \(char\)/);
  });

  test('"top clientes" agrega por cliente usando la conexión de servicio', async (t) => {
    t.mock.method(odooClient, 'executeKw', mockDatosVentas);
    const r = await responderChat('top clientes de todo');
    assert.match(r.respuesta, /Top clientes/);
    assert.match(r.respuesta, /Cliente Test/);
    assert.equal(r.tableroModificado, null);
  });

  test('"top productos" agrega por producto desde sale.order.line', async (t) => {
    t.mock.method(odooClient, 'executeKw', mockDatosVentas);
    const r = await responderChat('top productos de todo');
    assert.match(r.respuesta, /Top productos/);
    assert.match(r.respuesta, /Producto Test/);
  });

  test('"ventas por vendedor" agrega por vendedor', async (t) => {
    t.mock.method(odooClient, 'executeKw', mockDatosVentas);
    const r = await responderChat('ventas por vendedor de todo');
    assert.match(r.respuesta, /Ventas por vendedor/);
    assert.match(r.respuesta, /Vendedor Test/);
  });

  test('"ventas de <período>" resume cantidad de órdenes y total', async (t) => {
    t.mock.method(odooClient, 'executeKw', mockDatosVentas);
    const r = await responderChat('ventas de este mes');
    assert.match(r.respuesta, /1 órdenes, total 500/);
  });
});

describe('responderChat — edición de tableros (con evaluación semántica)', () => {
  test('"crear tablero" válido escribe el YAML y queda disponible para deshacer', async (t) => {
    limpiarArchivoPrueba();
    t.mock.method(odooClient, 'executeKw', async () => fieldsGetFalso(['name', 'email']));

    const r = await responderChat(`crear tablero ${ID_PRUEBA}: modelo res.partner, campos name,email, titulo Prueba`);
    assert.match(r.respuesta, /creado/);
    assert.equal(r.tableroModificado, ID_PRUEBA);
    assert.ok(fs.existsSync(ARCHIVO_PRUEBA), 'debería haber escrito el archivo YAML');

    const cambio = obtenerUltimoCambio();
    assert.ok(cambio, 'debería quedar un cambio pendiente de deshacer');
    assert.equal(cambio.id, ID_PRUEBA);
    assert.equal(cambio.contenidoAnterior, null, 'era un tablero nuevo, no existía antes');

    const deshecho = deshacerUltimoCambio();
    assert.equal(deshecho.ok, true);
    assert.equal(fs.existsSync(ARCHIVO_PRUEBA), false, 'deshacer una creación debe borrar el archivo');
    assert.equal(obtenerUltimoCambio(), null, 'no debe quedar cambio pendiente tras deshacer');
  });

  test('"crear tablero" con un campo inexistente no escribe nada (evaluación semántica)', async (t) => {
    limpiarArchivoPrueba();
    t.mock.method(odooClient, 'executeKw', async () => fieldsGetFalso(['name']));

    const r = await responderChat(`crear tablero ${ID_PRUEBA}: modelo res.partner, campos name,campo_falso`);
    assert.match(r.respuesta, /falló la evaluación semántica/);
    assert.match(r.respuesta, /"campo_falso" no existe/);
    assert.equal(r.tableroModificado, null);
    assert.equal(fs.existsSync(ARCHIVO_PRUEBA), false);
  });

  test('agregar y quitar un campo de un tablero existente', async (t) => {
    limpiarArchivoPrueba();
    t.mock.method(odooClient, 'executeKw', async () => fieldsGetFalso(['name', 'email', 'phone']));
    await responderChat(`crear tablero ${ID_PRUEBA}: modelo res.partner, campos name`);

    const agregado = await responderChat(`agregar campo phone a ${ID_PRUEBA}`);
    assert.match(agregado.respuesta, /agregado/);
    let contenido = fs.readFileSync(ARCHIVO_PRUEBA, 'utf8');
    assert.match(contenido, /phone/);

    const quitado = await responderChat(`quitar campo phone de ${ID_PRUEBA}`);
    assert.match(quitado.respuesta, /quitado/);
    contenido = fs.readFileSync(ARCHIVO_PRUEBA, 'utf8');
    assert.doesNotMatch(contenido, /phone/);

    deshacerUltimoCambio(); // deja el respaldo global limpio para otros tests
    limpiarArchivoPrueba();
  });

  test('los tableros especiales "ventas" y "compras" están protegidos de todos los comandos de edición', async () => {
    const comandos = [
      'agregar campo email a ventas',
      'quitar campo email de ventas',
      'agregar grafico a ventas: agrupar por partner_id midiendo amount_total',
      'eliminar tablero ventas',
      'crear tablero ventas: modelo sale.order, campos name',
      'agregar campo email a compras',
      'quitar campo email de compras',
      'agregar grafico a compras: agrupar por partner_id midiendo amount_total',
      'eliminar tablero compras',
      'crear tablero compras: modelo purchase.order, campos name',
    ];
    for (const comando of comandos) {
      const r = await responderChat(comando);
      assert.match(r.respuesta, /tipo especial/, `comando "${comando}" debería estar bloqueado`);
      assert.equal(r.tableroModificado, null);
    }
  });

  test('eliminar un tablero inexistente no rompe nada', async () => {
    const r = await responderChat('eliminar tablero no_existe_este_id');
    assert.match(r.respuesta, /No existe el tablero/);
  });
});

describe('responderChat — comandos de CRM, Financiero, Inventario y Producción', () => {
  test('CRM: pipeline, top oportunidades, por etapa y por vendedor', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo) => {
      assert.equal(modelo, 'crm.lead');
      if (metodo === 'search_count') return 17;
      if (metodo === 'search_read') {
        return [{ name: 'Oportunidad A', partner_id: [1, 'Cliente A'], stage_id: [2, 'Qualified'], expected_revenue: 5000 }];
      }
      return [{ expected_revenue: 320200, stage_id: [1, 'New'], user_id: [2, 'Vendedor'] }];
    });
    assert.match((await responderChat('pipeline crm')).respuesta, /17 oportunidades abiertas/);
    assert.match((await responderChat('resumen de crm')).respuesta, /oportunidades abiertas/);
    assert.match((await responderChat('top oportunidades')).respuesta, /Oportunidad A — Cliente A \(Qualified\)/);
    assert.match((await responderChat('oportunidades por etapa')).respuesta, /New: 320.200/);
    assert.match((await responderChat('oportunidades por vendedor')).respuesta, /Vendedor: 320.200/);
  });

  test('Financiero: facturas pendientes, top clientes y por estado', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      assert.equal(modelo, 'account.move');
      if (metodo === 'search_count') return 9;
      if (args[2] && args[2][0] === 'partner_id') return [{ partner_id: [1, 'Cliente A'], amount_total: 500 }];
      if (args[1][0] === 'amount_residual') return [{ amount_residual: 148999 }];
      return [{ state: 'posted', amount_total: 500 }];
    });
    assert.match((await responderChat('facturas pendientes')).respuesta, /9, monto adeudado total 148.999/);
    assert.match((await responderChat('top clientes facturacion')).respuesta, /Cliente A: 500/);
    assert.match((await responderChat('facturas por estado')).respuesta, /posted: 500/);
  });

  test('Inventario: top productos en stock, stock de un producto y productos sin stock', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      assert.equal(modelo, 'stock.quant');
      if (metodo === 'search_read') return [{ product_id: [2, 'Producto B'], quantity: 0 }];
      return [{ product_id: [1, 'Producto A'], quantity: 10 }];
    });
    assert.match((await responderChat('top productos en stock')).respuesta, /Producto A: 10/);
    assert.match((await responderChat('stock de producto a')).respuesta, /Producto A: 10 unidades/);
    assert.match((await responderChat('productos sin stock')).respuesta, /Producto B/);
  });

  test('stock de <producto> sin coincidencias responde con un mensaje claro, no una lista vacía', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => []);
    const r = await responderChat('stock de algo-que-no-existe');
    assert.match(r.respuesta, /No encontré productos que coincidan con "algo-que-no-existe"/);
  });

  test('Producción: resumen, por estado y top productos producidos', async (t) => {
    let llamadas = 0;
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      assert.equal(modelo, 'mrp.production');
      if (metodo === 'search_count') {
        llamadas += 1;
        return llamadas === 1 ? 8 : 4;
      }
      if (args[0].length && args[0][0][0] === 'state') return [{ product_id: [1, 'Producto A'], product_qty: 13 }];
      return [{ state: 'done', product_qty: 18 }];
    });
    assert.match((await responderChat('resumen produccion')).respuesta, /8 órdenes totales, 4 pendientes/);
    assert.match((await responderChat('produccion por estado')).respuesta, /done: 18/);
    assert.match((await responderChat('top productos producidos')).respuesta, /Producto A: 13/);
  });
});

describe('responderChat — capa semántica (leer, sugerir, crear)', () => {
  const ID_SEMANTICA = 'test_tmp_semantica';
  const ARCHIVO_SEMANTICA = path.join(TABLEROS_DIR, `${ID_SEMANTICA}.yaml`);
  after(() => { if (fs.existsSync(ARCHIVO_SEMANTICA)) fs.unlinkSync(ARCHIVO_SEMANTICA); });

  test('"conceptos" lista todos los módulos y "conceptos de <modulo>" filtra uno (no toca Odoo)', async () => {
    const todos = await responderChat('conceptos');
    assert.match(todos.respuesta, /CRM:/);
    assert.match(todos.respuesta, /Ventas:/);
    const soloVentas = await responderChat('conceptos de ventas');
    assert.match(soloVentas.respuesta, /ventas_totales/);
    assert.doesNotMatch(soloVentas.respuesta, /valor_esperado/);
  });

  test('"conceptos de <modulo>" con un módulo inexistente sugiere los módulos válidos', async () => {
    const r = await responderChat('conceptos de logistica');
    assert.match(r.respuesta, /No hay conceptos para el módulo "logistica"/);
    assert.match(r.respuesta, /ventas/);
  });

  test('"validar conceptos" reporta ok cuando fields_get confirma todos los campos', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => {
      const semantica = require('../src/semantica');
      const resultado = {};
      for (const c of semantica.cargarConceptos()) resultado[c.campo] = { string: c.campo, type: 'char' };
      return resultado;
    });
    const r = await responderChat('validar conceptos');
    assert.match(r.respuesta, /capa semántica es válida/);
  });

  test('"sugerir tablero de <modulo>" muestra una vista previa en YAML sin guardar nada', async () => {
    const r = await responderChat('sugerir tablero de crm');
    assert.match(r.respuesta, /Sugerencia para "crm"/);
    assert.match(r.respuesta, /modelo: crm.lead/);
    assert.match(r.respuesta, /Para crearlo: crear tablero <id> de crm/);
    assert.equal(r.tableroModificado, null);
    assert.equal(fs.existsSync(ARCHIVO_SEMANTICA), false);
  });

  test('"crear tablero <id> de <modulo> con <conceptos>" valida contra Odoo y guarda el YAML resultante', async (t) => {
    // valor_esperado trae su propio dominio (type/active); validateDefinition
    // también valida esos campos, no solo las columnas elegidas.
    t.mock.method(odooClient, 'executeKw', async () => ({
      partner_id: { string: 'Contact', type: 'many2one' },
      expected_revenue: { string: 'Expected Revenue', type: 'monetary' },
      type: { string: 'Type', type: 'selection' },
      active: { string: 'Active', type: 'boolean' },
    }));
    const r = await responderChat(`crear tablero ${ID_SEMANTICA} de crm con cliente_crm,valor_esperado`);
    assert.match(r.respuesta, /creado a partir de la capa semántica/);
    assert.equal(r.tableroModificado, ID_SEMANTICA);
    assert.ok(fs.existsSync(ARCHIVO_SEMANTICA));
    const contenido = fs.readFileSync(ARCHIVO_SEMANTICA, 'utf8');
    assert.match(contenido, /modelo: crm\.lead/);
    assert.match(contenido, /agrupar_por: partner_id/);
    deshacerUltimoCambio();
  });

  test('"crear tablero <id> de <modulo>" sin "con" usa la sugerencia por defecto', async (t) => {
    // cantidad_stock trae su propio dominio (location_id.usage='internal').
    t.mock.method(odooClient, 'executeKw', async () => ({
      product_id: { string: 'Product', type: 'many2one' },
      quantity: { string: 'Quantity', type: 'float' },
      location_id: { string: 'Location', type: 'many2one' },
    }));
    const r = await responderChat(`crear tablero ${ID_SEMANTICA} de inventario`);
    assert.match(r.respuesta, /producto_stock, cantidad_stock/);
    deshacerUltimoCambio();
  });

  test('mezclar conceptos de cabecera y línea (distintos modelos) se rechaza antes de tocar Odoo', async () => {
    const r = await responderChat('crear tablero x de ventas con cliente,producto_vendido,ventas_totales');
    assert.match(r.respuesta, /distintos modelos/);
    assert.equal(r.tableroModificado, null);
  });

  test('el tablero "ventas" sigue protegido aunque se use la sintaxis de capa semántica', async () => {
    const r = await responderChat('crear tablero ventas de ventas con cliente,ventas_totales');
    assert.match(r.respuesta, /tipo especial/);
  });
});
