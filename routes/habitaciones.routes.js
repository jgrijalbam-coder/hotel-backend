const express = require('express');
const router = express.Router();
const {
  listarHabitaciones,
  obtenerHabitacionPorId,
  listarHabitacionesDisponibles,
  buscarHabitaciones,
  actualizarEstadoHabitacion
} = require('../controllers/habitaciones.controller');
const { requireAuth, requireRoles } = require('../middlewares/auth.middleware');

router.get('/', listarHabitaciones);
router.get('/disponibles', listarHabitacionesDisponibles);
router.get('/buscar/filtros', buscarHabitaciones);
router.patch('/:id/estado', requireAuth, requireRoles(1, 2), actualizarEstadoHabitacion);
router.get('/:id', obtenerHabitacionPorId);

module.exports = router;
