const pool = require('../config/db');

const ROLE_ADMIN = 1;
const ROLE_RECEPCION = 2;

const esAdminORecepcion = (user) => user && (user.id_rol === ROLE_ADMIN || user.id_rol === ROLE_RECEPCION);
const ESTADO_RESERVADA = 'reservada';
const ESTADO_CONFIRMADA = 'confirmada';
const ESTADO_CANCELADA = 'cancelada';
const ESTADO_FINALIZADA = 'finalizada';
const ESTADOS_ACTIVOS_SQL = `'reservada', 'confirmada'`;

const crearNotificacionUsuario = async (connection, idUsuario, mensaje, tipo) => {
  await connection.query(
    `INSERT INTO notificaciones (id_usuario, mensaje, tipo, estado)
     VALUES (?, ?, ?, 'enviado')`,
    [idUsuario, mensaje, tipo]
  );
};

const crearNotificacionesInternas = async (connection, mensaje, tipo) => {
  await connection.query(
    `INSERT INTO notificaciones (id_usuario, mensaje, tipo, estado)
     SELECT id_usuario, ?, ?, 'enviado'
     FROM usuarios
     WHERE id_rol IN (1, 2)
       AND estado = 'activo'
       AND bloqueado = FALSE`,
    [mensaje, tipo]
  );
};

const sincronizarEstadoHabitacion = async (connection, idHabitacion) => {
  const [habitaciones] = await connection.query(
    'SELECT id_habitacion, estado FROM habitaciones WHERE id_habitacion = ?',
    [idHabitacion]
  );

  if (!habitaciones.length) {
    return;
  }

  const habitacion = habitaciones[0];

  const [reservasActivas] = await connection.query(
    `SELECT r.estado
     FROM reservas r
     INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
     WHERE d.id_habitacion = ?
       AND r.estado IN (${ESTADOS_ACTIVOS_SQL})`,
    [idHabitacion]
  );

  let nuevoEstado = habitacion.estado;

  if (reservasActivas.some((reserva) => reserva.estado === ESTADO_CONFIRMADA)) {
    nuevoEstado = 'ocupada';
  } else if (reservasActivas.some((reserva) => reserva.estado === ESTADO_RESERVADA)) {
    nuevoEstado = 'reservada';
  } else if (habitacion.estado !== 'mantenimiento') {
    nuevoEstado = 'disponible';
  }

  await connection.query(
    'UPDATE habitaciones SET estado = ? WHERE id_habitacion = ?',
    [nuevoEstado, idHabitacion]
  );
};

const parsearFechaLocal = (fecha) => {
  if (fecha instanceof Date) {
    const copia = new Date(fecha);
    copia.setHours(0, 0, 0, 0);
    return copia;
  }

  const valor = String(fecha || '').split('T')[0];
  const partes = valor.split('-').map(Number);

  if (partes.length === 3 && partes.every((parte) => !Number.isNaN(parte))) {
    const [anio, mes, dia] = partes;
    return new Date(anio, mes - 1, dia);
  }

  const fechaConvertida = new Date(valor);
  fechaConvertida.setHours(0, 0, 0, 0);
  return fechaConvertida;
};

const calcularDias = (fechaInicio, fechaFin) => {
  const inicio = parsearFechaLocal(fechaInicio);
  const fin = parsearFechaLocal(fechaFin);
  const diferencia = fin - inicio;
  return Math.ceil(diferencia / (1000 * 60 * 60 * 24));
};

const normalizarFechaSinHora = (fecha) => {
  return parsearFechaLocal(fecha);
};

