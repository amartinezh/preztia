import { Injectable } from '@nestjs/common';
import type { PasswordHasher } from '@preztiaos/application';
import { hashPassword, verifyPassword } from './password';

/**
 * Adaptador del puerto `PasswordHasher` de la aplicación. Mantiene el hashing (scrypt,
 * node:crypto) como detalle de infraestructura para que los casos de uso no conozcan I/O.
 * `verify` es la MISMA función que usa el login (comparación en tiempo constante).
 */
@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return hashPassword(plain);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return verifyPassword(plain, hash);
  }
}
