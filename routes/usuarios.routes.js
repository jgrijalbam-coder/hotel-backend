const express = require('express');
const router = express.Router();
const {
  listarUsuarios,
  obtenerUsuarioPorId,
  obtenerMiPerfil,
  registrarUsuario,
  loginUsuario,
  actualizarUsuario,
  actualizarMiPerfil,
  actualizarEstadoAccesoUsuario
} = require('../controllers/usuarios.controller');
const { requireAuth, requireRoles } = require('../middlewares/auth.middleware');

router.post('/registro', registrarUsuario);
router.post('/login', loginUsuario);
router.get('/me', requireAuth, obtenerMiPerfil);
router.put('/me', requireAuth, actualizarMiPerfil);
router.get('/', requireAuth, requireRoles(1, 2), listarUsuarios);
router.get('/:id', requireAuth, obtenerUsuarioPorId);
router.put('/:id', requireAuth, actualizarUsuario);
router.patch('/:id/acceso', requireAuth, requireRoles(1, 2), actualizarEstadoAccesoUsuario);

module.exports = router;
