const express = require('express');
const { requireAuth } = require('./auth');
const { responderChat } = require('../chat');

const router = express.Router();

router.post('/chat', requireAuth, async (req, res) => {
  const mensaje = (req.body.mensaje || '').trim();
  if (!mensaje) return res.status(400).json({ error: 'Mensaje vacío.' });

  req.session.chat = req.session.chat || [];
  req.session.chat.push({ role: 'user', content: mensaje });

  try {
    const { respuesta, historial, tableroModificado } = await responderChat(req.session.chat);
    req.session.chat = historial;
    res.json({ respuesta, tableroModificado });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.post('/chat/reiniciar', requireAuth, (req, res) => {
  req.session.chat = [];
  res.json({ ok: true });
});

module.exports = router;
