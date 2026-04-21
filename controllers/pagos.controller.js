const pool = require('../config/db');

const ROLE_ADMIN = 1;
const ROLE_RECEPCION = 2;

const esAdminORecepcion = (user) => user && (user.id_rol === ROLE_ADMIN || user.id_rol === ROLE_RECEPCION);

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

const obtenerResumenPagoPorReserva = async (connection, idReserva) => {
  const [reservas] = await connection.query(
    `SELECT r.id_reserva, r.id_usuario, r.estado, r.total, r.fecha_inicio, r.fecha_fin,
            u.nombre, u.apellido, u.email
     FROM reservas r
     INNER JOIN usuarios u ON u.id_usuario = r.id_usuario
     WHERE r.id_reserva = ?`,
    [idReserva]
  );

  if (!reservas.length) {
    return null;
  }

  const reserva = reservas[0];

  const [facturas] = await connection.query(
    `SELECT id_factura, subtotal, impuestos, total, fecha_emision
     FROM facturas
     WHERE id_reserva = ?
     ORDER BY id_factura DESC
     LIMIT 1`,
    [idReserva]
  );

  let factura = facturas[0] || null;

  if (!factura) {
    await connection.query(
      `INSERT INTO facturas (id_reserva, subtotal, impuestos, total)
       VALUES (?, ?, 0, ?)`,
      [idReserva, Number(reserva.total), Number(reserva.total)]
    );

    const [facturaCreada] = await connection.query(
      `SELECT id_factura, subtotal, impuestos, total, fecha_emision
       FROM facturas
       WHERE id_reserva = ?
       ORDER BY id_factura DESC
       LIMIT 1`,
      [idReserva]
    );

    factura = facturaCreada[0];
  }

  const [pagos] = await connection.query(
    `SELECT id_pago, monto, metodo_pago, estado, fecha_pago
     FROM pagos
     WHERE id_factura = ?
     ORDER BY id_pago DESC`,
    [factura.id_factura]
  );

  const totalPagado = pagos
    .filter((pago) => pago.estado === 'pagado')
    .reduce((total, pago) => total + Number(pago.monto || 0), 0);

  const totalFactura = Number(factura.total || 0);
  const saldoPendiente = Math.max(totalFactura - totalPagado, 0);

  return {
    reserva,
    factura,
    pagos,
    totalPagado,
    saldoPendiente
  };
};

const obtenerPagoPorReserva = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id_reserva } = req.params;
    const resumen = await obtenerResumenPagoPorReserva(connection, id_reserva);

    if (!resumen) {
      return res.status(404).json({ mensaje: 'Reserva no encontrada' });
    }

    if (!esAdminORecepcion(req.user) && Number(resumen.reserva.id_usuario) !== Number(req.user.id_usuario)) {
      return res.status(403).json({ mensaje: 'No puedes consultar pagos de otra reserva' });
    }

    res.json(resumen);
  } catch (error) {
    console.error('Error al obtener pago por reserva:', error);
    res.status(500).json({ mensaje: 'Error al obtener la informacion de pagos' });
  } finally {
    connection.release();
  }
};

const registrarPagoReserva = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id_reserva } = req.params;
    const { monto, metodo_pago } = req.body;

    const metodosPermitidos = ['efectivo', 'tarjeta', 'transferencia'];
    const montoNumerico = Number(monto);

    if (!montoNumerico || montoNumerico <= 0) {
      return res.status(400).json({ mensaje: 'Debes ingresar un monto valido' });
    }

    if (!metodosPermitidos.includes(String(metodo_pago || '').toLowerCase())) {
      return res.status(400).json({ mensaje: 'Metodo de pago no valido' });
    }

    await connection.beginTransaction();

    const resumen = await obtenerResumenPagoPorReserva(connection, id_reserva);

    if (!resumen) {
      await connection.rollback();
      return res.status(404).json({ mensaje: 'Reserva no encontrada' });
    }

    if (resumen.reserva.estado === 'cancelada') {
      await connection.rollback();
      return res.status(400).json({ mensaje: 'No puedes registrar pagos en una reserva cancelada' });
    }

    if (resumen.saldoPendiente <= 0) {
      await connection.rollback();
      return res.status(400).json({ mensaje: 'La factura de esta reserva ya se encuentra pagada' });
    }

    if (montoNumerico > resumen.saldoPendiente) {
      await connection.rollback();
      return res.status(400).json({ mensaje: 'El monto supera el saldo pendiente de la factura' });
    }

    await connection.query(
      `INSERT INTO pagos (id_factura, monto, metodo_pago, estado, fecha_pago)
       VALUES (?, ?, ?, 'pagado', NOW())`,
      [resumen.factura.id_factura, montoNumerico, metodo_pago]
    );

    await connection.query(
      `INSERT INTO notificaciones (id_usuario, mensaje, tipo, estado)
       VALUES (?, ?, 'pago', 'enviado')`,
      [
        resumen.reserva.id_usuario,
        `Se registro un pago de COP ${montoNumerico.toLocaleString('es-CO')} para la reserva #${resumen.reserva.id_reserva}.`
      ]
    );

    await crearNotificacionesInternas(
      connection,
      `Se registro un pago de COP ${montoNumerico.toLocaleString('es-CO')} para la reserva #${resumen.reserva.id_reserva}.`,
      'pago'
    );

    await connection.commit();

    const resumenActualizado = await obtenerResumenPagoPorReserva(pool, id_reserva);

    res.status(201).json({
      mensaje: 'Pago registrado correctamente',
      ...resumenActualizado
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error al registrar pago:', error);
    res.status(500).json({ mensaje: 'Error al registrar el pago' });
  } finally {
    connection.release();
  }
};

module.exports = {
  obtenerPagoPorReserva,
  registrarPagoReserva
};
