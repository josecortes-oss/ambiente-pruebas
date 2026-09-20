const xmlrpc = require('xmlrpc');

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;

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

async function authenticate(login, apiKey) {
  const common = createClient('/xmlrpc/2/common');
  return methodCall(common, 'authenticate', [ODOO_DB, login, apiKey, {}]);
}

/**
 * Ejecuta una llamada execute_kw autenticada como el usuario Odoo dueño
 * de `login`/`apiKey`, de forma que los permisos y el acceso a registros
 * son los que Odoo ya le asigna a ese usuario (no un usuario de servicio).
 */
async function executeKw({ uid, login, apiKey }, model, method, args, kwargs = {}) {
  const models = createClient('/xmlrpc/2/object');
  return methodCall(models, 'execute_kw', [ODOO_DB, uid, apiKey, model, method, args, kwargs]);
}

module.exports = { ODOO_DB, ODOO_URL, authenticate, executeKw };
