import crypto from 'crypto';
import { env } from '../config/env.js';

export const ENCRYPTION_PREFIX = 'enc:v1:';

const encryptionKey = () => {
  if (!env.FIELD_ENCRYPTION_KEY) return null;
  const key = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
};

export const encryptionEnabled = () => Boolean(encryptionKey());

export const isEncrypted = (value) =>
  typeof value === 'string' && value.startsWith(ENCRYPTION_PREFIX);

export const encryptField = (value) => {
  if (value === undefined || value === null || value === '' || isEncrypted(value)) return value;
  const key = encryptionKey();
  if (!key) {
    if (env.NODE_ENV === 'production') throw new Error('FIELD_ENCRYPTION_KEY is required in production');
    return value;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
};

export const decryptField = (value) => {
  if (!isEncrypted(value)) return value;
  const key = encryptionKey();
  if (!key) return value;

  const parts = value.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    return value;
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parts[4], 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
};

export const createBlindIndex = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (!env.SEARCH_HASH_KEY) return '';
  const normalized = String(value).trim().toLowerCase();
  return crypto.createHmac('sha256', env.SEARCH_HASH_KEY).update(normalized).digest('hex');
};