const actualizarEstadoReserva = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { nuevoEstado } = req.body;

    const [reserva] = await connection.query(
      'SELECT r.id_reserva, r.estado, r.id_usuario, d.id_habitacion FROM reservas r INNER JOIN detalle_reserva d ON r.id_reserva = d.id_reserva WHERE r.id_reserva = ?',
      [id]
    );

    if (!reserva.length) {
      return res.status(404).json({ mensaje: 'Reserva no encontrada' });
    }

    const estadosPermitidos = [ESTADO_RESERVADA, ESTADO_CONFIRMADA, ESTADO_CANCELADA, ESTADO_FINALIZADA];
    if (!estadosPermitidos.includes(nuevoEstado)) {
      return res.status(400).json({ mensaje: 'Estado no valido para la reserva' });
    }

    const idHabitacion = reserva[0].id_habitacion;
    await connection.beginTransaction();

    await connection.query(
      'UPDATE reservas SET estado = ? WHERE id_reserva = ?',
      [nuevoEstado, id]
    );

    if (nuevoEstado === ESTADO_FINALIZADA || nuevoEstado === ESTADO_CANCELADA) {
      await sincronizarEstadoHabitacion(connection, idHabitacion);
    } else if (nuevoEstado === ESTADO_CONFIRMADA) {
      await connection.query(
        'UPDATE habitaciones SET estado = "ocupada" WHERE id_habitacion = ?',
        [idHabitacion]
      );
    } else if (nuevoEstado === ESTADO_RESERVADA) {
      await connection.query(
        'UPDATE habitaciones SET estado = "reservada" WHERE id_habitacion = ?',
        [idHabitacion]
      );
    }

    if (nuevoEstado === ESTADO_FINALIZADA) {
      const [reservaTotal] = await connection.query(
        'SELECT total FROM reservas WHERE id_reserva = ?',
        [id]
      );

      const totalFactura = Number(reservaTotal[0]?.total || 0);

      await connection.query(
        `INSERT INTO facturas (id_reserva, subtotal, impuestos, total)
         SELECT ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM facturas WHERE id_reserva = ?
         )`,
        [id, totalFactura, 0, totalFactura, id]
      );
    }

    await crearNotificacionUsuario(
      connection,
      reserva[0].id_usuario,
      `Tu reserva #${id} cambio a estado ${nuevoEstado}.`,
      'reserva'
    );

    await connection.commit();
    res.json({ mensaje: `Estado actualizado a ${nuevoEstado} correctamente` });
  } catch (error) {
    await connection.rollback();
    console.error('Error al actualizar estado:', error);
    res.status(500).json({ mensaje: 'Error al procesar la solicitud' });
  } finally {
    connection.release();
  }
};

