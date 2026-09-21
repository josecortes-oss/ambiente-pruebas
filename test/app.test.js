const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const odooClient = require('../src/odoo-client');
const { crearApp } = require('../src/app');
const versiones = require('../src/versiones');

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

async function mockExecuteKw(modelo, metodo, args) {
  if (metodo === 'fields_get') return fieldsGetFalso(CAMPOS_REALES[modelo] || []);
  if (metodo === 'has_group') return false;
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
  if (modelo === 'purchase.order' && metodo === 'read_group') {
    return [{ partner_id: [20, 'Proveedor Test'], amount_total: 700 }];
  }
  if (modelo === 'purchase.order' && metodo === 'search_read') {
    return [{
      name: 'P00001', partner_id: [20, 'Proveedor Test'],
      date_order: '2026-01-01 00:00:00', amount_total: 700, state: 'purchase',
    }];
  }
  if (modelo === 'purchase.order.line' && metodo === 'read_group') {
    return [{ product_id: [2, 'Insumo Test'], price_subtotal: 400 }];
  }
  throw new Error(`llamada no esperada en el mock: ${modelo}.${metodo}`);
}

function cookieDe(response) {
  const crudo = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()[0]
    : response.headers.get('set-cookie');
  return crudo ? crudo.split(';')[0] : null;
}

