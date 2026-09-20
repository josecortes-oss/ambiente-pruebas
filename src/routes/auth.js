const express = require('express');
const { authenticate, ODOO_DB } = require('../odoo-client');

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { db: ODOO_DB, error: null });
});

router.post('/login', async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.render('login', { db: ODOO_DB, error: 'Ingresa usuario y contraseña.' });
  }
  try {
    // Valida la identidad del usuario con su propia contraseña de Odoo.
    // La API key de ambiente-pruebas.env NO se usa aquí: es el método de
    // conexión a la base de datos para las consultas (ver odoo-client.js).
    const uid = await authenticate(login, password);
    if (!uid) {
      return res.render('login', { db: ODOO_DB, error: 'Usuario o contraseña inválidos.' });
    }
    req.session.usuario = { uid, login };
    res.redirect('/tableros');
  } catch (err) {
    res.render('login', { db: ODOO_DB, error: `Error al conectar con Odoo: ${err.message || err}` });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

function requireAuth(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  next();
}

module.exports = { router, requireAuth };
