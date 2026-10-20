import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { loginInput, refreshInput, type TokenPair } from '@preztiaos/contracts';
import { assertTenantActive } from '@preztiaos/domain';
import { findAppUserForLogin } from '../tenancy/unit-of-work';
import { tenantStatusOf } from '../tenancy/tenant-status';
import { verifyPassword } from './password';
import { signToken, verifyToken, TOKEN_TTL } from './jwt';
import { loadSessionSubject } from './session-subject.reader';

/**
 * Frontera HTTP de autenticación: valida con zod (contrato), verifica credenciales
 * y emite el par de tokens. No contiene reglas de negocio ni SQL crudo (delega en el
 * repositorio pre-tenant). La identidad del tenant/rol/zonas se DERIVA del usuario y
 * viaja firmada en el JWT; el cliente nunca la elige.
 */
@Controller('auth')
export class AuthController {
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown): Promise<TokenPair> {
    const { email, password } = loginInput.parse(body);
    const user = await findAppUserForLogin(email);
    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');
    // Empresa suspendida: credenciales correctas pero sin acceso (403 con motivo, tras validar la
    // contraseña para no revelar el estado de una empresa a quien no conoce las credenciales).
    if (user.tenantId) {
      assertTenantActive(await tenantStatusOf(user.tenantId, { fresh: true }));
    }
    return issuePair({
      sub: user.id,
      // El SUPER_ADMIN no tiene tenant: el claim viaja como cadena vacía (el
      // SuperAdminGuard no exige `x-tenant-id`). Los demás roles SIEMPRE tienen tenant.
      tenantId: user.tenantId ?? '',
      role: user.role,
      zonePaths: user.zonePaths,
    });
  }

  /**
   * Renueva la sesión RE-VALIDANDO a su dueño: un usuario desactivado o de una empresa suspendida
   * no renueva, y el rol y las zonas salen de su registro vigente (no de la sesión anterior).
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown): Promise<TokenPair> {
    const { refreshToken } = refreshInput.parse(body);
    const claims = verifyToken(refreshToken);
    if (!claims || claims.typ !== 'refresh') {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    if (claims.tenantId) {
      assertTenantActive(
        await tenantStatusOf(claims.tenantId, { fresh: true }),
      );
    }
    const subject = await loadSessionSubject({
      userId: claims.sub,
      tenantId: claims.tenantId,
    });
    if (!subject || !subject.active) {
      throw new UnauthorizedException('La sesión ya no es válida');
    }
    return issuePair({
      sub: claims.sub,
      tenantId: claims.tenantId,
      role: subject.role,
      zonePaths: subject.zonePaths,
    });
  }
}

/** Emite un access token y un refresh token a partir de la identidad del usuario. */
function issuePair(base: {
  sub: string;
  tenantId: string;
  role: string;
  zonePaths: string[];
}): TokenPair {
  return {
    accessToken: signToken({ ...base, typ: 'access' }, TOKEN_TTL.access),
    refreshToken: signToken({ ...base, typ: 'refresh' }, TOKEN_TTL.refresh),
  };
}
