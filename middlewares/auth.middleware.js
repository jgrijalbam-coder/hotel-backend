const { verifyToken } = require('../utils/auth');

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ mensaje: 'Debes iniciar sesion para continuar' });
  }

  try {
    req.user = verifyToken(authHeader.slice(7));
    next();
  } catch (error) {
    return res.status(401).json({ mensaje: 'Tu sesion no es valida o ha expirado' });
  }
};

const requireRoles = (...rolesPermitidos) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ mensaje: 'Debes iniciar sesion para continuar' });
  }

  if (!rolesPermitidos.includes(req.user.id_rol)) {
    return res.status(403).json({ mensaje: 'No tienes permisos para esta accion' });
  }

  next();
};

module.exports = {
  requireAuth,
  requireRoles
};
