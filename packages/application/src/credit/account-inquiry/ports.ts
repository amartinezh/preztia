// Puertos del slice de CONSULTA DE CUENTA por WhatsApp (el cliente pide su saldo o el movimiento de
// sus pagos). La aplicación los define; la infraestructura (Drizzle) los implementa. Es un read
// model: solo lee la cartera del cliente y sus abonos, sin mutar nada.

/** Un abono del cliente para el listado de movimientos. */
export interface BorrowerAccountMovement {
  /** Fecha del abono (ISO `YYYY-MM-DD`). */
  readonly date: string;
  readonly amountMinor: number;
}

/** Estado de UN crédito activo del cliente: agregados de cartera + abonos recientes. */
export interface BorrowerCredit {
  /** Fecha de inicio del crédito (ISO `YYYY-MM-DD`), para distinguirlo cuando hay varios. */
  readonly startDate: string;
  /** Valor total a pagar del crédito (Σ cuotas). */
  readonly totalDueMinor: number;
  /** Total abonado a la fecha. */
  readonly totalPaidMinor: number;
  /** Saldo pendiente = total − abonado (nunca negativo). */
  readonly outstandingMinor: number;
  /** Lo que debe a la fecha para estar al día (vencido a hoy, incluida la cuota de hoy). */
  readonly dueTodayMinor: number;
  /** Saldo en mora (estrictamente atrasado: vencido antes de hoy, sin pagar). 0 si está al día. */
  readonly overdueMinor: number;
  /** Abonos del crédito, del más reciente al más antiguo (ya limitados por el adaptador). */
  readonly movements: readonly BorrowerAccountMovement[];
}

/**
 * Estado de cuenta del cliente. Un mismo teléfono puede tener VARIOS créditos activos (otorgados por
 * WhatsApp o por el panel), por lo que se listan todos.
 */
export interface BorrowerAccount {
  readonly tenantId: string;
  readonly firstName: string;
  readonly currency: string;
  /** Créditos activos del cliente, del más reciente al más antiguo. Al menos uno. */
  readonly credits: readonly BorrowerCredit[];
}

/**
 * Read model de la cuenta para la consulta conversacional. Resuelve el tenant por el canal (el
 * webhook no lo trae) y busca TODOS los créditos ACTIVOS del teléfono. `null` si no hay ninguno.
 */
export interface BorrowerAccountReader {
  findAccountByPhone(input: {
    channelId: string;
    phone: string;
  }): Promise<BorrowerAccount | null>;
}
