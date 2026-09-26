/**
 * Lo mínimo que se usa del archivo que entrega multer (`FileInterceptor`) sin depender de
 * `@types/multer`: el binario en memoria y su tipo declarado (lo valida el dominio).
 */
export interface UploadedFileLike {
  readonly buffer: Buffer;
  readonly mimetype: string;
}

/** Binario y tipo del archivo subido; vacío si no vino (el dominio lo rechaza como obligatorio). */
export function fileOrEmpty(file: UploadedFileLike | undefined): {
  bytes: Uint8Array;
  mimeType: string;
} {
  return {
    bytes: file?.buffer ?? new Uint8Array(),
    mimeType: file?.mimetype ?? '',
  };
}
