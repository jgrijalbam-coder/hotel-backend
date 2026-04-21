const pool = require('../config/db');
const ESTADOS_RESERVA_ACTIVOS_SQL = `'reservada', 'pendiente', 'confirmada'`;
const VISTA_POR_PISO_SQL = `
  CASE
    WHEN h.piso = 1 THEN 'jardin'
    WHEN h.piso IN (2, 3) THEN 'ciudad'
    WHEN h.piso >= 4 THEN 'mar'
    ELSE 'ciudad'
  END
`;

const listarHabitaciones = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT h.id_habitacion, h.numero, h.piso, h.estado, ${VISTA_POR_PISO_SQL} AS vista,
             t.id_tipo, t.nombre AS tipo_habitacion, t.descripcion,
             t.capacidad, t.precio_base,
             (
               SELECT r.id_reserva
               FROM reservas r
               INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
               WHERE d.id_habitacion = h.id_habitacion
                 AND r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
               ORDER BY r.fecha_inicio ASC
               LIMIT 1
             ) AS reserva_activa_id,
             (
               SELECT r.estado
               FROM reservas r
               INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
               WHERE d.id_habitacion = h.id_habitacion
                 AND r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
               ORDER BY r.fecha_inicio ASC
               LIMIT 1
             ) AS reserva_activa_estado,
             (
               SELECT r.fecha_inicio
               FROM reservas r
               INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
               WHERE d.id_habitacion = h.id_habitacion
                 AND r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
               ORDER BY r.fecha_inicio ASC
               LIMIT 1
             ) AS reserva_activa_inicio,
             (
               SELECT r.fecha_fin
               FROM reservas r
               INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
               WHERE d.id_habitacion = h.id_habitacion
                 AND r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
               ORDER BY r.fecha_inicio ASC
               LIMIT 1
             ) AS reserva_activa_fin
      FROM habitaciones h
      INNER JOIN tipos_habitacion t ON h.id_tipo = t.id_tipo
      ORDER BY h.numero ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error('Error al listar habitaciones:', error);
    res.status(500).json({ mensaje: 'Error al listar habitaciones' });
  }
};

const obtenerHabitacionPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT h.id_habitacion, h.numero, h.piso, h.estado, ${VISTA_POR_PISO_SQL} AS vista,
              t.id_tipo, t.nombre AS tipo_habitacion, t.descripcion,
              t.capacidad, t.precio_base,
              (
                SELECT r.id_reserva
                FROM reservas r
                INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
                WHERE d.id_habitacion = h.id_habitacion
                  AND r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
                ORDER BY r.fecha_inicio ASC
                LIMIT 1
              ) AS reserva_activa_id,
              (
                SELECT r.estado
                FROM reservas r
                INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
                WHERE d.id_habitacion = h.id_habitacion
                  AND r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
                ORDER BY r.fecha_inicio ASC
                LIMIT 1
              ) AS reserva_activa_estado,
              (
                SELECT r.fecha_inicio
                FROM reservas r
                INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
                WHERE d.id_habitacion = h.id_habitacion
                  AND r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
                ORDER BY r.fecha_inicio ASC
                LIMIT 1
              ) AS reserva_activa_inicio,
              (
                SELECT r.fecha_fin
                FROM reservas r
                INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
                WHERE d.id_habitacion = h.id_habitacion
                  AND r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
                ORDER BY r.fecha_inicio ASC
                LIMIT 1
              ) AS reserva_activa_fin
       FROM habitaciones h
       INNER JOIN tipos_habitacion t ON h.id_tipo = t.id_tipo
       WHERE h.id_habitacion = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ mensaje: 'Habitacion no encontrada' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error al obtener habitacion:', error);
    res.status(500).json({ mensaje: 'Error al obtener la habitacion' });
  }
};

const listarHabitacionesDisponibles = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT h.id_habitacion, h.numero, h.piso, h.estado, ${VISTA_POR_PISO_SQL} AS vista,
             t.id_tipo, t.nombre AS tipo_habitacion, t.descripcion,
             t.capacidad, t.precio_base
      FROM habitaciones h
      INNER JOIN tipos_habitacion t ON h.id_tipo = t.id_tipo
      WHERE h.estado = 'disponible'
      ORDER BY h.numero ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error('Error al listar habitaciones disponibles:', error);
    res.status(500).json({ mensaje: 'Error al listar habitaciones disponibles' });
  }
};

