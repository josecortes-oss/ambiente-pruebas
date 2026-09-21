const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const odooClient = require('./odoo-client');
const { loadValidatedDefinitions, validateDefinition } = require('./tableros');
const { obtenerDatosVentasMensuales } = require('./ventas-mensual');
const { PERIODOS } = require('./agregaciones');

const TABLEROS_DIR = path.join(__dirname, '..', 'tableros');

// Tableros de tipo especial: su lógica vive en código (src/*-mensual.js), no
// en YAML genérico, así que el chat nunca los crea/edita/elimina.
const TABLEROS_ESPECIALES = new Set(['ventas', 'compras']);
function mensajeTableroEspecial(id, accion) {
  return `El tablero "${id}" es de tipo especial y no se puede ${accion} por chat.`;
}

const MAPA_ACENTOS = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ñ: 'N' };
// No pasa a minúsculas: hay que preservar mayúsculas en texto libre (títulos,
// nombres). Los patrones de comando se comparan sin distinguir mayúsculas
// (ver flag "i" al hacer match), así que esto no afecta el reconocimiento.
function normalizar(texto) {
  return texto
    .trim()
    .replace(/[áéíóúñÁÉÍÓÚÑ]/g, (c) => MAPA_ACENTOS[c])
    .replace(/^[¿¡]+/, '')
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ');
}

const FRASE_A_PERIODO = {
  'este mes': 'este_mes',
  'mes anterior': 'mes_anterior',
  'este ano': 'este_anio',
  'ano anterior': 'anio_anterior',
  'todo el historico': 'todos',
  todo: 'todos',
  historico: 'todos',
};

function periodoDesdeFrase(frase) {
  if (!frase) return 'este_mes';
  return FRASE_A_PERIODO[frase.trim().toLowerCase()] || 'este_mes';
}

function etiquetaPeriodo(clave) {
  return (PERIODOS.find((p) => p.clave === clave) || {}).etiqueta || clave;
}

function formatearEntradas(grafico) {
  if (!grafico.entradas.length) return 'Sin datos para ese período.';
  return grafico.entradas
    .map(([etiqueta, valor], i) => `${i + 1}. ${etiqueta}: ${valor.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`)
    .join('\n');
}

function cargarTablero(id) {
  const archivo = path.join(TABLEROS_DIR, `${id}.yaml`);
  if (!fs.existsSync(archivo)) return null;
  const def = yaml.load(fs.readFileSync(archivo, 'utf8'));
  def._id = id;
  return def;
}

// Respaldo de un solo nivel: antes de que el chat escriba o borre un tablero,
// guarda el contenido anterior aquí. "Deshacer" restaura ese único respaldo
// (no es un historial multi-versión, solo el último cambio).
let ultimoRespaldo = null;

function registrarRespaldo(id, contenidoAnterior, descripcion) {
  ultimoRespaldo = { id, contenidoAnterior, descripcion };
}

function obtenerUltimoCambio() {
  return ultimoRespaldo;
}

function deshacerUltimoCambio() {
  if (!ultimoRespaldo) return { ok: false, mensaje: 'No hay cambios para deshacer.' };
  const { id, contenidoAnterior } = ultimoRespaldo;
  const archivo = path.join(TABLEROS_DIR, `${id}.yaml`);
  if (contenidoAnterior === null) {
    if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
  } else {
    fs.writeFileSync(archivo, contenidoAnterior, 'utf8');
  }
  const id_ = ultimoRespaldo.id;
  ultimoRespaldo = null;
  return { ok: true, mensaje: `Se deshizo el último cambio en "${id_}".`, id: id_ };
}

async function guardarSiValido(id, def) {
  const validacion = await validateDefinition(def);
  if (!validacion.valido) {
    return { ok: false, mensaje: `No se pudo guardar "${id}", falló la evaluación semántica:\n${validacion.errores.join('\n')}` };
  }
  const archivo = path.join(TABLEROS_DIR, `${id}.yaml`);
  const contenidoAnterior = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : null;
  const { _id, ...definicionLimpia } = def;
  fs.writeFileSync(archivo, yaml.dump(definicionLimpia), 'utf8');
  registrarRespaldo(id, contenidoAnterior, `Editado por chat: "${id}"`);
  return { ok: true };
}

