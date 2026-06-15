import { Injectable } from '@nestjs/common';
import type { PasswordHasher } from '@preztiaos/application';
import { hashPassword } from './password';

/**
 * Adaptador del puerto `PasswordHasher` de la aplicación. Mantiene el hashing (scrypt,
 * node:crypto) como detalle de infraestructura para que los casos de uso no conozcan I/O.
 */
@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return hashPassword(plain);
  }
}
