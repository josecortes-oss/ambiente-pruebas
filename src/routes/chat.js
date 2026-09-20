const express = require('express');
const { requireAuth } = require('./auth');
const { responderChat } = require('../chat');

const router = express.Router();

router.post('/chat', requireAuth, async (req, res) => {
  const mensaje = (req.body.mensaje || '').trim();
  if (!mensaje) return res.status(400).json({ error: 'Mensaje vacío.' });

  try {
    const { respuesta, tableroModificado } = await responderChat(mensaje);
    res.json({ respuesta, tableroModificado });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;
