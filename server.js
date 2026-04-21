const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const pool = require('./config/db');

const usuariosRoutes = require('./routes/usuarios.routes');
const habitacionesRoutes = require('./routes/habitaciones.routes');
const reservasRoutes = require('./routes/reservas.routes');
const pagosRoutes = require('./routes/pagos.routes');
const notificacionesRoutes = require('./routes/notificaciones.routes');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ mensaje: 'API Hotel Boutique funcionando correctamente' });
});

app.get('/test-db', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS conexion');
    res.json({
      mensaje: 'Conexion a MySQL exitosa',
      resultado: rows
    });
  } catch (error) {
    console.error('Error en /test-db:', error);
    res.status(500).json({
      mensaje: 'Error al conectar con la base de datos',
      error: error.message
    });
  }
});

app.use('/api/usuarios', usuariosRoutes);
app.use('/api/habitaciones', habitacionesRoutes);
app.use('/api/reservas', reservasRoutes);
app.use('/api/pagos', pagosRoutes);
app.use('/api/notificaciones', notificacionesRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
