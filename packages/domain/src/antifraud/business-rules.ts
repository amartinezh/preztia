// Reglas sobre el documento de registro del negocio (cartão CNPJ, contrato
// social, CCMEI): validación local del CNPJ (Etapa 2) y cruce campo a campo
// contra el registro oficial de la Receita Federal (Etapa 3, vía Minha Receita).
// Un contrato adulterado para inflar capital o agregar un socio falso cae aquí.

import { alerta, type ValidationAlert } from "./alert";
import { monthsBetween, parseIsoDate } from "./dates";
import { nameMatchesAny, namesLooselyMatch } from "./normalize-name";
import { isValidCnpj, onlyDigits } from "./taxpayer-id";

/** Campos del documento del negocio ya normalizados por la capa de aplicación. */
export interface BusinessDocumentFields {
  readonly razonSocial: string | null;
  readonly cnpj: string | null;
  /** Capital social en centavos (entero); null si no se pudo extraer. */
  readonly capitalSocialMinor: number | null;
  /** Nombres de los socios (QSA) que figuran en el documento. */
  readonly socios: readonly string[];
  readonly cep: string | null;
  readonly uf: string | null;
}

/** Registro oficial del CNPJ (Receita Federal vía Minha Receita / BrasilAPI). */
export interface CnpjRegistryRecord {
  readonly cnpj: string;
  readonly razonSocial: string;
  /** Descripción de la situación cadastral (p. ej. "ATIVA", "BAIXADA"). */
  readonly situacionCadastral: string;
  readonly fechaInicioActividad: string | null;
  /** CNAE fiscal principal como dígitos (p. ej. "3514000"). */
  readonly cnaeFiscal: string | null;
  readonly cnaeDescripcion: string | null;
  readonly municipio: string | null;
  readonly uf: string | null;
  readonly cep: string | null;
  /** Capital social en centavos; null si la fuente no lo entrega. */
  readonly capitalSocialMinor: number | null;
  /** Nombres del cuadro societario (QSA) registrado. */
  readonly socios: readonly string[];
}

const ACTIVE_SITUATION = "ATIVA";

/** Antigüedad mínima del negocio antes de escalar a debida diligencia (EDD). */
const MIN_BUSINESS_AGE_MONTHS = 6;

/** Validación local (Etapa 2): estructura del CNPJ del documento. */
export function reviewBusinessDocument(fields: BusinessDocumentFields): ValidationAlert[] {
  const alerts: ValidationAlert[] = [];
  if (!fields.cnpj) {
    alerts.push(alerta("cnpj", "MEDIA", "no se pudo leer el CNPJ del documento"));
  } else if (!isValidCnpj(fields.cnpj)) {
    alerts.push(
      alerta("cnpj", "ALTA", "el CNPJ no supera la validación de dígito verificador (mod-11)"),
    );
  }
  return alerts;
}

/**
 * Cruce campo a campo del documento vs el registro oficial (Etapa 3).
 *
 * Invariantes (cubiertos por pruebas):
 * - situación cadastral distinta de ATIVA ⇒ CRITICA (nunca aprobado);
 * - socio del documento ausente en el QSA oficial ⇒ CRITICA;
 * - razón social distinta ⇒ ALTA; capital distinto ⇒ MEDIA; CEP/UF distintos ⇒ MEDIA;
 * - negocio con menos de 6 meses de actividad ⇒ MEDIA (escalar a EDD).
 */
export function crossCheckBusinessAgainstRegistry(
  fields: BusinessDocumentFields,
  registro: CnpjRegistryRecord,
  hoy: Date,
): ValidationAlert[] {
  const alerts: ValidationAlert[] = [];

  if (registro.situacionCadastral.toUpperCase() !== ACTIVE_SITUATION) {
    alerts.push(
      alerta(
        "situacao_cadastral",
        "CRITICA",
        `el CNPJ no está activo en la Receita Federal (situación: ${registro.situacionCadastral})`,
      ),
    );
  }

  if (fields.razonSocial && !namesLooselyMatch(fields.razonSocial, registro.razonSocial)) {
    alerts.push(
      alerta(
        "razao_social",
        "ALTA",
        `la razón social del documento ("${fields.razonSocial}") no coincide con la registrada ("${registro.razonSocial}")`,
      ),
    );
  }

  const sociosFaltantes = fields.socios.filter(
    (socio) => !nameMatchesAny(socio, registro.socios),
  );
  if (registro.socios.length > 0 && sociosFaltantes.length > 0) {
    alerts.push(
      alerta(
        "qsa",
        "CRITICA",
        `socios del documento ausentes en el QSA oficial: ${sociosFaltantes.join(", ")}`,
      ),
    );
  }

  if (
    fields.capitalSocialMinor !== null &&
    registro.capitalSocialMinor !== null &&
    fields.capitalSocialMinor !== registro.capitalSocialMinor
  ) {
    alerts.push(
      alerta(
        "capital_social",
        "MEDIA",
        `el capital social del documento (${fields.capitalSocialMinor} centavos) difiere del registrado (${registro.capitalSocialMinor} centavos)`,
      ),
    );
  }

  if (fields.cep && registro.cep && onlyDigits(fields.cep) !== onlyDigits(registro.cep)) {
    alerts.push(
      alerta("cep", "MEDIA", "el CEP del documento no coincide con el registrado en la Receita"),
    );
  }
  if (fields.uf && registro.uf && fields.uf.toUpperCase() !== registro.uf.toUpperCase()) {
    alerts.push(
      alerta("uf", "MEDIA", "la UF del documento no coincide con la registrada en la Receita"),
    );
  }

  const inicio = parseIsoDate(registro.fechaInicioActividad);
  if (inicio && monthsBetween(inicio, hoy) < MIN_BUSINESS_AGE_MONTHS) {
    alerts.push(
      alerta(
        "data_inicio_atividade",
        "MEDIA",
        `el negocio tiene menos de ${MIN_BUSINESS_AGE_MONTHS} meses de actividad: escalar a debida diligencia reforzada (EDD)`,
      ),
    );
  }

  return alerts;
}
