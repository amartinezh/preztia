import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { loginInput, refreshInput, type TokenPair } from '@preztiaos/contracts';
import { findAppUserForLogin } from '../tenancy/unit-of-work';
import { verifyPassword } from './password';
import { signToken, verifyToken, TOKEN_TTL } from './jwt';

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
    return issuePair({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      zonePaths: user.zonePaths,
    });
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown): TokenPair {
    const { refreshToken } = refreshInput.parse(body);
    const claims = verifyToken(refreshToken);
    if (!claims || claims.typ !== 'refresh') {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    return issuePair({
      sub: claims.sub,
      tenantId: claims.tenantId,
      role: claims.role,
      zonePaths: claims.zonePaths,
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
