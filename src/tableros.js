const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { executeKw } = require('./odoo-client');

const TABLEROS_DIR = path.join(__dirname, '..', 'tableros');

function listDefinitionFiles() {
  return fs
    .readdirSync(TABLEROS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
}

function loadDefinition(file) {
  const raw = fs.readFileSync(path.join(TABLEROS_DIR, file), 'utf8');
  const def = yaml.load(raw);
  def._id = path.basename(file, path.extname(file));
  def._file = file;
  return def;
}

function loadAllDefinitions() {
  return listDefinitionFiles().map(loadDefinition);
}

const LOGICAL_OPERATORS = new Set(['&', '|', '!']);

function extractDomainFields(domain) {
  if (!Array.isArray(domain)) return [];
  const fields = [];
  for (const term of domain) {
    if (Array.isArray(term) && term.length === 3) {
      fields.push(String(term[0]).split('.')[0]);
    } else if (typeof term === 'string' && LOGICAL_OPERATORS.has(term)) {
      // operador lógico, no es un campo
    }
  }
  return fields;
}

/**
 * Evaluación semántica: antes de exponer un tablero, confirma contra Odoo
 * (por la conexión de servicio, ver odoo-client.js) que el modelo y todos
 * los campos referenciados (columnas + dominio) existen y son accesibles.
 * Un tablero que falla esta evaluación nunca llega a mostrarse.
 */
async function validateDefinition(def) {
  const errors = [];

  if (!def.modelo) errors.push('Falta la clave "modelo".');
  if (!Array.isArray(def.campos) || def.campos.length === 0) {
    errors.push('Falta la clave "campos" (lista de campos a mostrar).');
  }
  if (errors.length > 0) {
    return { valido: false, errores: errors };
  }

  let fieldsGet;
  try {
    fieldsGet = await executeKw(def.modelo, 'fields_get', [], { attributes: ['string', 'type'] });
  } catch (err) {
    return {
      valido: false,
      errores: [`El modelo "${def.modelo}" no existe o no es accesible: ${err.message || err}`],
    };
  }

  const camposModelo = new Set(Object.keys(fieldsGet));
  const camposReferenciados = new Set([
    ...def.campos.map((c) => (typeof c === 'string' ? c : c.campo)),
    ...extractDomainFields(def.dominio),
  ]);

  for (const campo of camposReferenciados) {
    if (!camposModelo.has(campo)) {
      errors.push(`El campo "${campo}" no existe en el modelo "${def.modelo}".`);
    }
  }

  return { valido: errors.length === 0, errores: errors };
}

async function loadValidatedDefinitions() {
  const definiciones = loadAllDefinitions();
  const resultados = [];
  for (const def of definiciones) {
    const validacion = await validateDefinition(def);
    resultados.push({ ...def, ...validacion });
  }
  return resultados;
}

async function getValidatedDefinition(id) {
  const files = listDefinitionFiles();
  const file = files.find((f) => path.basename(f, path.extname(f)) === id);
  if (!file) return null;
  const def = loadDefinition(file);
  const validacion = await validateDefinition(def);
  return { ...def, ...validacion };
}

module.exports = { loadValidatedDefinitions, getValidatedDefinition, validateDefinition };
