const express = require('express');
const { authenticate, ODOO_DB } = require('../odoo-client');

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { db: ODOO_DB, error: null });
});

router.post('/login', async (req, res) => {
  const { login, apiKey } = req.body;
  if (!login || !apiKey) {
    return res.render('login', { db: ODOO_DB, error: 'Ingresa usuario y API key.' });
  }
  try {
    const uid = await authenticate(login, apiKey);
    if (!uid) {
      return res.render('login', { db: ODOO_DB, error: 'Credenciales inválidas.' });
    }
    req.session.usuario = { uid, login, apiKey };
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
