const crypto = require('crypto');

const TOKEN_SECRET = process.env.AUTH_SECRET || 'hotel-boutique-secret';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 8;

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(value) {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');

  return Buffer.from(normalized, 'base64').toString('utf8');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function needsPasswordMigration(storedPassword) {
  return typeof storedPassword === 'string' && !storedPassword.startsWith('scrypt$');
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword) return false;

  if (needsPasswordMigration(storedPassword)) {
    return storedPassword === password;
  }

  const parts = storedPassword.split('$');
  if (parts.length !== 3) return false;

  const [, salt, storedHash] = parts;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

function createToken(user) {
  const payload = {
    id_usuario: user.id_usuario,
    id_rol: user.id_rol,
    email: user.email,
    rol: user.rol || user.nombre_rol,
    exp: Date.now() + TOKEN_TTL_MS
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = toBase64Url(
    crypto.createHmac('sha256', TOKEN_SECRET).update(encodedPayload).digest()
  );

  return `${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) {
    throw new Error('Token invalido');
  }

  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = toBase64Url(
    crypto.createHmac('sha256', TOKEN_SECRET).update(encodedPayload).digest()
  );

  if (signature !== expectedSignature) {
    throw new Error('Firma invalida');
  }

  const payload = JSON.parse(fromBase64Url(encodedPayload));
  if (!payload.exp || payload.exp < Date.now()) {
    throw new Error('Token expirado');
  }

  return payload;
}

module.exports = {
  createToken,
  hashPassword,
  needsPasswordMigration,
  verifyPassword,
  verifyToken
};
