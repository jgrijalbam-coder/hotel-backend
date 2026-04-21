const express = require('express');
const router = express.Router();
const {
  listarMisNotificaciones,
  marcarNotificacionLeida,
  marcarTodasLeidas
} = require('../controllers/notificaciones.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

router.get('/', requireAuth, listarMisNotificaciones);
router.patch('/leer-todas', requireAuth, marcarTodasLeidas);
router.patch('/:id/leer', requireAuth, marcarNotificacionLeida);

module.exports = router;
