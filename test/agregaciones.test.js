const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { rangoPeriodo, PERIODOS } = require('../src/agregaciones');

function aFecha(str) {
  // "YYYY-MM-DD HH:mm:ss" -> Date, para comparar límites de rango.
  return new Date(str.replace(' ', 'T'));
}

describe('rangoPeriodo', () => {
  test('"este_mes" devuelve un rango de exactamente un mes calendario, incluyendo hoy', () => {
    const [inicio, fin] = rangoPeriodo('este_mes');
    const ahora = new Date();
    assert.ok(aFecha(inicio) <= ahora, 'el inicio del mes debe ser <= ahora');
    assert.ok(ahora < aFecha(fin), 'ahora debe caer antes del fin del rango');
    assert.equal(aFecha(inicio).getDate(), 1, 'el rango de un mes empieza el día 1');
  });

  test('"mes_anterior" termina justo donde empieza "este_mes"', () => {
    const [, finMesAnterior] = rangoPeriodo('mes_anterior');
    const [inicioEsteMes] = rangoPeriodo('este_mes');
    assert.equal(finMesAnterior, inicioEsteMes);
  });

  test('"anio_anterior" termina justo donde empieza "este_anio"', () => {
    const [, finAnioAnterior] = rangoPeriodo('anio_anterior');
    const [inicioEsteAnio] = rangoPeriodo('este_anio');
    assert.equal(finAnioAnterior, inicioEsteAnio);
  });

  test('"este_anio" cubre desde el 1 de enero hasta el 1 de enero siguiente', () => {
    const [inicio, fin] = rangoPeriodo('este_anio');
    assert.match(inicio, /^\d{4}-01-01 00:00:00$/);
    assert.match(fin, /^\d{4}-01-01 00:00:00$/);
    const anioInicio = Number(inicio.slice(0, 4));
    const anioFin = Number(fin.slice(0, 4));
    assert.equal(anioFin, anioInicio + 1);
  });

  test('un período no reconocido (incluido "todos") no filtra por fecha', () => {
    assert.equal(rangoPeriodo('todos'), null);
    assert.equal(rangoPeriodo('lo-que-sea'), null);
    assert.equal(rangoPeriodo(undefined), null);
  });

  test('todas las claves de PERIODOS excepto "todos" producen un rango válido [inicio, fin)', () => {
    for (const { clave } of PERIODOS) {
      if (clave === 'todos') continue;
      const rango = rangoPeriodo(clave);
      assert.ok(Array.isArray(rango) && rango.length === 2, `"${clave}" debería devolver [inicio, fin]`);
      assert.ok(aFecha(rango[0]) < aFecha(rango[1]), `"${clave}": inicio debe ser anterior a fin`);
    }
  });
});

describe('agrupadoAEntradas', () => {
  const { agrupadoAEntradas } = require('../src/agregaciones');

  test('convierte grupos de Odoo (many2one [id, nombre]) en pares [etiqueta, valor], ordenados de mayor a menor', () => {
    const grupos = [
      { partner_id: [1, 'Cliente A'], amount_total: 100 },
      { partner_id: [2, 'Cliente B'], amount_total: 500 },
    ];
    const { entradas, max } = agrupadoAEntradas(grupos, 'partner_id', 'amount_total', 10);
    assert.deepEqual(entradas, [['Cliente B', 500], ['Cliente A', 100]]);
    assert.equal(max, 500);
  });

  test('descarta grupos sin dimensión asignada (false) bajo la etiqueta "Sin asignar" y filtra valores en cero', () => {
    const grupos = [
      { partner_id: false, amount_total: 50 },
      { partner_id: [3, 'Cliente C'], amount_total: 0 },
    ];
    const { entradas } = agrupadoAEntradas(grupos, 'partner_id', 'amount_total', 10);
    assert.deepEqual(entradas, [['Sin asignar', 50]]);
  });

  test('respeta el límite de entradas devueltas', () => {
    const grupos = Array.from({ length: 5 }, (_, i) => ({ partner_id: [i, `Cliente ${i}`], amount_total: i + 1 }));
    const { entradas } = agrupadoAEntradas(grupos, 'partner_id', 'amount_total', 2);
    assert.equal(entradas.length, 2);
  });
});
