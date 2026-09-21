const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const versiones = require('../src/versiones');

const ID = 'test_tmp_versiones_unit';

function limpiar() {
  versiones.eliminarVersiones(ID);
}

after(limpiar);

describe('versiones — módulo de bajo nivel', () => {
  test('un tablero sin historial no tiene versiones', () => {
    limpiar();
    assert.deepEqual(versiones.listarVersiones(ID), []);
    assert.equal(versiones.obtenerVersion(ID, 1), null);
  });

  test('guardarVersion agrega al final y devuelve el número 1-based', () => {
    limpiar();
    const n1 = versiones.guardarVersion(ID, { modelo: 'res.partner', campos: ['name'] }, 'v1');
    const n2 = versiones.guardarVersion(ID, { modelo: 'res.partner', campos: ['name', 'email'] }, 'v2');
    assert.equal(n1, 1);
    assert.equal(n2, 2);

    const lista = versiones.listarVersiones(ID);
    assert.equal(lista.length, 2);
    assert.equal(lista[0].descripcion, 'v1');
    assert.equal(lista[1].descripcion, 'v2');
    assert.deepEqual(lista[0].definicion.campos, ['name']);
    assert.deepEqual(lista[1].definicion.campos, ['name', 'email']);
    assert.equal(typeof lista[0].fecha, 'string');
  });

  test('obtenerVersion devuelve la versión correcta por número, o null si no existe', () => {
    limpiar();
    versiones.guardarVersion(ID, { campos: ['a'] }, 'v1');
    versiones.guardarVersion(ID, { campos: ['b'] }, 'v2');

    assert.deepEqual(versiones.obtenerVersion(ID, 1).definicion.campos, ['a']);
    assert.deepEqual(versiones.obtenerVersion(ID, 2).definicion.campos, ['b']);
    assert.equal(versiones.obtenerVersion(ID, 3), null);
    assert.equal(versiones.obtenerVersion(ID, 0), null);
  });

  test('eliminarVersiones borra todo el historial y la siguiente versión vuelve a ser la 1', () => {
    limpiar();
    versiones.guardarVersion(ID, { campos: ['a'] }, 'v1');
    versiones.guardarVersion(ID, { campos: ['b'] }, 'v2');
    assert.equal(versiones.listarVersiones(ID).length, 2);

    versiones.eliminarVersiones(ID);
    assert.deepEqual(versiones.listarVersiones(ID), []);

    const n = versiones.guardarVersion(ID, { campos: ['c'] }, 'v1-de-nuevo');
    assert.equal(n, 1);
  });

  test('eliminarVersiones en un tablero sin historial no falla', () => {
    limpiar();
    assert.doesNotThrow(() => versiones.eliminarVersiones('tablero_que_nunca_tuvo_versiones'));
  });
});