const crearReserva = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id_habitacion, fecha_inicio, fecha_fin } = req.body;
    const id_usuario = req.user.id_usuario;

    if (!id_habitacion || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({ mensaje: 'Todos los campos son obligatorios' });
    }

    if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
      return res.status(400).json({ mensaje: 'La fecha_fin debe ser mayor que la fecha_inicio' });
    }

    const [usuario] = await connection.query(
      'SELECT id_usuario FROM usuarios WHERE id_usuario = ?',
      [id_usuario]
    );

    if (!usuario.length) {
      return res.status(404).json({ mensaje: 'El usuario no existe' });
    }

    const [habitacion] = await connection.query(
      `SELECT h.id_habitacion, h.estado, t.precio_base
       FROM habitaciones h
       INNER JOIN tipos_habitacion t ON h.id_tipo = t.id_tipo
       WHERE h.id_habitacion = ?`,
      [id_habitacion]
    );

    if (!habitacion.length) {
      return res.status(404).json({ mensaje: 'La habitacion no existe' });
    }

    if (habitacion[0].estado === 'mantenimiento') {
      return res.status(400).json({ mensaje: 'La habitacion esta en mantenimiento' });
    }

    const [cruceReservas] = await connection.query(
      `SELECT r.id_reserva
       FROM reservas r
       INNER JOIN detalle_reserva d ON r.id_reserva = d.id_reserva
       WHERE d.id_habitacion = ?
       AND r.estado IN (${ESTADOS_ACTIVOS_SQL})
       AND (? < r.fecha_fin AND ? > r.fecha_inicio)`,
      [id_habitacion, fecha_inicio, fecha_fin]
    );

    if (cruceReservas.length > 0) {
      return res.status(400).json({ mensaje: 'La habitacion ya esta reservada en esas fechas' });
    }

    const dias = calcularDias(fecha_inicio, fecha_fin);
    const precio_noche = Number(habitacion[0].precio_base);
    const total = dias * precio_noche;

    await connection.beginTransaction();

    const [resultadoReserva] = await connection.query(
      `INSERT INTO reservas (id_usuario, fecha_inicio, fecha_fin, estado, total)
       VALUES (?, ?, ?, 'reservada', ?)`,
      [id_usuario, fecha_inicio, fecha_fin, total]
    );

    const id_reserva = resultadoReserva.insertId;

    await connection.query(
      `INSERT INTO detalle_reserva (id_reserva, id_habitacion, precio_noche)
       VALUES (?, ?, ?)`,
      [id_reserva, id_habitacion, precio_noche]
    );

    await connection.query(
      `UPDATE habitaciones
       SET estado = 'reservada'
       WHERE id_habitacion = ?`,
      [id_habitacion]
    );

    await crearNotificacionUsuario(
      connection,
      id_usuario,
      `Tu reserva #${id_reserva} fue creada correctamente y quedo en estado reservada.`,
      'reserva'
    );

    await crearNotificacionesInternas(
      connection,
      `Nueva reserva #${id_reserva} registrada para la habitacion ${id_habitacion}.`,
      'reserva'
    );

    await connection.commit();

    res.status(201).json({
      mensaje: 'Reserva creada correctamente',
      reserva: {
        id_reserva,
        id_usuario,
        id_habitacion,
        fecha_inicio,
        fecha_fin,
        dias,
        precio_noche,
        total,
        estado: ESTADO_RESERVADA
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error al crear reserva:', error);
    res.status(500).json({ mensaje: 'Error al crear la reserva' });
  } finally {
    connection.release();
  }
};

const listarReservas = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.id_reserva, r.id_usuario, r.fecha_inicio, r.fecha_fin, r.estado, r.total, r.fecha_creacion,
             u.nombre, u.apellido, u.email,
             h.numero AS numero_habitacion,
             t.nombre AS tipo_habitacion
      FROM reservas r
      INNER JOIN usuarios u ON r.id_usuario = u.id_usuario
      INNER JOIN detalle_reserva d ON r.id_reserva = d.id_reserva
      INNER JOIN habitaciones h ON d.id_habitacion = h.id_habitacion
      INNER JOIN tipos_habitacion t ON h.id_tipo = t.id_tipo
      ORDER BY r.id_reserva DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error('Error al listar reservas:', error);
    res.status(500).json({ mensaje: 'Error al listar reservas' });
  }
};

const listarReservasPorUsuario = async (req, res) => {
  try {
    const { id_usuario } = req.params;

    if (!esAdminORecepcion(req.user) && Number(id_usuario) !== Number(req.user.id_usuario)) {
      return res.status(403).json({ mensaje: 'No puedes consultar reservas de otro usuario' });
    }

    const [usuario] = await pool.query('SELECT id_usuario FROM usuarios WHERE id_usuario = ?', [id_usuario]);
    if (!usuario.length) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    const [rows] = await pool.query(
      `SELECT r.id_reserva, r.id_usuario, r.fecha_inicio, r.fecha_fin, r.estado, r.total, r.fecha_creacion,
              h.id_habitacion, h.numero AS numero_habitacion, h.piso,
              t.nombre AS tipo_habitacion, d.precio_noche
       FROM reservas r
       INNER JOIN detalle_reserva d ON r.id_reserva = d.id_reserva
       INNER JOIN habitaciones h ON d.id_habitacion = h.id_habitacion
       INNER JOIN tipos_habitacion t ON h.id_tipo = t.id_tipo
       WHERE r.id_usuario = ?
       ORDER BY r.id_reserva DESC`,
      [id_usuario]
    );

    res.json(rows);
  } catch (error) {
    console.error('Error al listar reservas del usuario:', error);
    res.status(500).json({ mensaje: 'Error al listar reservas del usuario' });
  }
};

const listarMisReservas = async (req, res) => {
  req.params.id_usuario = String(req.user.id_usuario);
  return listarReservasPorUsuario(req, res);
};

const obtenerReservaPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT r.id_reserva, r.id_usuario, r.fecha_inicio, r.fecha_fin, r.estado, r.total, r.fecha_creacion,
              u.nombre, u.apellido, u.email, u.telefono,
              h.numero AS numero_habitacion, h.piso,
              t.nombre AS tipo_habitacion, t.precio_base
       FROM reservas r
       INNER JOIN usuarios u ON r.id_usuario = u.id_usuario
       INNER JOIN detalle_reserva d ON r.id_reserva = d.id_reserva
       INNER JOIN habitaciones h ON d.id_habitacion = h.id_habitacion
       INNER JOIN tipos_habitacion t ON h.id_tipo = t.id_tipo
       WHERE r.id_reserva = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ mensaje: 'Reserva no encontrada' });
    }

    if (!esAdminORecepcion(req.user) && Number(rows[0].id_usuario) !== Number(req.user.id_usuario)) {
      return res.status(403).json({ mensaje: 'No puedes consultar esta reserva' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error al obtener reserva:', error);
    res.status(500).json({ mensaje: 'Error al obtener la reserva' });
  }
};

const actualizarReserva = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;
    const { id_habitacion, fecha_inicio, fecha_fin } = req.body;

    if (!id_habitacion || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({ mensaje: 'Debes enviar habitacion, fecha_inicio y fecha_fin' });
    }

    if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
      return res.status(400).json({ mensaje: 'La fecha_fin debe ser mayor que la fecha_inicio' });
    }

    const [reservas] = await connection.query(
      `SELECT r.id_reserva, r.id_usuario, r.estado, r.fecha_inicio, r.fecha_fin,
              d.id_habitacion, d.precio_noche
       FROM reservas r
       INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
       WHERE r.id_reserva = ?`,
      [id]
    );

    if (!reservas.length) {
      return res.status(404).json({ mensaje: 'Reserva no encontrada' });
    }

    const reserva = reservas[0];

    if (!esAdminORecepcion(req.user) && Number(reserva.id_usuario) !== Number(req.user.id_usuario)) {
      return res.status(403).json({ mensaje: 'No puedes modificar una reserva ajena' });
    }

    if (reserva.estado !== ESTADO_RESERVADA) {
      return res.status(400).json({ mensaje: 'Solo se pueden reprogramar reservas en estado reservada' });
    }

    const fechaInicioActual = normalizarFechaSinHora(reserva.fecha_inicio);
    const hoy = normalizarFechaSinHora(new Date());

    if (!esAdminORecepcion(req.user) && fechaInicioActual < hoy) {
      return res.status(400).json({ mensaje: 'Solo puedes modificar reservas futuras o vigentes antes del check-in' });
    }

    const [habitaciones] = await connection.query(
      `SELECT h.id_habitacion, h.estado, t.precio_base
       FROM habitaciones h
       INNER JOIN tipos_habitacion t ON t.id_tipo = h.id_tipo
       WHERE h.id_habitacion = ?`,
      [id_habitacion]
    );

    if (!habitaciones.length) {
      return res.status(404).json({ mensaje: 'La habitacion no existe' });
    }

    const habitacionDestino = habitaciones[0];

    if (habitacionDestino.estado === 'mantenimiento') {
      return res.status(400).json({ mensaje: 'La habitacion seleccionada esta en mantenimiento' });
    }

    const [cruces] = await connection.query(
      `SELECT r.id_reserva
       FROM reservas r
       INNER JOIN detalle_reserva d ON d.id_reserva = r.id_reserva
       WHERE d.id_habitacion = ?
         AND r.estado IN (${ESTADOS_ACTIVOS_SQL})
         AND r.id_reserva <> ?
         AND (? < r.fecha_fin AND ? > r.fecha_inicio)`,
      [id_habitacion, id, fecha_inicio, fecha_fin]
    );

    if (cruces.length > 0) {
      return res.status(400).json({ mensaje: 'La habitacion no esta disponible para las fechas seleccionadas' });
    }

    const dias = calcularDias(fecha_inicio, fecha_fin);
    const precioNoche = Number(habitacionDestino.precio_base);
    const total = dias * precioNoche;
    const idHabitacionAnterior = Number(reserva.id_habitacion);
    const idHabitacionNueva = Number(id_habitacion);

    await connection.beginTransaction();

    await connection.query(
      `UPDATE reservas
       SET fecha_inicio = ?, fecha_fin = ?, total = ?
       WHERE id_reserva = ?`,
      [fecha_inicio, fecha_fin, total, id]
    );

    await connection.query(
      `UPDATE detalle_reserva
       SET id_habitacion = ?, precio_noche = ?
       WHERE id_reserva = ?`,
      [idHabitacionNueva, precioNoche, id]
    );

    if (idHabitacionAnterior !== idHabitacionNueva) {
      await sincronizarEstadoHabitacion(connection, idHabitacionAnterior);
    }

    await connection.query(
      `UPDATE habitaciones
       SET estado = 'reservada'
       WHERE id_habitacion = ?`,
      [idHabitacionNueva]
    );

    await crearNotificacionUsuario(
      connection,
      reserva.id_usuario,
      `Tu reserva #${id} fue reprogramada para ${fecha_inicio} - ${fecha_fin}.`,
      'reserva'
    );

    await crearNotificacionesInternas(
      connection,
      `La reserva #${id} fue reprogramada y ahora corresponde a la habitacion ${idHabitacionNueva}.`,
      'reserva'
    );

    await connection.commit();

    res.json({
      mensaje: 'Reserva actualizada correctamente',
      reserva: {
        id_reserva: Number(id),
        id_usuario: reserva.id_usuario,
        id_habitacion: idHabitacionNueva,
        fecha_inicio,
        fecha_fin,
        dias,
        precio_noche: precioNoche,
        total,
        estado: ESTADO_RESERVADA
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error al actualizar la reserva:', error);
    res.status(500).json({ mensaje: 'Error al actualizar la reserva' });
  } finally {
    connection.release();
  }
};

const cancelarReserva = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    const [detalle] = await connection.query(
      `SELECT d.id_habitacion, r.estado, r.id_usuario, r.fecha_inicio
       FROM detalle_reserva d
       INNER JOIN reservas r ON d.id_reserva = r.id_reserva
       WHERE d.id_reserva = ?`,
      [id]
    );

    if (!detalle.length) {
      return res.status(404).json({ mensaje: 'Reserva no encontrada' });
    }

    if (detalle[0].estado === ESTADO_CANCELADA) {
      return res.status(400).json({ mensaje: 'La reserva ya esta cancelada' });
    }

    if (detalle[0].estado === ESTADO_FINALIZADA) {
      return res.status(400).json({ mensaje: 'La reserva ya finalizo' });
    }

    if (!esAdminORecepcion(req.user) && Number(detalle[0].id_usuario) !== Number(req.user.id_usuario)) {
      return res.status(403).json({ mensaje: 'No puedes cancelar una reserva ajena' });
    }

    if (!esAdminORecepcion(req.user) && detalle[0].estado !== ESTADO_RESERVADA) {
      return res.status(400).json({ mensaje: 'Solo puedes cancelar reservas que aun no han hecho check-in' });
    }

    const fechaInicioReserva = normalizarFechaSinHora(detalle[0].fecha_inicio);
    const hoy = normalizarFechaSinHora(new Date());

    if (!esAdminORecepcion(req.user) && fechaInicioReserva < hoy) {
      return res.status(400).json({ mensaje: 'Solo puedes cancelar reservas futuras' });
    }

    await connection.beginTransaction();

    await connection.query(
      `UPDATE reservas
       SET estado = 'cancelada'
       WHERE id_reserva = ?`,
      [id]
    );

    await sincronizarEstadoHabitacion(connection, detalle[0].id_habitacion);

    await crearNotificacionUsuario(
      connection,
      detalle[0].id_usuario,
      `Tu reserva #${id} fue cancelada correctamente.`,
      'reserva'
    );

    await crearNotificacionesInternas(
      connection,
      `La reserva #${id} fue cancelada y la habitacion quedo disponible.`,
      'reserva'
    );

    await connection.commit();

    res.json({ mensaje: 'Reserva cancelada correctamente' });
  } catch (error) {
    await connection.rollback();
    console.error('Error al cancelar reserva:', error);
    res.status(500).json({ mensaje: 'Error al cancelar la reserva' });
  } finally {
    connection.release();
  }
};

module.exports = {
  crearReserva,
  listarReservas,
  listarMisReservas,
  listarReservasPorUsuario,
  obtenerReservaPorId,
  actualizarReserva,
  cancelarReserva,
  actualizarEstadoReserva
};
