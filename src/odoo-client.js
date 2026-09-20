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

/**
 * Confirma que `login`/`password` corresponden a un usuario Odoo activo.
 * Se usa solo para validar la identidad en el login; el uid que devuelve
 * NO se reutiliza para consultar datos (ver `getServiceConnection`).
 */
async function authenticate(login, password) {
  const common = createClient('/xmlrpc/2/common');
  return methodCall(common, 'authenticate', [ODOO_DB, login, password, {}]);
}

let serviceConnectionPromise = null;

/**
 * Conexión única a la base de datos, autenticada con la API key de servicio
 * definida en ambiente-pruebas.env (ODOO_LOGIN/ODOO_API_KEY). Todas las
 * consultas de los tableros pasan por esta conexión, independientemente
 * de qué usuario haya iniciado sesión en la herramienta.
 */
async function getServiceConnection() {
  if (!serviceConnectionPromise) {
    serviceConnectionPromise = authenticate(process.env.ODOO_LOGIN, process.env.ODOO_API_KEY).then((uid) => {
      if (!uid) throw new Error('No se pudo autenticar la API key de servicio (ODOO_LOGIN/ODOO_API_KEY).');
      return { uid, apiKey: process.env.ODOO_API_KEY };
    });
    serviceConnectionPromise.catch(() => {
      serviceConnectionPromise = null; // permite reintentar si la primera conexión falla
    });
  }
  return serviceConnectionPromise;
}

/**
 * Ejecuta execute_kw contra la conexión de servicio (API key), nunca con
 * las credenciales personales del usuario que está mirando el tablero.
 */
async function executeKw(model, method, args, kwargs = {}) {
  const { uid, apiKey } = await getServiceConnection();
  const models = createClient('/xmlrpc/2/object');
  return methodCall(models, 'execute_kw', [ODOO_DB, uid, apiKey, model, method, args, kwargs]);
}

module.exports = { ODOO_DB, ODOO_URL, authenticate, executeKw };
