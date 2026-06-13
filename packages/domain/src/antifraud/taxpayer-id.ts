// Validación local de identificadores tributarios de Brasil (CPF y CNPJ) por
// dígito verificador módulo 11. Detecta números inventados sin salir a la red:
// es la primera barrera del antifraude (Etapa 2, $0, <1ms).

const CPF_LENGTH = 11;
const CNPJ_LENGTH = 14;

/** Deja solo los dígitos de un identificador (quita puntos, guiones, barras). */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function digitAt(digits: string, index: number): number {
  return digits.charCodeAt(index) - 48;
}

function allSameDigit(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

/** DV de CPF: pesos decrecientes desde `firstWeight`; (suma*10 % 11) % 10. */
function cpfCheckDigit(digits: string, length: number, firstWeight: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) sum += digitAt(digits, i) * (firstWeight - i);
  return ((sum * 10) % 11) % 10;
}

/** ¿El CPF tiene estructura y dígitos verificadores válidos (mod-11)? */
export function isValidCpf(cpf: string): boolean {
  const digits = onlyDigits(cpf);
  if (digits.length !== CPF_LENGTH || allSameDigit(digits)) return false;
  return (
    cpfCheckDigit(digits, 9, 10) === digitAt(digits, 9) &&
    cpfCheckDigit(digits, 10, 11) === digitAt(digits, 10)
  );
}

// Pesos oficiales del CNPJ para el primer y segundo dígito verificador.
const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

function cnpjCheckDigit(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += digitAt(digits, i) * (weights[i] ?? 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** ¿El CNPJ tiene estructura y dígitos verificadores válidos (mod-11)? */
export function isValidCnpj(cnpj: string): boolean {
  const digits = onlyDigits(cnpj);
  if (digits.length !== CNPJ_LENGTH || allSameDigit(digits)) return false;
  return (
    cnpjCheckDigit(digits, CNPJ_FIRST_WEIGHTS) === digitAt(digits, 12) &&
    cnpjCheckDigit(digits, CNPJ_SECOND_WEIGHTS) === digitAt(digits, 13)
  );
}
