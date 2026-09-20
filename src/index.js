require('dotenv').config({ path: `${__dirname}/../ambiente-pruebas.env` });
const { crearApp } = require('./app');

const PORT = process.env.PORT || 3000;

crearApp().listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
