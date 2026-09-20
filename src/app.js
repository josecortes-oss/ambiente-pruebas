const path = require('path');
const express = require('express');
const session = require('express-session');
const { router: authRouter } = require('./routes/auth');
const tablerosRouter = require('./routes/tableros');
const chatRouter = require('./routes/chat');

function crearApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true },
    })
  );

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/', (req, res) => {
    res.redirect('/tableros');
  });

  app.use(authRouter);
  app.use(tablerosRouter);
  app.use(chatRouter);

  return app;
}

module.exports = { crearApp };
