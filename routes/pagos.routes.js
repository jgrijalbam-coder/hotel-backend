const express = require('express');
const router = express.Router();
const {
  obtenerPagoPorReserva,
  registrarPagoReserva
} = require('../controllers/pagos.controller');
const { requireAuth, requireRoles } = require('../middlewares/auth.middleware');

router.get('/reserva/:id_reserva', requireAuth, obtenerPagoPorReserva);
router.post('/reserva/:id_reserva', requireAuth, requireRoles(1, 2), registrarPagoReserva);

module.exports = router;
