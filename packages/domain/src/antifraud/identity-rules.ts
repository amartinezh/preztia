// Reglas locales (Etapa 2) sobre el documento de identidad brasilero
// (CNH, CIN, RG, CPF): estructura del CPF y coherencia de fechas. No conocen
// I/O: reciben los campos ya extraídos y normalizados por la capa de aplicación.

import { alerta, type ValidationAlert } from "./alert";
import { parseIsoDate, yearsBetween } from "./dates";
import { namesLooselyMatch } from "./normalize-name";
import { isValidCpf } from "./taxpayer-id";

/** Campos del documento de identidad ya normalizados (fechas en ISO). */
export interface IdentityDocumentFields {
  readonly nombre: string | null;
  readonly cpf: string | null;
  readonly fechaNacimiento: string | null;
  readonly fechaEmision: string | null;
  /** Vigencia (campo "Validade" de la CNH); null si el documento no vence. */
  readonly fechaValidez: string | null;
}

/** Edad mínima para actuar como representante legal de la solicitud. */
const LEGAL_AGE_YEARS = 18;

/** Valida estructura y coherencia interna del documento de identidad. */
export function reviewIdentityDocument(
  fields: IdentityDocumentFields,
  hoy: Date,
): ValidationAlert[] {
  const alerts: ValidationAlert[] = [];

  if (!fields.cpf) {
    alerts.push(alerta("cpf", "MEDIA", "no se pudo leer el CPF del documento"));
  } else if (!isValidCpf(fields.cpf)) {
    alerts.push(
      alerta("cpf", "ALTA", "el CPF no supera la validación de dígito verificador (mod-11)"),
    );
  }

  const nacimiento = parseIsoDate(fields.fechaNacimiento);
  const emision = parseIsoDate(fields.fechaEmision);
  const validez = parseIsoDate(fields.fechaValidez);

  if (nacimiento && nacimiento.getTime() > hoy.getTime()) {
    alerts.push(alerta("fecha_nacimiento", "ALTA", "la fecha de nacimiento es futura"));
  }
  if (emision && emision.getTime() > hoy.getTime()) {
    alerts.push(alerta("fecha_emision", "ALTA", "la fecha de emisión es futura"));
  }
  if (nacimiento && emision && nacimiento.getTime() >= emision.getTime()) {
    alerts.push(
      alerta(
        "fecha_emision",
        "ALTA",
        "la fecha de emisión es anterior o igual a la fecha de nacimiento",
      ),
    );
  }
  if (nacimiento && nacimiento.getTime() <= hoy.getTime()) {
    const edad = yearsBetween(nacimiento, hoy);
    if (edad < LEGAL_AGE_YEARS) {
      alerts.push(
        alerta(
          "fecha_nacimiento",
          "ALTA",
          `el titular tiene ${edad} años: el representante legal debe ser mayor de ${LEGAL_AGE_YEARS}`,
        ),
      );
    }
  }
  if (validez && validez.getTime() < hoy.getTime()) {
    alerts.push(
      alerta("validade", "MEDIA", `el documento está vencido (validez ${fields.fechaValidez})`),
    );
  }

  return alerts;
}

/** Registro del CPF en la base de la Receita Federal (vía Serpro, Etapa 4). */
export interface CpfRegistryRecord {
  readonly nombre: string;
  /** Fecha de nacimiento ISO; null si la fuente no la entrega. */
  readonly nacimiento: string | null;
  /** Situación cadastral textual: Regular, Suspensa, Cancelada, Nula, Falecido… */
  readonly situacion: string;
}

// Situaciones cadastrales que invalidan al titular como sujeto de crédito.
const TERMINAL_CPF_SITUATIONS = ["CANCELADA", "NULA", "FALECIDO"] as const;
const REGULAR_CPF_SITUATION = "REGULAR";

/**
 * Cruza identidad extraída vs base RFB (Etapa 4, fuente emisora):
 * un mismatch de nombre o nacimiento contra la fuente oficial es fraude probable.
 */
export function crossCheckIdentityAgainstCpfRegistry(
  fields: IdentityDocumentFields,
  registro: CpfRegistryRecord,
): ValidationAlert[] {
  const alerts: ValidationAlert[] = [];

  const situacion = registro.situacion.toUpperCase();
  if (TERMINAL_CPF_SITUATIONS.some((terminal) => situacion.includes(terminal))) {
    alerts.push(
      alerta("cpf", "CRITICA", `situación cadastral del CPF: ${registro.situacion}`),
    );
  } else if (!situacion.includes(REGULAR_CPF_SITUATION)) {
    alerts.push(
      alerta("cpf", "ALTA", `situación cadastral del CPF no regular: ${registro.situacion}`),
    );
  }

  if (fields.nombre && !namesLooselyMatch(fields.nombre, registro.nombre)) {
    alerts.push(
      alerta(
        "nombre",
        "CRITICA",
        "el nombre del documento no coincide con el registrado en la Receita Federal",
      ),
    );
  }
  if (
    fields.fechaNacimiento &&
    registro.nacimiento &&
    fields.fechaNacimiento !== registro.nacimiento
  ) {
    alerts.push(
      alerta(
        "fecha_nacimiento",
        "ALTA",
        "la fecha de nacimiento no coincide con la registrada en la Receita Federal",
      ),
    );
  }

  return alerts;
}
