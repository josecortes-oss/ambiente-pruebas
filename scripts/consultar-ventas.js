require('dotenv').config({ path: `${__dirname}/../ambiente-pruebas.env` });
const xmlrpc = require('xmlrpc');

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_LOGIN = process.env.ODOO_LOGIN;
const ODOO_API_KEY = process.env.ODOO_API_KEY;

function createClient(path) {
  return xmlrpc.createSecureClient({ host: ODOO_URL, port: 443, path });
}

function methodCall(client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, value) => {
      if (err) return reject(err);
      resolve(value);
    });
  });
}

async function authenticate() {
  const common = createClient('/xmlrpc/2/common');
  return methodCall(common, 'authenticate', [ODOO_DB, ODOO_LOGIN, ODOO_API_KEY, {}]);
}

async function executeKw(uid, model, method, args, kwargs = {}) {
  const models = createClient('/xmlrpc/2/object');
  return methodCall(models, 'execute_kw', [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs]);
}

async function main() {
  const uid = await authenticate();
  if (!uid) throw new Error('Autenticación fallida contra Odoo');

  const orders = await executeKw(uid, 'sale.order', 'search_read', [[]], {
    fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state'],
    order: 'name asc',
  });

  const orderIds = orders.map((o) => o.id);
  const lines = await executeKw(uid, 'sale.order.line', 'search_read', [[['order_id', 'in', orderIds]]], {
    fields: ['order_id', 'product_id', 'product_uom_qty', 'price_unit', 'price_subtotal'],
  });

  const linesByOrder = {};
  for (const line of lines) {
    const orderId = line.order_id[0];
    (linesByOrder[orderId] = linesByOrder[orderId] || []).push(line);
  }

  console.log(`Total de órdenes de venta: ${orders.length}\n`);
  for (const order of orders) {
    console.log(`=== ${order.name} | ${order.partner_id[1]} | ${order.date_order} | Total: ${order.amount_total} | ${order.state} ===`);
    for (const line of linesByOrder[order.id] || []) {
      const product = line.product_id ? line.product_id[1] : 'N/A';
      console.log(`  - ${product}: qty=${line.product_uom_qty} precio_unit=${line.price_unit} subtotal=${line.price_subtotal}`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error('Error al consultar ventas:', err.message || err);
  process.exit(1);
});