const AYUDA = `Comandos disponibles:
- listar tableros
- campos de <modelo>                              (ej. campos de sale.order)
- top productos [de <período>]
- top clientes [de <período>]
- ventas por vendedor [de <período>]
- ventas de <período>                             (períodos: este mes, mes anterior, este año, año anterior, todo)
- crear tablero <id>: modelo <modelo>, campos <c1,c2,...>[, titulo <texto>]
- agregar campo <campo> a <id>
- quitar campo <campo> de <id>
- agregar grafico a <id>: agrupar por <campo> midiendo <campo>
- eliminar tablero <id>
(Los tableros "ventas" y "compras" son de tipo especial y no se pueden editar por chat.)`;

const COMANDOS = [
  {
    patron: /^ayuda$|^help$/,
    accion: async () => AYUDA,
  },
  {
    patron: /^listar tableros$/,
    accion: async () => {
      const definiciones = await loadValidatedDefinitions();
      return definiciones
        .map((d) => `- ${d._id}: "${d.titulo || d._id}" (${d.tipo || d.modelo}) ${d.valido ? '' : '[INVALIDO]'}`)
        .join('\n');
    },
  },
  {
    patron: /^(?:mostrar )?campos de ([\w.]+)$/,
    accion: async ([, modeloBruto]) => {
      const modelo = modeloBruto.toLowerCase();
      const fieldsGet = await odooClient.executeKw(modelo, 'fields_get', [], { attributes: ['string', 'type'] });
      const campos = Object.entries(fieldsGet);
      const listado = campos
        .slice(0, 40)
        .map(([campo, info]) => `- ${campo} (${info.type}): ${info.string}`)
        .join('\n');
      const extra = campos.length > 40 ? `\n... y ${campos.length - 40} campos más.` : '';
      return `Campos de ${modelo}:\n${listado}${extra}`;
    },
  },
  {
    patron: /^top productos(?: de (este mes|mes anterior|este ano|ano anterior|todo el historico|todo))?$/,
    accion: async ([, frase]) => {
      const periodo = periodoDesdeFrase(frase);
      const datos = await obtenerDatosVentasMensuales({ periodo, empresaId: null, vendedorId: null });
      return `Top productos (${etiquetaPeriodo(periodo)}):\n${formatearEntradas(datos.graficoProductos)}`;
    },
  },
  {
    patron: /^top clientes(?: de (este mes|mes anterior|este ano|ano anterior|todo el historico|todo))?$/,
    accion: async ([, frase]) => {
      const periodo = periodoDesdeFrase(frase);
      const datos = await obtenerDatosVentasMensuales({ periodo, empresaId: null, vendedorId: null });
      return `Top clientes (${etiquetaPeriodo(periodo)}):\n${formatearEntradas(datos.graficoClientes)}`;
    },
  },
  {
    patron: /^ventas por vendedor(?: de (este mes|mes anterior|este ano|ano anterior|todo el historico|todo))?$/,
    accion: async ([, frase]) => {
      const periodo = periodoDesdeFrase(frase);
      const datos = await obtenerDatosVentasMensuales({ periodo, empresaId: null, vendedorId: null });
      return `Ventas por vendedor (${etiquetaPeriodo(periodo)}):\n${formatearEntradas(datos.graficoVendedores)}`;
    },
  },
  {
    patron: /^ventas de (este mes|mes anterior|este ano|ano anterior|todo el historico|todo)$/,
    accion: async ([, frase]) => {
      const periodo = periodoDesdeFrase(frase);
      const datos = await obtenerDatosVentasMensuales({ periodo, empresaId: null, vendedorId: null });
      const total = datos.filas.reduce((acc, f) => acc + (f.amount_total || 0), 0);
      return `Ventas ${etiquetaPeriodo(periodo)}: ${datos.filas.length} órdenes, total ${total.toLocaleString('es-CL', { maximumFractionDigits: 2 })}.`;
    },
  },
  {
    patron: /^crear tablero ([\w-]+): modelo ([\w.]+), campos ([\w., ]+?)(?:, titulo (.+))?$/,
    accion: async ([, idBruto, modeloBruto, camposTexto, titulo], { tableroModificado }) => {
      const id = idBruto.toLowerCase();
      const modelo = modeloBruto.toLowerCase();
      if (TABLEROS_ESPECIALES.has(id)) return mensajeTableroEspecial(id, 'crear/reemplazar');
      const campos = camposTexto.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
      const def = {
        titulo: titulo || id,
        modelo,
        campos: campos.map((c) => ({ campo: c, etiqueta: c })),
        dominio: [],
        limite: 80,
        posicion: 99,
      };
      const resultado = await guardarSiValido(id, def);
      if (resultado.ok) tableroModificado.id = id;
      return resultado.ok ? `Tablero "${id}" creado.` : resultado.mensaje;
    },
  },
  {
    patron: /^agregar campo ([\w.]+) a ([\w-]+)$/,
    accion: async ([, campoBruto, idBruto], { tableroModificado }) => {
      const campo = campoBruto.toLowerCase();
      const id = idBruto.toLowerCase();
      if (TABLEROS_ESPECIALES.has(id)) return mensajeTableroEspecial(id, 'editar');
      const def = cargarTablero(id);
      if (!def) return `No existe el tablero "${id}".`;
      def.campos = def.campos || [];
      if (def.campos.some((c) => (typeof c === 'string' ? c : c.campo) === campo)) {
        return `"${campo}" ya está en el tablero "${id}".`;
      }
      def.campos.push({ campo, etiqueta: campo });
      const resultado = await guardarSiValido(id, def);
      if (resultado.ok) tableroModificado.id = id;
      return resultado.ok ? `Campo "${campo}" agregado a "${id}".` : resultado.mensaje;
    },
  },
  {
    patron: /^quitar campo ([\w.]+) de ([\w-]+)$/,
    accion: async ([, campoBruto, idBruto], { tableroModificado }) => {
      const campo = campoBruto.toLowerCase();
      const id = idBruto.toLowerCase();
      if (TABLEROS_ESPECIALES.has(id)) return mensajeTableroEspecial(id, 'editar');
      const def = cargarTablero(id);
      if (!def) return `No existe el tablero "${id}".`;
      const antes = (def.campos || []).length;
      def.campos = (def.campos || []).filter((c) => (typeof c === 'string' ? c : c.campo) !== campo);
      if (def.campos.length === antes) return `"${campo}" no estaba en el tablero "${id}".`;
      if (def.campos.length === 0) return `No se puede quitar "${campo}": el tablero necesita al menos un campo.`;
      const resultado = await guardarSiValido(id, def);
      if (resultado.ok) tableroModificado.id = id;
      return resultado.ok ? `Campo "${campo}" quitado de "${id}".` : resultado.mensaje;
    },
  },
  {
    patron: /^agregar grafico a ([\w-]+): agrupar por ([\w.]+) midiendo ([\w.]+)$/,
    accion: async ([, idBruto, agruparPorBruto, medirBruto], { tableroModificado }) => {
      const id = idBruto.toLowerCase();
      const agruparPor = agruparPorBruto.toLowerCase();
      const medir = medirBruto.toLowerCase();
      if (TABLEROS_ESPECIALES.has(id)) return mensajeTableroEspecial(id, 'editar');
      const def = cargarTablero(id);
      if (!def) return `No existe el tablero "${id}".`;
      def.grafico = { titulo: `${medir} por ${agruparPor}`, agrupar_por: agruparPor, medir };
      const resultado = await guardarSiValido(id, def);
      if (resultado.ok) tableroModificado.id = id;
      return resultado.ok ? `Gráfico agregado a "${id}".` : resultado.mensaje;
    },
  },
  {
    patron: /^eliminar tablero ([\w-]+)$/,
    accion: async ([, idBruto], { tableroModificado }) => {
      const id = idBruto.toLowerCase();
      if (TABLEROS_ESPECIALES.has(id)) return mensajeTableroEspecial(id, 'eliminar');
      const archivo = path.join(TABLEROS_DIR, `${id}.yaml`);
      if (!fs.existsSync(archivo)) return `No existe el tablero "${id}".`;
      const contenidoAnterior = fs.readFileSync(archivo, 'utf8');
      fs.unlinkSync(archivo);
      registrarRespaldo(id, contenidoAnterior, `Eliminado por chat: "${id}"`);
      tableroModificado.id = id;
      return `Tablero "${id}" eliminado.`;
    },
  },
];

async function responderChat(mensaje) {
  const normalizado = normalizar(mensaje);
  const tableroModificado = { id: null };

  for (const { patron, accion } of COMANDOS) {
    const patronSinDistinguirMayus = patron.flags.includes('i') ? patron : new RegExp(patron.source, `${patron.flags}i`);
    const coincidencia = normalizado.match(patronSinDistinguirMayus);
    if (coincidencia) {
      try {
        const respuesta = await accion(coincidencia, { tableroModificado });
        return { respuesta, tableroModificado: tableroModificado.id };
      } catch (err) {
        return { respuesta: `Error ejecutando el comando: ${err.message || err}`, tableroModificado: null };
      }
    }
  }

  return {
    respuesta: `No reconozco ese comando. Escribe "ayuda" para ver la lista de comandos disponibles.`,
    tableroModificado: null,
  };
}

module.exports = { responderChat, obtenerUltimoCambio, deshacerUltimoCambio };
