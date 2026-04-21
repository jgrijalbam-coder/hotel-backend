const pool = require('../config/db');
const {
  createToken,
  hashPassword,
  needsPasswordMigration,
  verifyPassword
} = require('../utils/auth');

const ROLE_ADMIN = 1;
const ROLE_RECEPCION = 2;
const ROLE_CLIENTE = 3;

const esAdminORecepcion = (user) => user && (user.id_rol === ROLE_ADMIN || user.id_rol === ROLE_RECEPCION);

const normalizarEstadoUsuario = (estado, bloqueado = false) => {
  const valor = String(estado ?? '').trim().toLowerCase();

  if (['activo', 'inactivo', 'suspendido'].includes(valor)) {
    return valor;
  }

  return bloqueado ? 'suspendido' : 'inactivo';
};

const estadoUsuarioInactivo = (estado) => {
  const valor = normalizarEstadoUsuario(estado);
  return valor === 'inactivo' || valor === 'suspendido';
};

const mapearUsuarioSeguro = (usuario) => ({
  id_usuario: usuario.id_usuario,
  nombre: usuario.nombre,
  apellido: usuario.apellido,
  email: usuario.email,
  telefono: usuario.telefono,
  direccion: usuario.direccion,
  estado: normalizarEstadoUsuario(usuario.estado, usuario.bloqueado),
  bloqueado: Boolean(usuario.bloqueado),
  fecha_registro: usuario.fecha_registro,
  id_rol: usuario.id_rol,
  rol: usuario.nombre_rol || usuario.rol
});

const listarUsuarios = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.telefono,
             u.direccion, u.estado, u.bloqueado, u.fecha_registro,
             u.id_rol, r.nombre_rol
      FROM usuarios u
      INNER JOIN roles r ON u.id_rol = r.id_rol
      ORDER BY u.id_usuario DESC
    `);

    res.json(rows.map(mapearUsuarioSeguro));
  } catch (error) {
    console.error('Error al listar usuarios:', error);
    res.status(500).json({ mensaje: 'Error al listar usuarios' });
  }
};

const obtenerUsuarioPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const solicitante = req.user;

    if (!esAdminORecepcion(solicitante) && Number(id) !== Number(solicitante.id_usuario)) {
      return res.status(403).json({ mensaje: 'No puedes consultar otro perfil' });
    }

    const [rows] = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.telefono,
              u.direccion, u.estado, u.bloqueado, u.fecha_registro,
              u.id_rol, r.nombre_rol
       FROM usuarios u
       INNER JOIN roles r ON u.id_rol = r.id_rol
       WHERE u.id_usuario = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    res.json(mapearUsuarioSeguro(rows[0]));
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ mensaje: 'Error al obtener usuario' });
  }
};

const obtenerMiPerfil = async (req, res) => {
  req.params.id = String(req.user.id_usuario);
  return obtenerUsuarioPorId(req, res);
};

const registrarUsuario = async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, direccion, password } = req.body;

    if (!nombre || !email || !password) {
      return res.status(400).json({ mensaje: 'Nombre, email y password son obligatorios' });
    }

    const [usuarioExistente] = await pool.query(
      'SELECT id_usuario FROM usuarios WHERE email = ?',
      [email]
    );

    if (usuarioExistente.length > 0) {
      return res.status(400).json({ mensaje: 'El correo ya esta registrado' });
    }

    await pool.query(
      `INSERT INTO usuarios
      (nombre, apellido, email, telefono, direccion, password_hash, id_rol, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'activo')`,
      [
        nombre,
        apellido || null,
        email,
        telefono || null,
        direccion || null,
        hashPassword(password),
        ROLE_CLIENTE
      ]
    );

    res.status(201).json({ mensaje: 'Usuario registrado correctamente' });
  } catch (error) {
    console.error('Error al registrar usuario:', error);
    res.status(500).json({ mensaje: 'Error al registrar usuario' });
  }
};

const loginUsuario = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ mensaje: 'Email y password son obligatorios' });
    }

    const [usuarios] = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.password_hash,
              u.telefono, u.direccion, u.estado, u.bloqueado,
              u.intentos_login, u.id_rol, r.nombre_rol
       FROM usuarios u
       INNER JOIN roles r ON u.id_rol = r.id_rol
       WHERE u.email = ?`,
      [email]
    );

    if (!usuarios.length) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    const usuario = usuarios[0];

    if (estadoUsuarioInactivo(usuario.estado)) {
      return res.status(403).json({ mensaje: 'La cuenta no esta activa' });
    }

    if (usuario.bloqueado) {
      return res.status(403).json({ mensaje: 'La cuenta esta bloqueada' });
    }

    if (!verifyPassword(password, usuario.password_hash)) {
      await pool.query(
        `UPDATE usuarios
         SET intentos_login = intentos_login + 1,
             bloqueado = IF(intentos_login + 1 >= 5, TRUE, bloqueado)
         WHERE id_usuario = ?`,
        [usuario.id_usuario]
      );

      return res.status(401).json({ mensaje: 'Contrasena incorrecta' });
    }

    if (needsPasswordMigration(usuario.password_hash)) {
      await pool.query(
        `UPDATE usuarios
         SET password_hash = ?
         WHERE id_usuario = ?`,
        [hashPassword(password), usuario.id_usuario]
      );
    }

    await pool.query(
      `UPDATE usuarios
       SET intentos_login = 0
       WHERE id_usuario = ?`,
      [usuario.id_usuario]
    );

    const usuarioSeguro = mapearUsuarioSeguro(usuario);

    res.json({
      mensaje: 'Login exitoso',
      token: createToken(usuarioSeguro),
      usuario: usuarioSeguro
    });
  } catch (error) {
    console.error('Error al iniciar sesion:', error);
    res.status(500).json({ mensaje: 'Error al iniciar sesion' });
  }
};

const actualizarUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, email, telefono, direccion } = req.body;
    const solicitante = req.user;

    if (!nombre || !email) {
      return res.status(400).json({ mensaje: 'Nombre y email son obligatorios' });
    }

    if (!esAdminORecepcion(solicitante) && Number(id) !== Number(solicitante.id_usuario)) {
      return res.status(403).json({ mensaje: 'No puedes actualizar otro perfil' });
    }

    const [usuario] = await pool.query('SELECT id_usuario FROM usuarios WHERE id_usuario = ?', [id]);
    if (!usuario.length) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    const [correoExistente] = await pool.query(
      'SELECT id_usuario FROM usuarios WHERE email = ? AND id_usuario <> ?',
      [email, id]
    );

    if (correoExistente.length > 0) {
      return res.status(400).json({ mensaje: 'Ese correo ya esta en uso por otro usuario' });
    }

    await pool.query(
      `UPDATE usuarios
       SET nombre = ?, apellido = ?, email = ?, telefono = ?, direccion = ?
       WHERE id_usuario = ?`,
      [nombre, apellido || null, email, telefono || null, direccion || null, id]
    );

    const [usuarioActualizado] = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.telefono,
              u.direccion, u.estado, u.bloqueado, u.fecha_registro,
              u.id_rol, r.nombre_rol
       FROM usuarios u
       INNER JOIN roles r ON u.id_rol = r.id_rol
       WHERE u.id_usuario = ?`,
      [id]
    );

    const usuarioSeguro = mapearUsuarioSeguro(usuarioActualizado[0]);

    res.json({
      mensaje: 'Usuario actualizado correctamente',
      usuario: usuarioSeguro,
      token: createToken(usuarioSeguro)
    });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ mensaje: 'Error al actualizar usuario' });
  }
};

const actualizarMiPerfil = async (req, res) => {
  req.params.id = String(req.user.id_usuario);
  return actualizarUsuario(req, res);
};

const actualizarEstadoAccesoUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const { bloqueado, estado } = req.body;

    if (bloqueado === undefined && estado === undefined) {
      return res.status(400).json({ mensaje: 'Debes enviar un cambio de bloqueo o estado' });
    }

    if (Number(id) === Number(req.user.id_usuario) && bloqueado === true) {
      return res.status(400).json({ mensaje: 'No puedes bloquear tu propia cuenta' });
    }

    const [usuarios] = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.estado, u.bloqueado,
              u.id_rol, r.nombre_rol
       FROM usuarios u
       INNER JOIN roles r ON u.id_rol = r.id_rol
       WHERE u.id_usuario = ?`,
      [id]
    );

    if (!usuarios.length) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    const usuario = usuarios[0];
    const nuevoBloqueo = bloqueado === undefined ? Boolean(usuario.bloqueado) : Boolean(bloqueado);
    const nuevoEstado = estado === undefined
      ? normalizarEstadoUsuario(usuario.estado, usuario.bloqueado)
      : String(estado).toLowerCase();

    if (!['activo', 'inactivo', 'suspendido'].includes(nuevoEstado)) {
      return res.status(400).json({ mensaje: 'Estado de usuario no valido' });
    }

    await pool.query(
      `UPDATE usuarios
       SET bloqueado = ?, estado = ?, intentos_login = IF(? = TRUE, 0, intentos_login)
       WHERE id_usuario = ?`,
      [nuevoBloqueo, nuevoEstado, nuevoBloqueo, id]
    );

    const [actualizado] = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.telefono,
              u.direccion, u.estado, u.bloqueado, u.fecha_registro,
              u.id_rol, r.nombre_rol
       FROM usuarios u
       INNER JOIN roles r ON u.id_rol = r.id_rol
       WHERE u.id_usuario = ?`,
      [id]
    );

    res.json({
      mensaje: `Usuario ${nuevoBloqueo ? 'bloqueado' : 'actualizado'} correctamente`,
      usuario: mapearUsuarioSeguro(actualizado[0])
    });
  } catch (error) {
    console.error('Error al actualizar acceso del usuario:', error);
    res.status(500).json({ mensaje: 'Error al actualizar acceso del usuario' });
  }
};

module.exports = {
  listarUsuarios,
  obtenerUsuarioPorId,
  obtenerMiPerfil,
  registrarUsuario,
  loginUsuario,
  actualizarUsuario,
  actualizarMiPerfil,
  actualizarEstadoAccesoUsuario
};
