const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { rangoPeriodo, PERIODOS } = require('../src/ventas-mensual');

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