describe('app (integración de rutas)', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = crearApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  test('una ruta protegida sin sesión redirige a /login', async () => {
    const r = await fetch(`${baseUrl}/tableros`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
  });

  test('login con credenciales inválidas no crea sesión', async (t) => {
    t.mock.method(odooClient, 'authenticate', async () => false);
    const r = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'login=admin&password=incorrecta',
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Usuario o contraseña inválidos/);
  });

  test('login con credenciales válidas crea sesión y redirige a /tableros', async (t) => {
    t.mock.method(odooClient, 'authenticate', async () => 2);
    const r = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'login=admin&password=lo-que-sea',
    });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/tableros');
    assert.ok(cookieDe(r), 'debería fijar una cookie de sesión');
  });

  test('con sesión, /tableros muestra el hero "construir un tablero" con chips de Ventas/Compras', async (t) => {
    t.mock.method(odooClient, 'authenticate', async () => 2);
    t.mock.method(odooClient, 'executeKw', mockExecuteKw);

    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'login=admin&password=lo-que-sea',
    });
    const cookie = cookieDe(login);

    const r = await fetch(`${baseUrl}/tableros`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Espacio Listo/);
    assert.match(html, /Escribe en el Chat lo que necesitas para construir los Tableros/);
    assert.match(html, /Ventas por cliente/);
    assert.match(html, /Compras por proveedor/);
    assert.match(html, /Armar Tablero General de Ventas/);
    assert.match(html, /Armar Tablero General de Compras/);
    assert.match(html, /<a class="chip" href="\/tableros\/ventas">/);
    assert.match(html, /<a class="chip" href="\/tableros\/compras">/);

    const workspace = await fetch(`${baseUrl}/tableros/ventas`, { headers: { Cookie: cookie } });
    assert.equal(workspace.status, 200);
    const workspaceHtml = await workspace.text();
    assert.match(workspaceHtml, /Tablero: Ventas/);
    assert.match(workspaceHtml, /Vendedor Test/);
    // el panel de historial (inspector) sabe qué tablero está activo para poder pedir sus versiones
    assert.match(workspaceHtml, /data-activo-id="ventas"/);
    assert.match(workspaceHtml, /Versiones guardadas/);
  });

  test('el workspace de Compras muestra filtros, KPIs y el gráfico por proveedor', async (t) => {
    t.mock.method(odooClient, 'authenticate', async () => 2);
    t.mock.method(odooClient, 'executeKw', mockExecuteKw);

    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'login=admin&password=lo-que-sea',
    });
    const cookie = cookieDe(login);

    const r = await fetch(`${baseUrl}/tableros/compras`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Tablero: Compras/);
    assert.match(html, /name="proveedor"/);
    assert.match(html, /Proveedor Test/);
    assert.match(html, /Insumo Test/);
  });

  test('POST /chat/deshacer sin sesión también redirige a /login (no expone el endpoint)', async () => {
    const r = await fetch(`${baseUrl}/chat/deshacer`, { method: 'POST', redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
  });

  test('GET /semantica sin sesión redirige a /login', async () => {
    const r = await fetch(`${baseUrl}/semantica`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
  });

  test('GET /semantica con sesión pero sin el grupo de administrador responde 403', async (t) => {
    t.mock.method(odooClient, 'authenticate', async () => 5); // usuario no admin
    t.mock.method(odooClient, 'executeKw', mockExecuteKw); // has_group -> false por defecto

    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'login=marc&password=lo-que-sea',
    });
    const cookie = cookieDe(login);

    const r = await fetch(`${baseUrl}/semantica`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 403);
    const html = await r.text();
    assert.match(html, /solo para administradores/);
  });

  test('GET /semantica con perfil administrador lista los conceptos agrupados por módulo', async (t) => {
    t.mock.method(odooClient, 'authenticate', async () => 2);
    t.mock.method(odooClient, 'executeKw', async (modelo, metodo, args) => {
      if (metodo === 'has_group') return true;
      return mockExecuteKw(modelo, metodo, args);
    });

    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'login=admin&password=lo-que-sea',
    });
    const cookie = cookieDe(login);

    const r = await fetch(`${baseUrl}/semantica`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Capa semántica/);
    assert.match(html, /ventas_totales/);
    assert.match(html, /🧩 Conceptos/); // el link del topbar también debe verse para un admin
  });

  describe('versionador (rutas JSON del panel Historial)', () => {
    const ID_V = 'test_tmp_app_versiones';
    const ARCHIVO_V = path.join(__dirname, '..', 'tableros', `${ID_V}.yaml`);
    function limpiarV() {
      if (fs.existsSync(ARCHIVO_V)) fs.unlinkSync(ARCHIVO_V);
      versiones.eliminarVersiones(ID_V);
    }
    after(limpiarV);

    test('GET /tableros/:id/versiones sin sesión redirige a /login', async () => {
      const r = await fetch(`${baseUrl}/tableros/${ID_V}/versiones`, { redirect: 'manual' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), '/login');
    });

    test('lista versiones creadas por chat, y "eliminar" borra el historial sin tocar el tablero', async (t) => {
      limpiarV();
      t.mock.method(odooClient, 'authenticate', async () => 2);
      t.mock.method(odooClient, 'executeKw', async () => fieldsGetFalso(['name', 'email']));

      const login = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'login=admin&password=lo-que-sea',
      });
      const cookie = cookieDe(login);

      const vacio = await fetch(`${baseUrl}/tableros/${ID_V}/versiones`, { headers: { Cookie: cookie } });
      assert.deepEqual((await vacio.json()).versiones, []);

      await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: `crear tablero ${ID_V}: modelo res.partner, campos name` }),
      });

      const conUna = await fetch(`${baseUrl}/tableros/${ID_V}/versiones`, { headers: { Cookie: cookie } });
      const dataUna = await conUna.json();
      assert.equal(dataUna.versiones.length, 1);
      assert.equal(dataUna.versiones[0].numero, 1);
      assert.match(dataUna.versiones[0].descripcion, /Editado por chat/);

      const eliminado = await fetch(`${baseUrl}/tableros/${ID_V}/versiones/eliminar`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      assert.equal((await eliminado.json()).ok, true);
      assert.ok(fs.existsSync(ARCHIVO_V), 'el tablero actual no debería borrarse al eliminar el historial');

      const despues = await fetch(`${baseUrl}/tableros/${ID_V}/versiones`, { headers: { Cookie: cookie } });
      assert.deepEqual((await despues.json()).versiones, []);
    });
  });

  describe('cambiar tipo de gráfico (barra/línea/torta)', () => {
    const ID_G = 'test_tmp_app_grafico';
    const ARCHIVO_G = path.join(__dirname, '..', 'tableros', `${ID_G}.yaml`);
    function limpiarG() {
      if (fs.existsSync(ARCHIVO_G)) fs.unlinkSync(ARCHIVO_G);
      versiones.eliminarVersiones(ID_G);
    }
    after(limpiarG);

    test('renderiza barra (por defecto), y línea/torta tras "cambiar tipo de grafico"', async (t) => {
      limpiarG();
      t.mock.method(odooClient, 'authenticate', async () => 2);
      t.mock.method(odooClient, 'executeKw', async (modelo, metodo) => {
        if (metodo === 'fields_get') return fieldsGetFalso(['name', 'partner_id', 'amount_total']);
        if (metodo === 'search_read') {
          return [{ name: 'X1', partner_id: [10, 'Cliente Test'], amount_total: 500 }];
        }
        throw new Error(`llamada no esperada: ${modelo}.${metodo}`);
      });

      const login = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'login=admin&password=lo-que-sea',
      });
      const cookie = cookieDe(login);

      await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: `crear tablero ${ID_G}: modelo res.partner, campos name` }),
      });
      await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: `agregar grafico a ${ID_G}: agrupar por partner_id midiendo amount_total` }),
      });

      const barra = await fetch(`${baseUrl}/tableros/${ID_G}`, { headers: { Cookie: cookie } });
      assert.equal(barra.status, 200);
      assert.match(await barra.text(), /class="bars"/);

      const cambioLinea = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: `cambiar tipo de grafico a linea en ${ID_G}` }),
      });
      assert.match((await cambioLinea.json()).respuesta, /cambiado a "linea"/);

      const linea = await fetch(`${baseUrl}/tableros/${ID_G}`, { headers: { Cookie: cookie } });
      assert.equal(linea.status, 200);
      assert.match(await linea.text(), /class="linea-grafico"/);

      await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: `cambiar tipo de grafico a torta en ${ID_G}` }),
      });

      const torta = await fetch(`${baseUrl}/tableros/${ID_G}`, { headers: { Cookie: cookie } });
      assert.equal(torta.status, 200);
      const tortaHtml = await torta.text();
      assert.match(tortaHtml, /class="torta-wrap"/);
      assert.match(tortaHtml, /conic-gradient/);
      assert.match(tortaHtml, /Cliente Test/);
    });
  });
});