const buscarHabitaciones = async (req, res) => {
  try {
    const { tipo, vista, piso, huespedes, fecha_inicio, fecha_fin } = req.query;

    let sql = `
      SELECT h.id_habitacion, h.numero, h.piso, h.estado, ${VISTA_POR_PISO_SQL} AS vista,
             t.id_tipo, t.nombre AS tipo_habitacion, t.descripcion,
             t.capacidad, t.precio_base
      FROM habitaciones h
      INNER JOIN tipos_habitacion t ON h.id_tipo = t.id_tipo
      WHERE h.estado <> 'mantenimiento'
    `;

    const params = [];

    if (tipo && tipo !== 'Cualquiera') {
      sql += ` AND LOWER(t.nombre) = LOWER(?)`;
      params.push(tipo);
    }

    if (vista && vista !== 'Cualquiera') {
      sql += ` AND LOWER(${VISTA_POR_PISO_SQL}) = LOWER(?)`;
      params.push(vista);
    }

    if (piso && piso !== 'Cualquiera') {
      if (piso === 'Piso bajo') {
        sql += ` AND h.piso = 1`;
      } else if (piso === 'Piso medio') {
        sql += ` AND h.piso IN (2, 3)`;
      } else if (piso === 'Piso alto') {
        sql += ` AND h.piso >= 4`;
      }
    }

    if (huespedes) {
      sql += ` AND t.capacidad >= ?`;
      params.push(Number(huespedes));
    }

    if (fecha_inicio && fecha_fin) {
      if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
        return res.status(400).json({ mensaje: 'La fecha_fin debe ser mayor que la fecha_inicio' });
      }

      sql += `
        AND h.id_habitacion NOT IN (
          SELECT d.id_habitacion
          FROM detalle_reserva d
          INNER JOIN reservas r ON r.id_reserva = d.id_reserva
          WHERE r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
          AND (
            ? < r.fecha_fin
            AND ? > r.fecha_inicio
          )
        )
      `;
      params.push(fecha_inicio, fecha_fin);
    }

    sql += ` ORDER BY t.precio_base ASC, h.numero ASC`;

    const [rows] = await pool.query(sql, params);

    res.json(rows);
  } catch (error) {
    console.error('Error al buscar habitaciones:', error);
    res.status(500).json({ mensaje: 'Error al buscar habitaciones' });
  }
};

const actualizarEstadoHabitacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { nuevoEstado } = req.body;

    const estadosPermitidos = ['disponible', 'mantenimiento'];
    if (!estadosPermitidos.includes(nuevoEstado)) {
      return res.status(400).json({ mensaje: 'Estado no valido para la habitacion' });
    }

    const [habitaciones] = await pool.query(
      `SELECT h.id_habitacion, h.numero, h.estado,
              (
                SELECT COUNT(*)
                FROM reservas r
                INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
                WHERE d.id_habitacion = h.id_habitacion
                  AND r.estado IN (${ESTADOS_RESERVA_ACTIVOS_SQL})
              ) AS reservas_activas
       FROM habitaciones h
       WHERE h.id_habitacion = ?`,
      [id]
    );

    if (habitaciones.length === 0) {
      return res.status(404).json({ mensaje: 'Habitacion no encontrada' });
    }

    const habitacion = habitaciones[0];

    if (nuevoEstado === 'mantenimiento' && Number(habitacion.reservas_activas) > 0) {
      return res.status(400).json({
        mensaje: 'No puedes enviar a mantenimiento una habitacion con reservas activas'
      });
    }

    if (nuevoEstado === habitacion.estado) {
      return res.json({
        mensaje: `La habitacion ${habitacion.numero} ya estaba en estado ${nuevoEstado}`
      });
    }

    await pool.query(
      'UPDATE habitaciones SET estado = ? WHERE id_habitacion = ?',
      [nuevoEstado, id]
    );

    res.json({
      mensaje: `Estado de la habitacion ${habitacion.numero} actualizado a ${nuevoEstado}`
    });
  } catch (error) {
    console.error('Error al actualizar estado de habitacion:', error);
    res.status(500).json({ mensaje: 'Error al actualizar el estado de la habitacion' });
  }
};

module.exports = {
  listarHabitaciones,
  obtenerHabitacionPorId,
  listarHabitacionesDisponibles,
  buscarHabitaciones,
  actualizarEstadoHabitacion
};
