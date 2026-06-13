// Cruce de dirección y teléfono contra los catálogos públicos (Etapa 3):
// el CEP debe existir y su ciudad/UF deben coincidir con lo impreso, y el DDD
// del teléfono del solicitante debería corresponder a la UF declarada.

import { alerta, type ValidationAlert } from "./alert";
import { namesLooselyMatch } from "./normalize-name";
import { onlyDigits } from "./taxpayer-id";

/** Registro de un CEP en el catálogo público (BrasilAPI/ViaCEP). */
export interface CepRecord {
  readonly cep: string;
  readonly state: string;
  readonly city: string;
  readonly street: string | null;
}

const CEP_LENGTH = 8;

/** ¿La cadena tiene forma de CEP (8 dígitos)? */
export function isWellFormedCep(cep: string): boolean {
  return onlyDigits(cep).length === CEP_LENGTH;
}

/**
 * Cruza el CEP impreso en un documento contra el catálogo: CEP inexistente ⇒ ALTA
 * (dirección inventada); UF distinta ⇒ ALTA; ciudad distinta ⇒ MEDIA.
 * `registro === null` significa que el catálogo NO conoce el CEP.
 */
export function crossCheckAddressAgainstCep(
  declarado: { readonly cep: string; readonly ciudad: string | null; readonly uf: string | null },
  registro: CepRecord | null,
): ValidationAlert[] {
  if (!registro) {
    return [alerta("cep", "ALTA", `el CEP ${declarado.cep} no existe en el catálogo postal`)];
  }

  const alerts: ValidationAlert[] = [];
  if (declarado.uf && declarado.uf.toUpperCase() !== registro.state.toUpperCase()) {
    alerts.push(
      alerta(
        "uf",
        "ALTA",
        `la UF declarada (${declarado.uf}) no corresponde al CEP (${registro.state})`,
      ),
    );
  }
  if (declarado.ciudad && !namesLooselyMatch(declarado.ciudad, registro.city)) {
    alerts.push(
      alerta(
        "cidade",
        "MEDIA",
        `la ciudad declarada ("${declarado.ciudad}") no corresponde al CEP ("${registro.city}")`,
      ),
    );
  }
  return alerts;
}

const BRAZIL_COUNTRY_CODE = "55";
const DDD_LENGTH = 2;
const MIN_BR_PHONE_DIGITS = 12; // 55 + DDD + 8 dígitos mínimos

/** Extrae el DDD de un teléfono brasileño E.164 sin '+'; null si no aplica. */
export function extractBrazilianDdd(phone: string): string | null {
  const digits = onlyDigits(phone);
  if (!digits.startsWith(BRAZIL_COUNTRY_CODE) || digits.length < MIN_BR_PHONE_DIGITS) {
    return null;
  }
  return digits.slice(BRAZIL_COUNTRY_CODE.length, BRAZIL_COUNTRY_CODE.length + DDD_LENGTH);
}

/**
 * Compara la UF del DDD del solicitante contra la UF de un documento. Señal
 * débil (la gente se muda manteniendo el número) ⇒ severidad MEDIA.
 */
export function crossCheckPhoneDddAgainstUf(input: {
  readonly ddd: string;
  readonly dddState: string;
  readonly documentUf: string;
}): ValidationAlert[] {
  if (input.dddState.toUpperCase() === input.documentUf.toUpperCase()) return [];
  return [
    alerta(
      "ddd",
      "MEDIA",
      `el DDD del teléfono (${input.ddd} → ${input.dddState}) no corresponde a la UF del documento (${input.documentUf})`,
    ),
  ];
}
