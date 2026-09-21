const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const odooClient = require('./odoo-client');
const { loadValidatedDefinitions, validateDefinition } = require('./tableros');
const { obtenerDatosVentasMensuales } = require('./ventas-mensual');
const { PERIODOS, agrupadoAEntradas } = require('./agregaciones');
const consultasModulos = require('./consultas-modulos');
const semantica = require('./semantica');
const versiones = require('./versiones');

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

function formatearListaEntradas(entradas) {
  if (!entradas.length) return 'Sin datos.';
  return entradas
    .map(([etiqueta, valor], i) => `${i + 1}. ${etiqueta}: ${valor.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`)
    .join('\n');
}

function formatearEntradas(grafico) {
  if (!grafico.entradas.length) return 'Sin datos para ese período.';
  return formatearListaEntradas(grafico.entradas);
}

function formatearConcepto(c) {
  const tipo = c.tipo === 'medida' ? `medida, ${c.agregacion}` : 'dimensión';
  return `- ${c.nombre} (${tipo}): ${c.etiqueta} — ${c.modelo}.${c.campo}`;
}

/** "con a, b, c" del usuario, o la sugerencia por defecto de la capa semántica si no se especificó nada. */
function resolverListaConceptos(modulo, listaTexto) {
  if (listaTexto) {
    return listaTexto.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return semantica.sugerirConceptosPorDefecto(modulo);
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

async function guardarSiValido(id, def, descripcionVersion) {
  const validacion = await validateDefinition(def);
  if (!validacion.valido) {
    return { ok: false, mensaje: `No se pudo guardar "${id}", falló la evaluación semántica:\n${validacion.errores.join('\n')}` };
  }
  const archivo = path.join(TABLEROS_DIR, `${id}.yaml`);
  const contenidoAnterior = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : null;
  const { _id, ...definicionLimpia } = def;
  fs.writeFileSync(archivo, yaml.dump(definicionLimpia), 'utf8');
  registrarRespaldo(id, contenidoAnterior, `Editado por chat: "${id}"`);
  const numeroVersion = versiones.guardarVersion(id, definicionLimpia, descripcionVersion || `Editado por chat: "${id}"`);
  return { ok: true, numeroVersion };
}

const AYUDA = `Comandos disponibles:

General:
- listar tableros
- campos de <modelo>                              (ej. campos de sale.order)
- ayuda

Ventas:
- top productos [de <período>]
- top clientes [de <período>]
- ventas por vendedor [de <período>]
- ventas de <período>                             (períodos: este mes, mes anterior, este año, año anterior, todo)

CRM:
- pipeline crm                                    (oportunidades abiertas y valor esperado total)
- top oportunidades
- oportunidades por etapa
- oportunidades por vendedor

Financiero:
- facturas pendientes                             (facturas de venta no pagadas y monto adeudado)
- top clientes facturacion
- facturas por estado

Inventario:
- top productos en stock
- stock de <producto>                             (ej. stock de silla)
- productos sin stock

Producción:
- resumen produccion
- produccion por estado
- top productos producidos

Capa semántica (conceptos de negocio -> modelo/campo real, semantica/conceptos.yaml):
- conceptos                                       (lista todos, agrupados por módulo)
- conceptos de <modulo>                           (ventas | compras | crm | financiero | inventario | produccion)
- validar conceptos                               (confirma contra Odoo que cada modelo/campo sigue existiendo)
- consultar <medida> por <dimension>              (ejecuta la consulta real en Odoo y muestra el resultado; no crea ni guarda ningún tablero)
- sugerir tablero de <modulo>[ con <concepto1>,<concepto2>,...]   (propone un tablero, no lo guarda)
- crear tablero <id> de <modulo>[ con <concepto1>,<concepto2>,...] (lo crea usando los conceptos; sin "con" usa la sugerencia por defecto)

Edición de tableros genéricos:
- crear tablero <id>: modelo <modelo>, campos <c1,c2,...>[, titulo <texto>]
- agregar campo <campo> a <id>
- quitar campo <campo> de <id>
- agregar grafico a <id>: agrupar por <campo> midiendo <campo>
- cambiar tipo de grafico a <barra|linea|torta> en <id>
- eliminar tablero <id>
(Los tableros "ventas" y "compras" son de tipo especial y no se pueden editar por chat.)

Versionador (cada cambio guardado en un tablero queda como una versión nueva):
- versiones de <id>                               (lista el historial, de la más vieja a la más nueva)
- ver version <n> de <id>                         (muestra el YAML de esa versión, sin restaurarla)
- restaurar version <n> de <id>                   (vuelve a dejar esa versión como el tablero actual)
- eliminar versiones de <id>                      (borra todo el historial de <id> para empezar de nuevo)`;

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
  // --- CRM ---
  {
    patron: /^(?:resumen|pipeline)(?: de)? crm$/,
    accion: async () => {
      const { cantidad, total } = await consultasModulos.obtenerPipelineCRM();
      return `Pipeline CRM: ${cantidad} oportunidades abiertas, valor esperado total ${total.toLocaleString('es-CL', { maximumFractionDigits: 2 })}.`;
    },
  },
  {
    patron: /^top oportunidades$/,
    accion: async () => {
      const oportunidades = await consultasModulos.obtenerTopOportunidades();
      if (!oportunidades.length) return 'No hay oportunidades abiertas.';
      return oportunidades
        .map((o, i) => `${i + 1}. ${o.nombre} — ${o.cliente} (${o.etapa}): ${o.monto.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`)
        .join('\n');
    },
  },
  {
    patron: /^oportunidades por etapa$/,
    accion: async () => formatearEntradas(await consultasModulos.obtenerOportunidadesPorEtapa()),
  },
  {
    patron: /^oportunidades por vendedor$/,
    accion: async () => formatearEntradas(await consultasModulos.obtenerOportunidadesPorVendedor()),
  },
  // --- Financiero / Facturación ---
  {
    patron: /^facturas pendientes$/,
    accion: async () => {
      const { cantidad, total } = await consultasModulos.obtenerFacturasPendientes();
      if (!cantidad) return 'No hay facturas de venta pendientes de cobro.';
      return `Facturas pendientes de cobro: ${cantidad}, monto adeudado total ${total.toLocaleString('es-CL', { maximumFractionDigits: 2 })}.`;
    },
  },
  {
    patron: /^top clientes facturacion$/,
    accion: async () => formatearEntradas(await consultasModulos.obtenerTopClientesFacturacion()),
  },
  {
    patron: /^facturas por estado$/,
    accion: async () => formatearEntradas(await consultasModulos.obtenerFacturasPorEstado()),
  },
  // --- Inventario ---
  {
    patron: /^top productos en stock$/,
    accion: async () => formatearEntradas(await consultasModulos.obtenerTopProductosStock()),
  },
  {
    patron: /^stock de (.+)$/,
    accion: async ([, nombreProducto]) => {
      const resultados = await consultasModulos.obtenerStockDeProducto(nombreProducto);
      if (!resultados.length) return `No encontré productos que coincidan con "${nombreProducto}".`;
      return resultados
        .map((r) => `- ${r.producto}: ${r.cantidad.toLocaleString('es-CL', { maximumFractionDigits: 2 })} unidades`)
        .join('\n');
    },
  },
  {
    patron: /^productos sin stock$/,
    accion: async () => {
      const productos = await consultasModulos.obtenerProductosSinStock();
      if (!productos.length) return 'No hay productos en quiebre de stock en ubicaciones internas.';
      return productos.map((p) => `- ${p}`).join('\n');
    },
  },
  // --- Producción ---
  {
    patron: /^resumen produccion$/,
    accion: async () => {
      const { cantidad, pendientes } = await consultasModulos.obtenerResumenProduccion();
      return `Producción: ${cantidad} órdenes totales, ${pendientes} pendientes (borrador/confirmadas/en curso).`;
    },
  },
  {
    patron: /^produccion por estado$/,
    accion: async () => formatearEntradas(await consultasModulos.obtenerProduccionPorEstado()),
  },
  {
    patron: /^top productos producidos$/,
    accion: async () => formatearEntradas(await consultasModulos.obtenerTopProductosProducidos()),
  },
  // --- Capa semántica: el chat "lee" conceptos, "sugiere" y "crea" tableros ---
  {
    patron: /^conceptos$/,
    accion: async () =>
      semantica
        .listarModulos()
        .map((m) => `${semantica.ETIQUETA_MODULO[m] || m}:\n${semantica.conceptosDeModulo(m).map(formatearConcepto).join('\n')}`)
        .join('\n\n'),
  },
  {
    patron: /^conceptos de (\w+)$/,
    accion: async ([, moduloBruto]) => {
      const modulo = moduloBruto.toLowerCase();
      const items = semantica.conceptosDeModulo(modulo);
      if (!items.length) {
        return `No hay conceptos para el módulo "${modulo}". Módulos disponibles: ${semantica.listarModulos().join(', ')}.`;
      }
      return `${semantica.ETIQUETA_MODULO[modulo] || modulo}:\n${items.map(formatearConcepto).join('\n')}`;
    },
  },
  {
    patron: /^validar conceptos$/,
    accion: async () => {
      const { valido, errores } = await semantica.validarConceptos();
      return valido
        ? 'La capa semántica es válida: todos los conceptos apuntan a modelos/campos que existen en Odoo.'
        : `La capa semántica tiene errores:\n${errores.join('\n')}`;
    },
  },
  {
    // El chat como intérprete: resuelve dos conceptos contra la capa
    // semántica y consulta Odoo en el momento (read_group, igual que "top
    // clientes"/"pipeline crm") para mostrar el resultado real — no crea
    // ni guarda ningún tablero, es solo lectura.
    patron: /^consultar (\w+) por (\w+)$/,
    accion: async ([, medidaBruta, dimensionBruta]) => {
      const nombreMedida = medidaBruta.toLowerCase();
      const nombreDimension = dimensionBruta.toLowerCase();
      const medida = semantica.resolverConcepto(nombreMedida);
      const dimension = semantica.resolverConcepto(nombreDimension);
      if (!medida || !dimension) {
        const pistas = [];
        if (!medida) {
          const parecido = semantica.sugerirConceptoParecido(nombreMedida);
          pistas.push(`"${nombreMedida}" no existe` + (parecido ? ` — ¿quisiste decir "${parecido}"?` : ''));
        }
        if (!dimension) {
          const parecido = semantica.sugerirConceptoParecido(nombreDimension);
          pistas.push(`"${nombreDimension}" no existe` + (parecido ? ` — ¿quisiste decir "${parecido}"?` : ''));
        }
        return `${pistas.join('\n')}\nUsa "conceptos" para ver los disponibles.`;
      }
      if (medida.tipo !== 'medida') return `"${nombreMedida}" es una dimensión, no una medida. Usa: consultar <medida> por <dimension>.`;
      if (dimension.tipo !== 'dimension') return `"${nombreDimension}" es una medida, no una dimensión. Usa: consultar <medida> por <dimension>.`;
      if (medida.modelo !== dimension.modelo) {
        return `"${nombreMedida}" (${medida.modelo}) y "${nombreDimension}" (${dimension.modelo}) son de modelos distintos; no se pueden consultar juntos.`;
      }

      let grupos;
      try {
        grupos = await odooClient.executeKw(medida.modelo, 'read_group', [medida.dominio || [], [medida.campo], [dimension.campo]], {
          orderby: `${medida.campo} desc`,
          limit: 20,
        });
      } catch (err) {
        return `No se pudo consultar "${medida.modelo}" en Odoo: ${err.message || err}`;
      }

      const { entradas } = agrupadoAEntradas(grupos, dimension.campo, medida.campo, 15);
      if (!entradas.length) return `Sin datos para "${medida.etiqueta}" por "${dimension.etiqueta}".`;
      return `${medida.etiqueta} por ${dimension.etiqueta} (datos en vivo de Odoo):\n${formatearListaEntradas(entradas)}`;
    },
  },
  {
    patron: /^sugerir tablero de (\w+)(?: con ([\w, ]+))?$/,
    accion: async ([, moduloBruto, listaTexto]) => {
      const modulo = moduloBruto.toLowerCase();
      if (!semantica.listarModulos().includes(modulo)) {
        return `No conozco el módulo "${modulo}". Módulos disponibles: ${semantica.listarModulos().join(', ')}.`;
      }
      const nombresConceptos = resolverListaConceptos(modulo, listaTexto);
      if (!nombresConceptos) {
        return `El módulo "${modulo}" no tiene suficientes conceptos (necesita al menos una dimensión y una medida) ` +
          `para sugerir un tablero automáticamente. Usa "conceptos de ${modulo}" para elegir manualmente.`;
      }
      const resultado = semantica.construirDefinicionDesdeConceptos('<id>', modulo, nombresConceptos);
      if (resultado.error) return resultado.error;
      return `Sugerencia para "${modulo}" (conceptos: ${nombresConceptos.join(', ')}):\n\n${yaml.dump(resultado.def)}\n` +
        `Para crearlo: crear tablero <id> de ${modulo}${listaTexto ? ` con ${nombresConceptos.join(',')}` : ''}`;
    },
  },
  {
    patron: /^crear tablero ([\w-]+) de (\w+)(?: con ([\w, ]+))?$/,
    accion: async ([, idBruto, moduloBruto, listaTexto], { tableroModificado }) => {
      const id = idBruto.toLowerCase();
      const modulo = moduloBruto.toLowerCase();
      if (TABLEROS_ESPECIALES.has(id)) return mensajeTableroEspecial(id, 'crear/reemplazar');
      if (!semantica.listarModulos().includes(modulo)) {
        return `No conozco el módulo "${modulo}". Módulos disponibles: ${semantica.listarModulos().join(', ')}.`;
      }
      const nombresConceptos = resolverListaConceptos(modulo, listaTexto);
      if (!nombresConceptos) {
        return `El módulo "${modulo}" no tiene suficientes conceptos para crear un tablero automáticamente. ` +
          `Usa: crear tablero ${id} de ${modulo} con <concepto1>,<concepto2> (ver "conceptos de ${modulo}").`;
      }
      const resultado = semantica.construirDefinicionDesdeConceptos(id, modulo, nombresConceptos);
      if (resultado.error) return resultado.error;
      const guardado = await guardarSiValido(id, resultado.def);
      if (guardado.ok) tableroModificado.id = id;
      return guardado.ok
        ? `Tablero "${id}" creado a partir de la capa semántica (${nombresConceptos.join(', ')}). Versión ${guardado.numeroVersion} guardada.`
        : guardado.mensaje;
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
      return resultado.ok ? `Tablero "${id}" creado. Versión ${resultado.numeroVersion} guardada.` : resultado.mensaje;
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
      return resultado.ok ? `Campo "${campo}" agregado a "${id}". Versión ${resultado.numeroVersion} guardada.` : resultado.mensaje;
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
      return resultado.ok ? `Campo "${campo}" quitado de "${id}". Versión ${resultado.numeroVersion} guardada.` : resultado.mensaje;
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
      return resultado.ok ? `Gráfico agregado a "${id}". Versión ${resultado.numeroVersion} guardada.` : resultado.mensaje;
    },
  },
  {
    patron: /^cambiar tipo de grafico a (barra|linea|torta) en ([\w-]+)$/,
    accion: async ([, tipoBruto, idBruto], { tableroModificado }) => {
      const tipo = tipoBruto.toLowerCase();
      const id = idBruto.toLowerCase();
      if (TABLEROS_ESPECIALES.has(id)) return mensajeTableroEspecial(id, 'editar');
      const def = cargarTablero(id);
      if (!def) return `No existe el tablero "${id}".`;
      if (!def.grafico) {
        return `El tablero "${id}" no tiene un bloque "grafico" para cambiarle el tipo. Usa "agregar grafico a ${id}: agrupar por <campo> midiendo <campo>" primero.`;
      }
      def.grafico.tipo_grafico = tipo;
      const resultado = await guardarSiValido(id, def);
      if (resultado.ok) tableroModificado.id = id;
      return resultado.ok ? `Tipo de gráfico de "${id}" cambiado a "${tipo}". Versión ${resultado.numeroVersion} guardada.` : resultado.mensaje;
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
  // --- Versionador: cada guardarSiValido() de arriba ya deja una versión
  // nueva en tableros/.versiones/<id>.yaml; estos comandos leen y recuperan
  // ese historial. ---
  {
    patron: /^versiones(?: de)? ([\w-]+)$/,
    accion: async ([, idBruto]) => {
      const id = idBruto.toLowerCase();
      const lista = versiones.listarVersiones(id);
      if (!lista.length) return `"${id}" todavía no tiene versiones guardadas. Se crea una cada vez que el chat guarda un cambio en el tablero.`;
      return `Versiones de "${id}" (de más antigua a más nueva):\n` +
        lista.map((v, i) => `${i + 1}. ${new Date(v.fecha).toLocaleString('es-CL')} — ${v.descripcion}`).join('\n') +
        `\n\nUsa "ver version <n> de ${id}" o "restaurar version <n> de ${id}".`;
    },
  },
  {
    patron: /^ver version (\d+) de ([\w-]+)$/,
    accion: async ([, numeroTexto, idBruto]) => {
      const id = idBruto.toLowerCase();
      const numero = Number(numeroTexto);
      const version = versiones.obtenerVersion(id, numero);
      if (!version) return `No existe la versión ${numero} de "${id}". Usa "versiones de ${id}" para ver cuántas hay.`;
      return `Versión ${numero} de "${id}" (${new Date(version.fecha).toLocaleString('es-CL')} — ${version.descripcion}):\n\n${yaml.dump(version.definicion)}`;
    },
  },
  {
    patron: /^restaurar version (\d+) de ([\w-]+)$/,
    accion: async ([, numeroTexto, idBruto], { tableroModificado }) => {
      const id = idBruto.toLowerCase();
      if (TABLEROS_ESPECIALES.has(id)) return mensajeTableroEspecial(id, 'restaurar');
      const numero = Number(numeroTexto);
      const version = versiones.obtenerVersion(id, numero);
      if (!version) return `No existe la versión ${numero} de "${id}". Usa "versiones de ${id}" para ver cuántas hay.`;
      const resultado = await guardarSiValido(id, version.definicion, `Restaurado a la versión ${numero}`);
      if (resultado.ok) tableroModificado.id = id;
      return resultado.ok
        ? `Tablero "${id}" restaurado a la versión ${numero} (esto quedó guardado como la versión ${resultado.numeroVersion}).`
        : resultado.mensaje;
    },
  },
  {
    patron: /^eliminar versiones(?: de)? ([\w-]+)$/,
    accion: async ([, idBruto]) => {
      const id = idBruto.toLowerCase();
      versiones.eliminarVersiones(id);
      return `Se eliminaron todas las versiones guardadas de "${id}". El tablero actual no cambió; el próximo cambio empieza el historial de nuevo desde la versión 1.`;
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
