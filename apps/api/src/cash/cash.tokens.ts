// Token de inyección del puerto de saldo bancario; el módulo lo mapea al registro por
// (país, banco) — mismo patrón que BANK_PAYMENT_VERIFIER del slice de pagos.
export const BANK_BALANCE_PROVIDER = Symbol('BankBalanceProvider');
