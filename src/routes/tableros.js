const express = require('express');
const { requireAuth } = require('./auth');
const { loadValidatedDefinitions, getValidatedDefinition } = require('../tableros');
const { executeKw } = require('../odoo-client');

const router = express.Router();

async function esAdministrador(uid) {
  try {
    return await executeKw('res.users', 'has_group', [uid, 'base.group_system']);
  } catch {
    return false;
  }
}

router.get('/tableros', requireAuth, async (req, res) => {
  const usuario = req.session.usuario;
  try {
    const definiciones = await loadValidatedDefinitions();
    const esAdmin = await esAdministrador(usuario.uid);
    const visibles = definiciones.filter((d) => d.valido);
    const invalidos = esAdmin ? definiciones.filter((d) => !d.valido) : [];
    res.render('tableros-lista', { usuario, visibles, invalidos, esAdmin });
  } catch (err) {
    res.status(500).render('error', { mensaje: `Error al cargar tableros: ${err.message || err}` });
  }
});

router.get('/tableros/:id', requireAuth, async (req, res) => {
  try {
    const def = await getValidatedDefinition(req.params.id);
    if (!def) return res.status(404).render('error', { mensaje: 'Tablero no encontrado.' });
    if (!def.valido) {
      return res.status(422).render('error', {
        mensaje: `Este tablero no pasó la evaluación semántica y no puede mostrarse:\n${def.errores.join('\n')}`,
      });
    }

    const campos = def.campos.map((c) => (typeof c === 'string' ? c : c.campo));
    const filas = await executeKw(def.modelo, 'search_read', [def.dominio || []], {
      fields: campos,
      limit: def.limite || 80,
      order: def.orden || '',
    });

    const columnas = def.campos.map((c) =>
      typeof c === 'string' ? { campo: c, etiqueta: c } : { campo: c.campo, etiqueta: c.etiqueta || c.campo }
    );

    const filasFormateadas = filas.map((fila) => {
      const formateada = {};
      for (const { campo } of columnas) {
        const valor = fila[campo];
        if (Array.isArray(valor) && valor.length === 2) {
          formateada[campo] = valor[1];
        } else if (valor === false) {
          formateada[campo] = '';
        } else {
          formateada[campo] = valor;
        }
      }
      return formateada;
    });

    res.render('tablero-detalle', { def, columnas, filas: filasFormateadas });
  } catch (err) {
    res.status(500).render('error', { mensaje: `Error al ejecutar el tablero: ${err.message || err}` });
  }
});

module.exports = router;
