// Registro SEMILLA de ISPB (8 dígitos) → institución, para verificar que el participante que
// emitió el EndToEndId del PIX corresponde a una institución real. Es un subconjunto curado de
// los PSPs más comunes (fuente: lista de participantes del STR/Pix del Banco Central). Un ISPB
// con formato válido pero AUSENTE aquí no prueba fraude (la lista es incompleta): se trata como
// señal blanda (revisar), nunca como rechazo. Ampliar con la tabla oficial completa del Bacen.
export const KNOWN_ISPB: ReadonlyMap<string, string> = new Map([
  ["00000000", "Banco do Brasil"],
  ["00360305", "Caixa Econômica Federal"],
  ["60746948", "Bradesco"],
  ["60701190", "Itaú Unibanco"],
  ["90400888", "Santander"],
  ["00416968", "Banco Inter"],
  ["18236120", "Nubank (Nu Pagamentos)"],
  ["10573521", "Mercado Pago"],
  ["22896431", "PicPay"],
  ["31872495", "C6 Bank"],
  ["30306294", "BTG Pactual"],
  ["08561701", "PagBank (PagSeguro)"],
  ["16501555", "Stone"],
  ["01181521", "Sicredi"],
  ["02038232", "Sicoob (Bancoob)"],
  ["58160789", "Banco Safra"],
  ["92894922", "Banco Original"],
]);

/** ¿El ISPB está en el registro conocido? (formato ya validado por `analyzeE2EId`). */
export function isKnownIspb(ispb: string): boolean {
  return KNOWN_ISPB.has(ispb);
}

/** Nombre de la institución del ISPB, o `null` si no está en el registro semilla. */
export function institutionForIspb(ispb: string): string | null {
  return KNOWN_ISPB.get(ispb) ?? null;
}
