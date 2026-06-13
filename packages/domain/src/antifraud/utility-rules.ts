// Reglas sobre el recibo de servicio público ("comprovante de residência").
// No existe fuente emisora consultable para estas facturas, así que el máximo
// alcanzable es un score de riesgo: estructura FEBRABAN + coherencia de fechas
// (Etapa 2) y verificación del CNPJ emisor contra la Receita (Etapa 3).

import { alerta, type ValidationAlert } from "./alert";
import { differenceInDays, parseIsoDate } from "./dates";
import { reviewLinhaDigitavel } from "./febraban";
import { isValidCnpj } from "./taxpayer-id";
import { type CnpjRegistryRecord } from "./business-rules";

/** Campos del recibo de servicio público ya normalizados. */
export interface UtilityReceiptFields {
  readonly titular: string | null;
  readonly cnpjEmisor: string | null;
  readonly cep: string | null;
  readonly ciudad: string | null;
  readonly uf: string | null;
  readonly fechaEmision: string | null;
  /** Mes de referencia en ISO (primer día del mes), p. ej. "2026-05-01". */
  readonly mesReferencia: string | null;
  readonly vencimiento: string | null;
  /** Valor impreso en centavos; null si no se pudo extraer. */
  readonly valorMinor: number | null;
  readonly lineaDigitable: string | null;
}

/** Vigencia de mercado de un comprobante de residencia. */
const MAX_RECEIPT_AGE_DAYS = 90;

/**
 * Prefijos CNAE de los sectores que emiten cuentas de servicios domiciliarios:
 * 35 = energía eléctrica/gas, 36 = captación/distribución de agua,
 * 37 = alcantarillado, 61 = telecomunicaciones.
 */
const UTILITY_CNAE_PREFIXES = ["35", "36", "37", "61"] as const;

const ACTIVE_SITUATION = "ATIVA";

/** Validación local (Etapa 2): fechas, valor vs código de barras, CNPJ emisor. */
export function reviewUtilityReceipt(
  fields: UtilityReceiptFields,
  hoy: Date,
): ValidationAlert[] {
  const alerts: ValidationAlert[] = [];

  const emision = parseIsoDate(fields.fechaEmision);
  if (!emision) {
    alerts.push(alerta("data_emissao", "MEDIA", "no se pudo leer la fecha de emisión"));
  } else if (emision.getTime() > hoy.getTime()) {
    alerts.push(alerta("data_emissao", "ALTA", "la fecha de emisión es futura"));
  } else if (differenceInDays(emision, hoy) > MAX_RECEIPT_AGE_DAYS) {
    alerts.push(
      alerta(
        "data_emissao",
        "ALTA",
        `el comprobante tiene más de ${MAX_RECEIPT_AGE_DAYS} días (emitido ${fields.fechaEmision})`,
      ),
    );
  }

  const referencia = parseIsoDate(fields.mesReferencia);
  const vencimiento = parseIsoDate(fields.vencimiento);
  if (referencia && vencimiento && vencimiento.getTime() < referencia.getTime()) {
    alerts.push(
      alerta(
        "vencimento",
        "MEDIA",
        "el vencimiento es anterior al mes de referencia de la factura",
      ),
    );
  }

  if (fields.cnpjEmisor && !isValidCnpj(fields.cnpjEmisor)) {
    alerts.push(
      alerta(
        "cnpj_emissor",
        "ALTA",
        "el CNPJ del emisor no supera la validación de dígito verificador (mod-11)",
      ),
    );
  }

  if (fields.lineaDigitable) {
    alerts.push(
      ...reviewLinhaDigitavel({
        linha: fields.lineaDigitable,
        valorImpresoMinor: fields.valorMinor,
      }),
    );
  }

  return alerts;
}

/**
 * Cruce del emisor contra la Receita Federal (Etapa 3): una "cuenta de luz"
 * emitida por un CNPJ inexistente, inactivo o con CNAE de otro rubro es fraude.
 */
export function crossCheckUtilityIssuerAgainstRegistry(
  registro: CnpjRegistryRecord,
): ValidationAlert[] {
  const alerts: ValidationAlert[] = [];

  if (registro.situacionCadastral.toUpperCase() !== ACTIVE_SITUATION) {
    alerts.push(
      alerta(
        "cnpj_emissor",
        "ALTA",
        `el CNPJ emisor no está activo en la Receita Federal (situación: ${registro.situacionCadastral})`,
      ),
    );
  }

  const cnae = registro.cnaeFiscal;
  if (cnae) {
    const isUtilitySector = UTILITY_CNAE_PREFIXES.some((prefix) => cnae.startsWith(prefix));
    if (!isUtilitySector) {
      alerts.push(
        alerta(
          "cnae_fiscal",
          "CRITICA",
          `el CNAE del emisor (${cnae}: ${registro.cnaeDescripcion ?? "?"}) no corresponde a un prestador de servicios públicos`,
        ),
      );
    }
  }

  return alerts;
}
