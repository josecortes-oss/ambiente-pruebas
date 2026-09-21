const express = require('express');
const { requireAuth } = require('./auth');
const { esAdministrador, datosTopbar } = require('../topbar');
const semantica = require('../semantica');

const router = express.Router();

async function requireAdmin(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  const esAdmin = await esAdministrador(req.session.usuario.uid);
  if (!esAdmin) {
    return res.status(403).render('error', {
      mensaje: 'Esta sección es solo para administradores de Odoo (grupo base.group_system).',
    });
  }
  next();
}

function agruparConceptos() {
  const modulos = semantica.listarModulos();
  const conceptosPorModulo = {};
  for (const m of modulos) conceptosPorModulo[m] = semantica.conceptosDeModulo(m);
  return { modulos, conceptosPorModulo };
}

async function renderPagina(req, res, { mensaje = null, error = null, edicionNombre = null, estado = 500 } = {}) {
  const topbar = await datosTopbar(req.session.usuario, null);
  const { modulos, conceptosPorModulo } = agruparConceptos();
  const edicion = edicionNombre ? semantica.resolverConcepto(edicionNombre) : null;
  res.status(error ? estado : 200).render('semantica', {
    ...topbar,
    modulos,
    conceptosPorModulo,
    etiquetaModulo: semantica.ETIQUETA_MODULO,
    edicion,
    mensaje,
    error,
  });
}

router.get('/semantica', requireAuth, requireAdmin, async (req, res) => {
  await renderPagina(req, res, { edicionNombre: req.query.editar || null });
});

router.post('/semantica', requireAuth, requireAdmin, async (req, res) => {
  const { nombre, nombre_original: nombreOriginal, modulo, modelo, campo, tipo, agregacion, etiqueta, descripcion, dominio } = req.body;
  const idFinal = (nombreOriginal || nombre || '').trim().toLowerCase();

  if (!idFinal || !/^[a-z0-9_]+$/.test(idFinal)) {
    return renderPagina(req, res, {
      error: 'El nombre del concepto es obligatorio y solo puede tener minúsculas, números y guion bajo.',
      edicionNombre: nombreOriginal || null,
      estado: 400,
    });
  }
  if (!nombreOriginal && semantica.resolverConcepto(idFinal)) {
    return renderPagina(req, res, { error: `Ya existe un concepto llamado "${idFinal}".`, estado: 400 });
  }

  let dominioParsed;
  if (dominio && dominio.trim()) {
    try {
      dominioParsed = JSON.parse(dominio);
      if (!Array.isArray(dominioParsed)) throw new Error('debe ser una lista, ej. [["campo","=","valor"]]');
    } catch (err) {
      return renderPagina(req, res, {
        error: `El "dominio" no es JSON válido: ${err.message}`,
        edicionNombre: nombreOriginal || null,
        estado: 400,
      });
    }
  }

  const def = {
    modulo: (modulo || '').trim(),
    modelo: (modelo || '').trim(),
    campo: (campo || '').trim(),
    tipo,
    etiqueta: (etiqueta || '').trim(),
  };
  if (descripcion && descripcion.trim()) def.descripcion = descripcion.trim();
  if (tipo === 'medida' && agregacion && agregacion.trim()) def.agregacion = agregacion.trim();
  if (dominioParsed && dominioParsed.length) def.dominio = dominioParsed;

  const resultado = await semantica.guardarConcepto(idFinal, def);
  if (!resultado.ok) {
    return renderPagina(req, res, {
      error: `No se pudo guardar "${idFinal}":\n${resultado.errores.join('\n')}`,
      edicionNombre: nombreOriginal || null,
      estado: 422,
    });
  }
  return renderPagina(req, res, { mensaje: `Concepto "${idFinal}" guardado.` });
});

router.post('/semantica/:nombre/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const resultado = semantica.eliminarConcepto(req.params.nombre);
  return renderPagina(req, res, resultado.ok
    ? { mensaje: `Concepto "${req.params.nombre}" eliminado.` }
    : { error: resultado.mensaje, estado: 404 });
});

module.exports = router;
