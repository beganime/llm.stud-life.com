import crypto from 'node:crypto';

const keyFor = (secret: string) => crypto.createHash('sha256').update(secret).digest();

export function encrypt(value: string, secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decrypt(value: string, secret: string) {
  const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
