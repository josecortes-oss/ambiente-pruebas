const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const odooClient = require('./odoo-client');

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
  // "posicion" ordena la lista de tableros; no confundir con "orden", que en
  // cada tablero es la cláusula order-by de Odoo (p. ej. "date_order desc").
  return listDefinitionFiles()
    .map(loadDefinition)
    .sort((a, b) => (a.posicion ?? 999) - (b.posicion ?? 999) || a._id.localeCompare(b._id));
}

const TIPOS_GRAFICO = new Set(['barra', 'linea', 'torta']);

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
async function validarCamposModelo(modelo, campos, errors) {
  let fieldsGet;
  try {
    fieldsGet = await odooClient.executeKw(modelo, 'fields_get', [], { attributes: ['string', 'type'] });
  } catch (err) {
    errors.push(`El modelo "${modelo}" no existe o no es accesible: ${err.message || err}`);
    return;
  }
  const camposModelo = new Set(Object.keys(fieldsGet));
  for (const campo of campos) {
    if (!camposModelo.has(campo)) {
      errors.push(`El campo "${campo}" no existe en el modelo "${modelo}".`);
    }
  }
}

// Tableros de tipo especial (lógica propia en las rutas, no genérica por YAML):
// cada uno declara los campos que su código realmente usa, para que la
// evaluación semántica los siga cubriendo.
const CAMPOS_POR_TIPO = {
  ventas_mensual: {
    'sale.order': ['name', 'partner_id', 'user_id', 'company_id', 'date_order', 'amount_total', 'state'],
    'sale.order.line': ['order_id', 'product_id', 'price_subtotal'],
  },
  compras_mensual: {
    'purchase.order': ['name', 'partner_id', 'company_id', 'date_order', 'amount_total', 'state'],
    'purchase.order.line': ['order_id', 'product_id', 'price_subtotal'],
  },
};

/**
 * Evaluación semántica: antes de exponer un tablero, confirma contra Odoo
 * (por la conexión de servicio, ver odoo-client.js) que el modelo y todos
 * los campos referenciados (columnas + dominio) existen y son accesibles.
 * Un tablero que falla esta evaluación nunca llega a mostrarse.
 */
async function validateDefinition(def) {
  const errors = [];

  if (def.tipo && CAMPOS_POR_TIPO[def.tipo]) {
    for (const [modelo, campos] of Object.entries(CAMPOS_POR_TIPO[def.tipo])) {
      await validarCamposModelo(modelo, campos, errors);
    }
    return { valido: errors.length === 0, errores: errors };
  }

  if (!def.modelo) errors.push('Falta la clave "modelo".');
  if (!Array.isArray(def.campos) || def.campos.length === 0) {
    errors.push('Falta la clave "campos" (lista de campos a mostrar).');
  }
  if (errors.length > 0) {
    return { valido: false, errores: errors };
  }

  let fieldsGet;
  try {
    fieldsGet = await odooClient.executeKw(def.modelo, 'fields_get', [], { attributes: ['string', 'type'] });
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

  if (def.grafico) {
    if (!def.grafico.agrupar_por) errors.push('El bloque "grafico" necesita "agrupar_por".');
    if (!def.grafico.medir) errors.push('El bloque "grafico" necesita "medir".');
    if (def.grafico.agrupar_por) camposReferenciados.add(def.grafico.agrupar_por);
    if (def.grafico.medir) camposReferenciados.add(def.grafico.medir);
    if (def.grafico.tipo_grafico && !TIPOS_GRAFICO.has(def.grafico.tipo_grafico)) {
      errors.push(`"tipo_grafico" debe ser uno de: ${[...TIPOS_GRAFICO].join(', ')} (no "${def.grafico.tipo_grafico}").`);
    }
  }

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
