import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

const IV_BYTES = 12; // tamaño recomendado para AES-GCM
const AUTH_TAG_BYTES = 16; // GCM produce un tag de 128 bits
const KEY_BYTES = 32; // AES-256

/** Cliente S3 apuntando a MinIO con las credenciales del entorno. */
export function buildMinioClient(): S3Client {
  return new S3Client({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    region: 'us-east-1', // MinIO lo ignora, pero el SDK lo exige
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio12345',
    },
  });
}

/**
 * Cifra el binario a nivel de aplicación con AES-256-GCM antes de subirlo
 * (el objeto almacenado es `iv || authTag || ciphertext`): la confidencialidad
 * no depende de la configuración del bucket.
 */
export function encryptAtRest(plaintext: Uint8Array): Buffer {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Descifra el objeto almacenado por `encryptAtRest` (`iv || authTag || ciphertext`).
 * Verifica el tag de autenticación GCM: si el binario fue manipulado, `final()` lanza.
 * Inverso exacto del cifrado; permite que la API sirva el documento original al analista.
 */
export function decryptAtRest(stored: Uint8Array): Buffer {
  const key = loadKey();
  const buffer = Buffer.from(stored);
  const iv = buffer.subarray(0, IV_BYTES);
  const authTag = buffer.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buffer.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Crea el bucket la primera vez; ignora si ya existe (idempotente). */
export async function ensureBucket(
  client: S3Client,
  bucket: string,
): Promise<void> {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    const owned =
      name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists';
    if (!owned) throw err;
  }
}

function loadKey(): Buffer {
  const raw = process.env.KYC_ENCRYPTION_KEY;
  if (!raw)
    throw new Error(
      'KYC_ENCRYPTION_KEY no configurada: los documentos KYC deben cifrarse en reposo',
    );
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `KYC_ENCRYPTION_KEY debe ser de ${KEY_BYTES} bytes en base64`,
    );
  }
  return key;
}
