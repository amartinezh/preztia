import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { type CpfRegistryVerifier } from '@preztiaos/application';
import { type CpfRegistryRecord } from '@preztiaos/domain';
import { fetchWithRetry } from '../../shared/fetch-retry';

// Etapa 4 (opcional): verificación del CPF contra la base de la Receita Federal
// vía Serpro. El TRIAL es gratuito (datos ficticios) y usa la misma forma de
// autenticación que producción, así que el adaptador queda listo y el cambio a
// producción es solo de credenciales/URL por entorno.
const TOKEN_URL = 'https://gateway.apiserpro.serpro.gov.br/token';
const DEFAULT_CONSULTA_CPF_URL =
  'https://gateway.apiserpro.serpro.gov.br/consulta-cpf-trial/v1/cpf';

const HTTP_NOT_FOUND = 404;
// Renovar el token un poco antes de su expiración real para evitar 401 límite.
const TOKEN_SAFETY_MARGIN_MS = 30_000;

const tokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().catch(0),
});

const cpfSchema = z
  .object({
    ni: z.string(),
    nome: z.string(),
    situacao: z.object({ descricao: z.string() }).passthrough(),
    nascimento: z.string().nullable().catch(null),
  })
  .passthrough();

/**
 * Adaptador del puerto CpfRegistryVerifier (Serpro Consulta CPF).
 *
 * Sin credenciales configuradas (SERPRO_CONSUMER_KEY/SECRET) devuelve null:
 * el pipeline continúa sin esta señal (la Etapa 4 es opcional por diseño).
 */
@Injectable()
export class SerproCpfVerifier implements CpfRegistryVerifier {
  private readonly logger = new Logger('Antifraud:SerproCpf');
  private token: { value: string; expiresAt: number } | null = null;

  async verify(cpf: string): Promise<CpfRegistryRecord | null> {
    const credentials = this.credentials();
    if (!credentials) return null; // servicio no contratado/configurado

    const token = await this.authenticate(credentials);
    const baseUrl =
      process.env.SERPRO_CONSULTA_CPF_URL ?? DEFAULT_CONSULTA_CPF_URL;
    const res = await fetchWithRetry(`${baseUrl}/${cpf}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (res.status === HTTP_NOT_FOUND) {
      // CPF inexistente en la RFB: se modela como situación terminal verificada.
      return {
        nombre: '',
        nacimiento: null,
        situacion: 'Inexistente (no consta en la RFB)',
      };
    }
    if (!res.ok) throw new Error(`Serpro Consulta CPF respondió ${res.status}`);

    const data = cpfSchema.parse(await res.json());
    this.logger.log(
      `CPF verificado contra la RFB (situación: ${data.situacao.descricao})`,
    );
    return {
      nombre: data.nome,
      nacimiento: nascimentoToIso(data.nascimento),
      situacion: data.situacao.descricao,
    };
  }

  private credentials(): { key: string; secret: string } | null {
    const key = process.env.SERPRO_CONSUMER_KEY;
    const secret = process.env.SERPRO_CONSUMER_SECRET;
    return key && secret ? { key, secret } : null;
  }

  // OAuth2 client_credentials con cache del token hasta su expiración.
  private async authenticate(credentials: {
    key: string;
    secret: string;
  }): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now())
      return this.token.value;

    const basic = Buffer.from(
      `${credentials.key}:${credentials.secret}`,
    ).toString('base64');
    const res = await fetchWithRetry(TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Serpro token respondió ${res.status}`);

    const data = tokenSchema.parse(await res.json());
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_SAFETY_MARGIN_MS,
    };
    return data.access_token;
  }
}

// Serpro entrega el nacimiento como DDMMYYYY → ISO.
function nascimentoToIso(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}
