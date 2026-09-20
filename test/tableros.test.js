const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const odooClient = require('../src/odoo-client');
const { validateDefinition } = require('../src/tableros');

// fields_get de mentira: solo conoce los campos que le pasemos.
function fieldsGetFalso(camposConocidos) {
  const resultado = {};
  for (const campo of camposConocidos) resultado[campo] = { string: campo, type: 'char' };
  return resultado;
}

describe('validateDefinition (evaluación semántica)', () => {
  test('rechaza una definición sin "modelo"', async () => {
    const resultado = await validateDefinition({ campos: [{ campo: 'name' }] });
    assert.equal(resultado.valido, false);
    assert.match(resultado.errores.join('\n'), /Falta la clave "modelo"/);
  });

  test('rechaza una definición sin "campos"', async () => {
    const resultado = await validateDefinition({ modelo: 'sale.order' });
    assert.equal(resultado.valido, false);
    assert.match(resultado.errores.join('\n'), /Falta la clave "campos"/);
  });

  test('rechaza un modelo que Odoo no reconoce', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => {
      throw new Error('XML-RPC fault: Object no.existe doesn\'t exist');
    });
    const resultado = await validateDefinition({ modelo: 'no.existe', campos: [{ campo: 'name' }] });
    assert.equal(resultado.valido, false);
    assert.match(resultado.errores.join('\n'), /no existe o no es accesible/);
  });

  test('rechaza un campo que no existe en el modelo', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => fieldsGetFalso(['name', 'amount_total']));
    const resultado = await validateDefinition({
      modelo: 'sale.order',
      campos: [{ campo: 'name' }, { campo: 'campo_inventado' }],
    });
    assert.equal(resultado.valido, false);
    assert.match(resultado.errores.join('\n'), /"campo_inventado" no existe en el modelo "sale\.order"/);
  });

  test('acepta una definición cuando todos los campos existen', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => fieldsGetFalso(['name', 'amount_total', 'partner_id']));
    const resultado = await validateDefinition({
      modelo: 'sale.order',
      campos: [{ campo: 'name' }, { campo: 'amount_total' }],
      dominio: [['partner_id', '!=', false]],
    });
    assert.equal(resultado.valido, true);
    assert.deepEqual(resultado.errores, []);
  });

  test('valida también los campos usados en el dominio (filtros), no solo las columnas', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => fieldsGetFalso(['name']));
    const resultado = await validateDefinition({
      modelo: 'sale.order',
      campos: [{ campo: 'name' }],
      dominio: [['campo_filtro_falso', '=', 1]],
    });
    assert.equal(resultado.valido, false);
    assert.match(resultado.errores.join('\n'), /"campo_filtro_falso" no existe/);
  });

  test('rechaza un bloque "grafico" sin agrupar_por/medir', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => fieldsGetFalso(['name']));
    const resultado = await validateDefinition({
      modelo: 'sale.order',
      campos: [{ campo: 'name' }],
      grafico: {},
    });
    assert.equal(resultado.valido, false);
    assert.match(resultado.errores.join('\n'), /"grafico" necesita "agrupar_por"/);
    assert.match(resultado.errores.join('\n'), /"grafico" necesita "medir"/);
  });

  test('valida que agrupar_por y medir del gráfico existan en el modelo', async (t) => {
    t.mock.method(odooClient, 'executeKw', async () => fieldsGetFalso(['name', 'partner_id']));
    const resultado = await validateDefinition({
      modelo: 'sale.order',
      campos: [{ campo: 'name' }],
      grafico: { agrupar_por: 'partner_id', medir: 'campo_que_no_existe' },
    });
    assert.equal(resultado.valido, false);
    assert.match(resultado.errores.join('\n'), /"campo_que_no_existe" no existe/);
  });

  test('el tipo especial "ventas_mensual" se valida contra sale.order y sale.order.line, no requiere "campos"', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo) => {
      if (modelo === 'sale.order') {
        return fieldsGetFalso(['name', 'partner_id', 'user_id', 'company_id', 'date_order', 'amount_total', 'state']);
      }
      if (modelo === 'sale.order.line') {
        return fieldsGetFalso(['order_id', 'product_id', 'price_subtotal']);
      }
      throw new Error(`modelo inesperado: ${modelo}`);
    });
    const resultado = await validateDefinition({ tipo: 'ventas_mensual', titulo: 'Ventas' });
    assert.equal(resultado.valido, true);
  });

  test('el tipo "ventas_mensual" falla si a sale.order.line le falta un campo que el código usa', async (t) => {
    t.mock.method(odooClient, 'executeKw', async (modelo) => {
      if (modelo === 'sale.order') {
        return fieldsGetFalso(['name', 'partner_id', 'user_id', 'company_id', 'date_order', 'amount_total', 'state']);
      }
      return fieldsGetFalso(['order_id']); // falta product_id y price_subtotal
    });
    const resultado = await validateDefinition({ tipo: 'ventas_mensual' });
    assert.equal(resultado.valido, false);
    assert.match(resultado.errores.join('\n'), /"product_id" no existe en el modelo "sale\.order\.line"/);
  });
});
