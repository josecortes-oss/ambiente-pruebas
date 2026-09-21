const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const odooClient = require('./odoo-client');

const RUTA_POR_DEFECTO = path.join(__dirname, '..', 'semantica', 'conceptos.yaml');
let archivoConceptos = RUTA_POR_DEFECTO;

/** Solo para tests: redirige las lecturas/escrituras a un archivo temporal,
 * para que correr el test suite nunca reescriba (y reformatee) el
 * semantica/conceptos.yaml real del repositorio. Sin argumento, restaura
 * la ruta real. */
function _usarArchivoParaPruebas(ruta) {
  archivoConceptos = ruta || RUTA_POR_DEFECTO;
}

// escribirArchivoBruto() reescribe el archivo completo (yaml.dump no sabe
// preservar comentarios ni el formato original) cada vez que se guarda o
// elimina un concepto desde /semantica; sin este encabezado fijo, el primer
// guardado desde el admin borraría la documentación del formato.
const ENCABEZADO = `# Capa semántica: vocabulario de negocio -> modelo/campo real de Odoo.
#
# Cada concepto describe UNA cosa que el negocio reconoce (un cliente, un
# monto vendido, una etapa de oportunidad) y dónde vive de verdad en Odoo.
# El chat (src/chat.js, comandos "conceptos"/"sugerir tablero"/"crear tablero
# <id> de <modulo>") lee este archivo para sugerir y construir tableros sin
# que el usuario tenga que conocer los nombres técnicos de Odoo.
#
# Administrable desde /semantica (solo administradores de Odoo); cada
# guardado se valida contra Odoo (fields_get) antes de escribirse.
#
# Campos de cada concepto:
#   modulo      - ventas | compras | crm | financiero | inventario | produccion
#   modelo      - modelo técnico de Odoo
#   campo       - campo técnico de Odoo
#   tipo        - "dimension" (para agrupar) | "medida" (para sumar/promediar)
#   agregacion  - solo en medidas: suma | promedio
#   etiqueta    - nombre para mostrar
#   descripcion - de dónde sale y qué significa
#   dominio     - (opcional) filtro base que aplica siempre que se use la medida
#
# NOTA: este archivo se reescribe por completo desde /semantica; los
# comentarios puestos a mano dentro del cuerpo (no este encabezado) no
# sobreviven a un guardado desde ahí.

`;

const ETIQUETA_MODULO = {
  ventas: 'Ventas', compras: 'Compras', crm: 'CRM',
  financiero: 'Financiero', inventario: 'Inventario', produccion: 'Producción',
};

function cargarConceptos() {
  const bruto = yaml.load(fs.readFileSync(archivoConceptos, 'utf8')) || {};
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

function leerArchivoBruto() {
  return yaml.load(fs.readFileSync(archivoConceptos, 'utf8')) || {};
}

function escribirArchivoBruto(objeto) {
  fs.writeFileSync(archivoConceptos, ENCABEZADO + yaml.dump(objeto), 'utf8');
}

/**
 * Evaluación semántica de UN concepto suelto (para el formulario de
 * administración): forma correcta + que modelo/campo (y los campos usados
 * en su "dominio") existan de verdad en Odoo. Mismo criterio que
 * validateDefinition usa para los tableros.
 */
async function validarConceptoIndividual(def) {
  const errores = [];
  if (!def.modulo) errores.push('Falta "modulo".');
  if (!def.modelo) errores.push('Falta "modelo".');
  if (!def.campo) errores.push('Falta "campo".');
  if (!def.etiqueta) errores.push('Falta "etiqueta".');
  if (def.tipo !== 'dimension' && def.tipo !== 'medida') errores.push('"tipo" debe ser "dimension" o "medida".');
  if (def.tipo === 'medida' && !def.agregacion) errores.push('Las medidas necesitan "agregacion".');
  if (def.dominio !== undefined && !Array.isArray(def.dominio)) errores.push('"dominio" debe ser una lista de [campo, operador, valor].');
  if (errores.length > 0) return { valido: false, errores };

  let fieldsGet;
  try {
    fieldsGet = await odooClient.executeKw(def.modelo, 'fields_get', [], { attributes: ['string', 'type'] });
  } catch (err) {
    return { valido: false, errores: [`El modelo "${def.modelo}" no existe o no es accesible: ${err.message || err}`] };
  }
  const camposModelo = new Set(Object.keys(fieldsGet));
  if (!camposModelo.has(def.campo)) {
    errores.push(`El campo "${def.campo}" no existe en el modelo "${def.modelo}".`);
  }
  for (const term of def.dominio || []) {
    if (Array.isArray(term) && term.length === 3) {
      const campoBase = String(term[0]).split('.')[0];
      if (!camposModelo.has(campoBase)) {
        errores.push(`El campo "${campoBase}" usado en "dominio" no existe en el modelo "${def.modelo}".`);
      }
    }
  }
  return { valido: errores.length === 0, errores };
}

/** Crea o actualiza (si `nombre` ya existe) un concepto, validado contra
 * Odoo antes de escribir — nunca se guarda un concepto que el agente no
 * podría usar de verdad. */
async function guardarConcepto(nombre, def) {
  const validacion = await validarConceptoIndividual(def);
  if (!validacion.valido) return { ok: false, errores: validacion.errores };
  const bruto = leerArchivoBruto();
  bruto[nombre] = def;
  escribirArchivoBruto(bruto);
  return { ok: true };
}

function eliminarConcepto(nombre) {
  const bruto = leerArchivoBruto();
  if (!(nombre in bruto)) return { ok: false, mensaje: `No existe el concepto "${nombre}".` };
  delete bruto[nombre];
  escribirArchivoBruto(bruto);
  return { ok: true };
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
  validarConceptoIndividual,
  guardarConcepto,
  eliminarConcepto,
  construirDefinicionDesdeConceptos,
  sugerirConceptosPorDefecto,
  ETIQUETA_MODULO,
  _usarArchivoParaPruebas,
};
