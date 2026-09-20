const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Anthropic = require('@anthropic-ai/sdk');
const { executeKw } = require('./odoo-client');
const { loadValidatedDefinitions, validateDefinition } = require('./tableros');

const TABLEROS_DIR = path.join(__dirname, '..', 'tableros');
const MODEL = 'claude-opus-5';

let clientePromesa = null;
function obtenerCliente() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Falta ANTHROPIC_API_KEY en ambiente-pruebas.env para usar el chat.');
  }
  if (!clientePromesa) clientePromesa = new Anthropic();
  return clientePromesa;
}

const TOOLS = [
  {
    name: 'listar_tableros',
    description:
      'Lista los tableros actualmente definidos (id, título, modelo(s), tipo, campos y gráfico si tienen). ' +
      'Úsalo primero para saber qué existe antes de proponer un cambio.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'obtener_esquema',
    description:
      'Devuelve los campos reales de un modelo de Odoo (nombre técnico, etiqueta y tipo), consultando la ' +
      'conexión de servicio. Úsalo para verificar que un campo existe antes de usarlo en un tablero o consulta ' +
      '(esta es la información semántica contra la que se valida todo).',
    input_schema: {
      type: 'object',
      properties: { modelo: { type: 'string', description: 'Nombre técnico del modelo, ej. sale.order' } },
      required: ['modelo'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_datos',
    description:
      'Ejecuta una consulta de solo lectura contra Odoo (vía la conexión de servicio) para responder preguntas ' +
      'sobre los datos. Sin agrupar_por/medir hace un search_read normal; con ambos hace una agregación ' +
      '(read_group) sumando "medir" agrupado por "agrupar_por".',
    input_schema: {
      type: 'object',
      properties: {
        modelo: { type: 'string' },
        dominio: { type: 'array', items: {}, description: 'Dominio Odoo, ej. [["state","=","sale"]]. [] si no aplica.' },
        campos: { type: 'array', items: { type: 'string' } },
        agrupar_por: { type: 'string' },
        medir: { type: 'string' },
        limite: { type: 'integer' },
      },
      required: ['modelo', 'dominio', 'campos'],
      additionalProperties: false,
    },
  },
  {
    name: 'guardar_tablero',
    description:
      'Crea o reemplaza un tablero genérico escribiendo tableros/<id>.yaml, con las claves modelo/campos/' +
      'dominio/orden/limite/grafico/titulo/modulo/posicion (mismo formato que los tableros ya definidos). ' +
      'El contenido pasa por la misma evaluación semántica que usa la app (existencia real de modelo y campos ' +
      'en Odoo) ANTES de guardarse; si falla, no se escribe nada y se devuelven los errores para corregir. ' +
      'No uses esta herramienta para el tablero "ventas" (tipo ventas_mensual): tiene lógica propia en código ' +
      'y reemplazar su YAML por uno genérico lo rompería.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id del tablero = nombre de archivo sin extensión, ej. "compras"' },
        yaml_texto: { type: 'string', description: 'Contenido YAML completo del tablero' },
      },
      required: ['id', 'yaml_texto'],
      additionalProperties: false,
    },
  },
];

async function ejecutarHerramienta(nombre, input) {
  switch (nombre) {
    case 'listar_tableros': {
      const definiciones = await loadValidatedDefinitions();
      return definiciones.map((d) => ({
        id: d._id,
        titulo: d.titulo,
        tipo: d.tipo || 'generico',
        modelo: d.modelo,
        campos: d.campos,
        grafico: d.grafico,
        valido: d.valido,
        errores: d.errores,
      }));
    }
    case 'obtener_esquema': {
      const fieldsGet = await executeKw(input.modelo, 'fields_get', [], { attributes: ['string', 'type'] });
      return Object.entries(fieldsGet).map(([campo, info]) => ({
        campo,
        etiqueta: info.string,
        tipo: info.type,
      }));
    }
    case 'consultar_datos': {
      if (input.agrupar_por && input.medir) {
        return executeKw(input.modelo, 'read_group', [input.dominio, [input.medir], [input.agrupar_por]], {
          orderby: `${input.medir} desc`,
          limit: input.limite || 20,
        });
      }
      return executeKw(input.modelo, 'search_read', [input.dominio], {
        fields: input.campos,
        limit: input.limite || 50,
      });
    }
    case 'guardar_tablero': {
      if (input.id === 'ventas') {
        return { guardado: false, errores: ['El tablero "ventas" es de tipo especial; no se puede sobrescribir así.'] };
      }
      let def;
      try {
        def = yaml.load(input.yaml_texto);
        def._id = input.id;
      } catch (err) {
        return { guardado: false, errores: [`YAML inválido: ${err.message}`] };
      }
      const validacion = await validateDefinition(def);
      if (!validacion.valido) {
        return { guardado: false, errores: validacion.errores };
      }
      fs.writeFileSync(path.join(TABLEROS_DIR, `${input.id}.yaml`), input.yaml_texto, 'utf8');
      return { guardado: true, id: input.id };
    }
    default:
      throw new Error(`Herramienta desconocida: ${nombre}`);
  }
}

const SYSTEM_PROMPT = `Eres el asistente del panel de tableros Odoo de este equipo. Ayudas de dos formas:

1. Responder preguntas sobre los datos de ventas/compras (usa consultar_datos; agrupa con agrupar_por+medir
   cuando pidan un top o un total por categoría).
2. Proponer y aplicar cambios a los tableros definidos como archivos YAML (usa guardar_tablero).

Reglas importantes:
- Nunca inventes nombres de campo o de modelo: antes de usarlos en consultar_datos o guardar_tablero, verifica
  con obtener_esquema que existen de verdad en Odoo. Esa es la única fuente de verdad semántica.
- Usa listar_tableros para ver qué hay antes de crear o modificar algo, y para no duplicar tableros.
- guardar_tablero ya valida contra Odoo antes de escribir el archivo; si devuelve errores, corrige el YAML y
  vuelve a intentar en el mismo turno, no le pidas al usuario que lo arregle él.
- El tablero "ventas" es de tipo especial (ventas_mensual, con filtros y gráficos definidos en código); no lo
  reescribas con guardar_tablero.
- Sé breve y concreto en tus respuestas finales; si aplicaste un cambio, dilo en una frase y nombra el archivo.`;

async function responderChat(mensajes) {
  const client = obtenerCliente();
  const historial = [...mensajes];
  let tableroModificado = null;

  for (let iteracion = 0; iteracion < 8; iteracion++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: historial,
    });

    historial.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const texto = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return { respuesta: texto || '(sin respuesta)', historial, tableroModificado };
    }

    const bloquesHerramienta = response.content.filter((b) => b.type === 'tool_use');
    const resultados = [];
    for (const bloque of bloquesHerramienta) {
      try {
        const resultado = await ejecutarHerramienta(bloque.name, bloque.input);
        if (bloque.name === 'guardar_tablero' && resultado.guardado) tableroModificado = resultado.id;
        resultados.push({ type: 'tool_result', tool_use_id: bloque.id, content: JSON.stringify(resultado) });
      } catch (err) {
        resultados.push({
          type: 'tool_result',
          tool_use_id: bloque.id,
          is_error: true,
          content: err.message || String(err),
        });
      }
    }
    historial.push({ role: 'user', content: resultados });
  }

  return { respuesta: 'No pude completar la solicitud en el número de pasos permitido.', historial, tableroModificado };
}

module.exports = { responderChat };
