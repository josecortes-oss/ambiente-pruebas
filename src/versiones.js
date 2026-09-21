const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Versionador de tableros: cada vez que el chat guarda un cambio en un
// tablero genérico (crear/editar), además de escribir tableros/<id>.yaml
// se agrega una copia con fecha a tableros/.versiones/<id>.yaml — así se
// puede ir revisando el avance del gráfico a medida que se piden cambios,
// y recuperar (restaurar) cualquier versión anterior. No se comitea al
// repo (ver .gitignore): es historial de uso, no parte del código.
const VERSIONES_DIR = path.join(__dirname, '..', 'tableros', '.versiones');

function archivoDe(id) {
  return path.join(VERSIONES_DIR, `${id}.yaml`);
}

/** Todas las versiones guardadas de un tablero, en el orden en que se
 * crearon (la más vieja primero, índice 1 = "versión 1"). */
function listarVersiones(id) {
  const archivo = archivoDe(id);
  if (!fs.existsSync(archivo)) return [];
  return yaml.load(fs.readFileSync(archivo, 'utf8')) || [];
}

/** Agrega una versión nueva al final del historial de `id`. `def` ya debe
 * venir limpio (sin _id/_file). Devuelve el número de la versión recién
 * creada (1-based, para que el chat pueda decir "versión 3 guardada"). */
function guardarVersion(id, def, descripcion) {
  if (!fs.existsSync(VERSIONES_DIR)) fs.mkdirSync(VERSIONES_DIR, { recursive: true });
  const versiones = listarVersiones(id);
  versiones.push({ fecha: new Date().toISOString(), descripcion, definicion: def });
  fs.writeFileSync(archivoDe(id), yaml.dump(versiones), 'utf8');
  return versiones.length;
}

/** La versión `numero` (1-based) de `id`, o null si no existe. */
function obtenerVersion(id, numero) {
  const versiones = listarVersiones(id);
  return versiones[numero - 1] || null;
}

/** Borra todo el historial de `id` (no toca el tablero actual) para poder
 * empezar a versionar de nuevo desde cero. */
function eliminarVersiones(id) {
  const archivo = archivoDe(id);
  if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
}

module.exports = { listarVersiones, guardarVersion, obtenerVersion, eliminarVersiones };
