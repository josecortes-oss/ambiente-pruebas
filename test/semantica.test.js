const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const odooClient = require('../src/odoo-client');
const semantica = require('../src/semantica');

describe('semantica — el diccionario en sí', () => {
  test('cada concepto tiene modulo/modelo/campo/tipo/etiqueta, y las medidas declaran agregacion', () => {
    const conceptos = semantica.cargarConceptos();
    assert.ok(conceptos.length > 0);
    for (const c of conceptos) {
      assert.equal(typeof c.nombre, 'string');
      assert.equal(typeof c.modulo, 'string');
      assert.equal(typeof c.modelo, 'string');
      assert.equal(typeof c.campo, 'string');
      assert.ok(c.tipo === 'dimension' || c.tipo === 'medida', `${c.nombre}: tipo inválido "${c.tipo}"`);
      assert.equal(typeof c.etiqueta, 'string');
      if (c.tipo === 'medida') assert.ok(c.agregacion, `${c.nombre}: falta "agregacion"`);
    }
  });

  test('listarModulos/conceptosDeModulo/resolverConcepto son consistentes entre sí', () => {
    const modulos = semantica.listarModulos();
    assert.ok(modulos.includes('ventas'));
    assert.ok(modulos.includes('crm'));
    for (const m of modulos) {
      const items = semantica.conceptosDeModulo(m);
      assert.ok(items.length > 0, `módulo "${m}" no debería estar vacío`);
      for (const c of items) assert.equal(semantica.resolverConcepto(c.nombre).modulo, m);
    }
    assert.equal(semantica.resolverConcepto('no-existe-este-concepto'), null);
  });

  test('cada módulo tiene al menos una dimensión y una medida (para poder sugerir un tablero)', () => {
    for (const m of semantica.listarModulos()) {
      const items = semantica.conceptosDeModulo(m);
      assert.ok(items.some((c) => c.tipo === 'dimension'), `"${m}" sin dimensiones`);
      assert.ok(items.some((c) => c.tipo === 'medida'), `"${m}" sin medidas`);
    }
  });
});

describe('semantica — validarConceptos', () => {
  test('reporta error cuando un concepto referencia un campo que ya no existe en Odoo', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo) => {
      // Simula que el modelo existe pero le falta "partner_id" (usado por varios conceptos).
      return { name: { string: 'Name', type: 'char' } };
    });
    const { valido, errores } = await semantica.validarConceptos();
    assert.equal(valido, false);
    assert.ok(errores.some((e) => e.includes('partner_id')));
  });

  test('cuando todos los campos existen, la capa semántica es válida', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => {
      const todosLosCampos = semantica.cargarConceptos().map((c) => c.campo);
      const resultado = {};
      for (const campo of todosLosCampos) resultado[campo] = { string: campo, type: 'char' };
      return resultado;
    });
    const { valido, errores } = await semantica.validarConceptos();
    assert.equal(valido, true);
    assert.deepEqual(errores, []);
  });
});

describe('semantica — construirDefinicionDesdeConceptos', () => {
  test('arma un tablero genérico válido a partir de conceptos del mismo modelo', () => {
    const { def, error } = semantica.construirDefinicionDesdeConceptos('mi_id', 'crm', [
      'cliente_crm',
      'vendedor_crm',
      'valor_esperado',
    ]);
    assert.equal(error, undefined);
    assert.equal(def.modulo, 'crm');
    assert.equal(def.modelo, 'crm.lead');
    assert.deepEqual(def.campos, [
      { campo: 'partner_id', etiqueta: 'Contacto' },
      { campo: 'user_id', etiqueta: 'Vendedor' },
      { campo: 'expected_revenue', etiqueta: 'Valor esperado' },
    ]);
    assert.equal(def.grafico.agrupar_por, 'partner_id');
    assert.equal(def.grafico.medir, 'expected_revenue');
    assert.deepEqual(def.dominio, [['type', '=', 'opportunity'], ['active', '=', true]]);
  });

  test('rechaza mezclar conceptos de distintos modelos (cabecera + línea)', () => {
    const { error } = semantica.construirDefinicionDesdeConceptos('id', 'ventas', [
      'cliente',
      'producto_vendido',
      'ventas_totales',
    ]);
    assert.match(error, /distintos modelos/);
  });

  test('rechaza conceptos de otro módulo', () => {
    const { error } = semantica.construirDefinicionDesdeConceptos('id', 'ventas', ['proveedor', 'compras_totales']);
    assert.match(error, /no son del módulo "ventas"/);
  });

  test('rechaza nombres de concepto inexistentes', () => {
    const { error } = semantica.construirDefinicionDesdeConceptos('id', 'ventas', ['no_existe']);
    assert.match(error, /No existen los conceptos: no_existe/);
  });

  test('exige al menos una dimensión y una medida', () => {
    const { error } = semantica.construirDefinicionDesdeConceptos('id', 'ventas', ['cliente', 'vendedor']);
    assert.match(error, /al menos un concepto de dimensión y uno de medida/);
  });
});

describe('semantica — sugerirConceptosPorDefecto', () => {
  test('prioriza el modelo con más conceptos en el módulo (cabecera de ventas, no la línea)', () => {
    const sugeridos = semantica.sugerirConceptosPorDefecto('ventas');
    for (const nombre of sugeridos) {
      assert.equal(semantica.resolverConcepto(nombre).modelo, 'sale.order');
    }
  });

  test('la sugerencia por defecto siempre produce una definición válida', () => {
    for (const modulo of semantica.listarModulos()) {
      const sugeridos = semantica.sugerirConceptosPorDefecto(modulo);
      assert.ok(sugeridos, `"${modulo}" debería tener sugerencia por defecto`);
      const { error } = semantica.construirDefinicionDesdeConceptos('id', modulo, sugeridos);
      assert.equal(error, undefined, `sugerencia de "${modulo}" no es una definición válida: ${error}`);
    }
  });
});
