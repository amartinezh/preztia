import type {
  BusinessDocumentFields,
  IdentityDocumentFields,
  UtilityReceiptFields,
} from "@preztiaos/domain";

// Normalización de los campos extraídos por la IA (jsonb no estructurado) a los
// tipos que consumen las reglas del dominio. Es la frontera de datos del pipeline:
// tolera alias en portugués/español, fechas dd/mm/aaaa o ISO y montos con formato
// brasileño; el dominio recibe siempre ISO y centavos enteros, o null.

/** Normaliza una clave para comparar alias: minúsculas, sin acentos ni separadores. */
function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Busca el primer valor presente entre los alias (claves normalizadas). */
function pick(fields: Record<string, unknown>, aliases: readonly string[]): unknown {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(fields)) {
    const nk = normalizeKey(key);
    if (!normalized.has(nk)) normalized.set(nk, value);
  }
  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function pickString(fields: Record<string, unknown>, aliases: readonly string[]): string | null {
  const value = pick(fields, aliases);
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

const MONTH_DAYS = "01";

/**
 * Normaliza una fecha a ISO (YYYY-MM-DD). Acepta ISO, dd/mm/aaaa y mm/aaaa
 * (mes de referencia de facturas). Devuelve null si no es interpretable.
 */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();

  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3] ?? MONTH_DAYS}`;

  const brazilian = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(text);
  if (brazilian) return `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;

  const monthOnly = /^(\d{2})[/.-](\d{4})$/.exec(text);
  if (monthOnly) return `${monthOnly[2]}-${monthOnly[1]}-${MONTH_DAYS}`;

  return null;
}

const CENTS_PER_UNIT = 100;

/**
 * Normaliza un monto a centavos enteros. Acepta números (reales con decimales)
 * y strings en formato brasileño ("R$ 1.234,56") o internacional ("1234.56").
 */
export function toMinorUnits(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * CENTS_PER_UNIT) : null;
  }
  if (typeof value !== "string") return null;

  let digits = value.replace(/[^\d.,-]/g, "");
  if (!digits) return null;
  // "1.234,56" (br) → coma decimal; "1,234.56" o "1234.56" → punto decimal.
  if (/,\d{1,2}$/.test(digits)) {
    digits = digits.replace(/\./g, "").replace(",", ".");
  } else {
    digits = digits.replace(/,/g, "");
  }
  const amount = Number(digits);
  return Number.isFinite(amount) ? Math.round(amount * CENTS_PER_UNIT) : null;
}

/** Extrae los nombres de socios del QSA en cualquiera de sus formas usuales. */
export function toPartnerNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  }
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      names.push(entry.trim());
      continue;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const name = pickString(record, ["nome_socio", "nome", "name", "socio", "nombre"]);
      if (name) names.push(name);
    }
  }
  return names;
}

/** Mapea la extracción del documento de identidad a los campos del dominio. */
export function mapIdentityFields(fields: Record<string, unknown>): IdentityDocumentFields {
  return {
    nombre: pickString(fields, ["nome", "nombre", "name", "nome_completo"]),
    cpf: pickString(fields, ["cpf", "numero_cpf"]),
    fechaNacimiento: toIsoDate(
      pick(fields, ["data_nascimento", "data_de_nascimento", "nascimento", "fecha_nacimiento"]),
    ),
    fechaEmision: toIsoDate(
      pick(fields, [
        "data_emissao",
        "data_de_emissao",
        "emissao",
        "fecha_emision",
        "data_expedicao",
        "expedicao",
      ]),
    ),
    fechaValidez: toIsoDate(pick(fields, ["validade", "data_validade", "valido_ate"])),
  };
}

/** Mapea la extracción del documento del negocio a los campos del dominio. */
export function mapBusinessFields(fields: Record<string, unknown>): BusinessDocumentFields {
  return {
    razonSocial: pickString(fields, ["razao_social", "nome_empresarial", "razon_social"]),
    cnpj: pickString(fields, ["cnpj", "numero_cnpj"]),
    capitalSocialMinor: toMinorUnits(pick(fields, ["capital_social", "capital"])),
    socios: toPartnerNames(pick(fields, ["qsa", "socios", "quadro_societario", "quadro_de_socios"])),
    cep: pickString(fields, ["cep", "codigo_postal"]),
    uf: pickString(fields, ["uf", "estado"]),
  };
}

/** Mapea la extracción del recibo de servicio público a los campos del dominio. */
export function mapUtilityFields(fields: Record<string, unknown>): UtilityReceiptFields {
  return {
    titular: pickString(fields, ["titular", "nome_cliente", "cliente", "nome", "nombre"]),
    cnpjEmisor: pickString(fields, [
      "cnpj_emissor",
      "cnpj_emisor",
      "cnpj_distribuidora",
      "cnpj_da_empresa",
      "cnpj",
    ]),
    cep: pickString(fields, ["cep", "codigo_postal"]),
    ciudad: pickString(fields, ["cidade", "municipio", "ciudad", "city"]),
    uf: pickString(fields, ["uf", "estado"]),
    fechaEmision: toIsoDate(
      pick(fields, ["data_emissao", "data_de_emissao", "emissao", "fecha_emision"]),
    ),
    mesReferencia: toIsoDate(
      pick(fields, ["mes_referencia", "referencia", "mes_ref", "competencia"]),
    ),
    vencimiento: toIsoDate(pick(fields, ["vencimento", "data_vencimento", "vencimiento"])),
    valorMinor: toMinorUnits(
      pick(fields, ["valor", "valor_total", "total", "valor_a_pagar", "total_a_pagar"]),
    ),
    lineaDigitable: pickString(fields, [
      "linha_digitavel",
      "linea_digitable",
      "codigo_de_barras",
      "codigo_barras",
    ]),
  };
}
