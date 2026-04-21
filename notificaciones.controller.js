const pool = require('../config/db');

const listarMisNotificaciones = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id_notificacion, id_usuario, mensaje, tipo, estado, fecha
       FROM notificaciones
       WHERE id_usuario = ?
       ORDER BY fecha DESC, id_notificacion DESC`,
      [req.user.id_usuario]
    );

    res.json(rows);
  } catch (error) {
    console.error('Error al listar notificaciones:', error);
    res.status(500).json({ mensaje: 'Error al listar notificaciones' });
  }
};

const marcarNotificacionLeida = async (req, res) => {
  try {
    const { id } = req.params;

    const [notificaciones] = await pool.query(
      `SELECT id_notificacion, id_usuario
       FROM notificaciones
       WHERE id_notificacion = ?`,
      [id]
    );

    if (!notificaciones.length) {
      return res.status(404).json({ mensaje: 'Notificacion no encontrada' });
    }

    if (Number(notificaciones[0].id_usuario) !== Number(req.user.id_usuario)) {
      return res.status(403).json({ mensaje: 'No puedes modificar esta notificacion' });
    }

    await pool.query(
      `UPDATE notificaciones
       SET estado = 'leido'
       WHERE id_notificacion = ?`,
      [id]
    );

    res.json({ mensaje: 'Notificacion marcada como leida' });
  } catch (error) {
    console.error('Error al marcar notificacion:', error);
    res.status(500).json({ mensaje: 'Error al actualizar la notificacion' });
  }
};

const marcarTodasLeidas = async (req, res) => {
  try {
    await pool.query(
      `UPDATE notificaciones
       SET estado = 'leido'
       WHERE id_usuario = ?
         AND estado <> 'leido'`,
      [req.user.id_usuario]
    );

    res.json({ mensaje: 'Todas las notificaciones fueron marcadas como leidas' });
  } catch (error) {
    console.error('Error al marcar todas las notificaciones:', error);
    res.status(500).json({ mensaje: 'Error al actualizar las notificaciones' });
  }
};

module.exports = {
  listarMisNotificaciones,
  marcarNotificacionLeida,
  marcarTodasLeidas
};
