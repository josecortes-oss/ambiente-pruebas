const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const odooClient = require('./odoo-client');

const ARCHIVO_CONCEPTOS = path.join(__dirname, '..', 'semantica', 'conceptos.yaml');

const ETIQUETA_MODULO = {
  ventas: 'Ventas', compras: 'Compras', crm: 'CRM',
  financiero: 'Financiero', inventario: 'Inventario', produccion: 'Producción',
};

function cargarConceptos() {
  const bruto = yaml.load(fs.readFileSync(ARCHIVO_CONCEPTOS, 'utf8')) || {};
  return Object.entries(bruto).map(([nombre, def]) => ({ nombre, ...def }));
}

function listarModulos() {
  return [...new Set(cargarConceptos().map((c) => c.modulo))].sort();
}

function conceptosDeModulo(modulo) {
  return cargarConceptos().filter((c) => c.modulo === modulo);
}

function resolverConcepto(nombre) {
  return cargarConceptos().find((c) => c.nombre === nombre) || null;
}

/**
 * Evaluación semántica de la propia capa semántica: confirma contra Odoo
 * (fields_get, agrupado por modelo para no repetir llamadas) que cada
 * modelo/campo declarado en semantica/conceptos.yaml sigue existiendo.
 */
async function validarConceptos() {
  const conceptos = cargarConceptos();
  const porModelo = new Map();
  for (const c of conceptos) {
    if (!porModelo.has(c.modelo)) porModelo.set(c.modelo, []);
    porModelo.get(c.modelo).push(c);
  }

  const errores = [];
  for (const [modelo, items] of porModelo) {
    let fieldsGet;
    try {
      fieldsGet = await odooClient.executeKw(modelo, 'fields_get', [], { attributes: ['string', 'type'] });
    } catch (err) {
      errores.push(`Modelo "${modelo}" no existe o no es accesible (usado por: ${items.map((i) => i.nombre).join(', ')}).`);
      continue;
    }
    const camposModelo = new Set(Object.keys(fieldsGet));
    for (const c of items) {
      if (!camposModelo.has(c.campo)) {
        errores.push(`Concepto "${c.nombre}": el campo "${c.campo}" no existe en el modelo "${modelo}".`);
      }
    }
  }
  return { valido: errores.length === 0, errores };
}

/**
 * Arma una definición de tablero genérico (mismo formato que un YAML
 * normal en tableros/) a partir de conceptos de la capa semántica. No
 * escribe nada; eso lo decide quien llama (sugerir vs. crear).
 */
function construirDefinicionDesdeConceptos(id, modulo, nombresConceptos) {
  const conceptos = nombresConceptos.map((n) => resolverConcepto(n)).filter(Boolean);
  const faltantes = nombresConceptos.filter((n) => !resolverConcepto(n));
  if (faltantes.length) {
    return { error: `No existen los conceptos: ${faltantes.join(', ')}. Usa "conceptos de ${modulo}" para ver los disponibles.` };
  }
  const fueraDeModulo = conceptos.filter((c) => c.modulo !== modulo);
  if (fueraDeModulo.length) {
    return { error: `Estos conceptos no son del módulo "${modulo}": ${fueraDeModulo.map((c) => c.nombre).join(', ')}.` };
  }
  const modelos = new Set(conceptos.map((c) => c.modelo));
  if (modelos.size > 1) {
    return {
      error: `Los conceptos elegidos pertenecen a distintos modelos (${[...modelos].join(', ')}); ` +
        'un tablero genérico solo puede usar un modelo a la vez.',
    };
  }

  const dimensiones = conceptos.filter((c) => c.tipo === 'dimension');
  const medidas = conceptos.filter((c) => c.tipo === 'medida');
  if (dimensiones.length === 0 || medidas.length === 0) {
    return { error: 'Un tablero necesita al menos un concepto de dimensión y uno de medida.' };
  }

  const modelo = conceptos[0].modelo;
  const campos = conceptos.map((c) => ({ campo: c.campo, etiqueta: c.etiqueta }));
  const primeraMedida = medidas[0];
  const primeraDimension = dimensiones[0];

  const def = {
    titulo: `${ETIQUETA_MODULO[modulo] || modulo}: ${conceptos.map((c) => c.etiqueta).join(' / ')}`,
    modulo,
    modelo,
    campos,
    dominio: primeraMedida.dominio || [],
    limite: 80,
    posicion: 99,
    grafico: {
      titulo: `${primeraMedida.etiqueta} por ${primeraDimension.etiqueta}`,
      agrupar_por: primeraDimension.campo,
      medir: primeraMedida.campo,
    },
  };
  return { def };
}

/** Selección por defecto cuando el usuario no elige conceptos explícitos:
 * hasta 2 dimensiones + 1 medida del mismo modelo, priorizando el modelo
 * más usado en ese módulo (así "producto" a nivel línea no se mezcla con
 * el resto de conceptos a nivel cabecera). */
function sugerirConceptosPorDefecto(modulo) {
  const disponibles = conceptosDeModulo(modulo);
  if (!disponibles.length) return null;

  const conteoPorModelo = new Map();
  for (const c of disponibles) conteoPorModelo.set(c.modelo, (conteoPorModelo.get(c.modelo) || 0) + 1);
  const modeloPrincipal = [...conteoPorModelo.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const delModeloPrincipal = disponibles.filter((c) => c.modelo === modeloPrincipal);
  const dimensiones = delModeloPrincipal.filter((c) => c.tipo === 'dimension').slice(0, 2);
  const medidas = delModeloPrincipal.filter((c) => c.tipo === 'medida').slice(0, 1);
  if (!dimensiones.length || !medidas.length) return null;
  return [...dimensiones, ...medidas].map((c) => c.nombre);
}

module.exports = {
  cargarConceptos,
  listarModulos,
  conceptosDeModulo,
  resolverConcepto,
  validarConceptos,
  construirDefinicionDesdeConceptos,
  sugerirConceptosPorDefecto,
  ETIQUETA_MODULO,
};
