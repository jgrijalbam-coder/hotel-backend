const express = require('express');
const router = express.Router();
const {
  crearReserva,
  listarReservas,
  listarMisReservas,
  listarReservasPorUsuario,
  obtenerReservaPorId,
  actualizarReserva,
  cancelarReserva,
  actualizarEstadoReserva
} = require('../controllers/reservas.controller');
const { requireAuth, requireRoles } = require('../middlewares/auth.middleware');

router.post('/', requireAuth, crearReserva);
router.get('/mis-reservas', requireAuth, listarMisReservas);
router.get('/', requireAuth, requireRoles(1, 2), listarReservas);
router.get('/usuario/:id_usuario', requireAuth, listarReservasPorUsuario);
router.get('/:id', requireAuth, obtenerReservaPorId);
router.put('/:id', requireAuth, actualizarReserva);
router.patch('/:id/estado', requireAuth, requireRoles(1, 2), actualizarEstadoReserva);
router.delete('/:id/cancelar', requireAuth, cancelarReserva);
router.delete('/:id', requireAuth, cancelarReserva);

module.exports = router;
