import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Derives a 256-bit key from the provided secret using SHA-256.
 * This ensures consistent key length regardless of secret length.
 */
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a private key using AES-256-GCM.
 * Returns base64-encoded string in format: iv:authTag:ciphertext
 */
export function encryptPrivateKey(privateKey: string, secret: string): string {
  if (!privateKey || !secret) {
    throw new Error('Both privateKey and secret are required for encryption');
  }

  const key = deriveKey(secret);
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex-encoded, then base64 the whole thing)
  const combined = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  return Buffer.from(combined).toString('base64');
}

/**
 * Decrypts an encrypted private key that was encrypted with encryptPrivateKey.
 * Expects base64-encoded string in format: iv:authTag:ciphertext
 */
export function decryptPrivateKey(encrypted: string, secret: string): string {
  if (!encrypted || !secret) {
    throw new Error('Both encrypted data and secret are required for decryption');
  }

  const key = deriveKey(secret);
  const decoded = Buffer.from(encrypted, 'base64').toString('utf8');
  const parts = decoded.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
