// Datos compartidos por el topbar en cualquier página del workspace
// (tableros y la administración de la capa semántica).
const odooClient = require('./odoo-client');
const { loadValidatedDefinitions } = require('./tableros');
const { obtenerUltimoCambio } = require('./chat');

async function esAdministrador(uid) {
  try {
    return await odooClient.executeKw('res.users', 'has_group', [uid, 'base.group_system']);
  } catch {
    return false;
  }
}

async function datosTopbar(usuario, activoId) {
  const definiciones = await loadValidatedDefinitions();
  const esAdmin = await esAdministrador(usuario.uid);
  const tabs = definiciones.filter((d) => d.valido);
  const invalidos = esAdmin ? definiciones.filter((d) => !d.valido) : [];
  return { tabs, activoId, esAdmin, invalidos, cambioPendiente: obtenerUltimoCambio() };
}

module.exports = { esAdministrador, datosTopbar };
