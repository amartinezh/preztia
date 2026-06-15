import { initClient } from "@ts-rest/core";
import {
  accountsContract,
  authContract,
  borrowerListsContract,
  borrowersContract,
  changeRequestsContract,
  collectorsContract,
  creditApplicationReviewContract,
  creditContract,
  dailyReportContract,
  expensesContract,
  iamUsersContract,
  paymentsContract,
  reportingContract,
  routesContract,
  settlementsContract,
  tenantConfigContract,
  tenantsContract,
  trackingContract,
  zonesContract,
} from "@preztiaos/contracts";

import { env } from "../env";
import { authState } from "../auth/auth-state";
import { createFetcher } from "./fetcher";
import { normalizeHttpError, type ApiError } from "../errors";

/**
 * Cliente tipado único de la app. Combina los contratos de crédito y pagos y les inyecta
 * el fetcher transversal. La identidad (token/tenant) y el cierre de sesión por 401 se
 * leen del snapshot síncrono de la sesión (`authState`).
 */
const contract = {
  ...authContract,
  ...tenantsContract,
  ...iamUsersContract,
  ...zonesContract,
  ...collectorsContract,
  ...borrowersContract,
  ...creditContract,
  ...accountsContract,
  ...expensesContract,
  ...settlementsContract,
  ...dailyReportContract,
  ...changeRequestsContract,
  ...routesContract,
  ...trackingContract,
  ...borrowerListsContract,
  ...tenantConfigContract,
  ...reportingContract,
  ...creditApplicationReviewContract,
  ...paymentsContract,
};

export const api = initClient(contract, {
  baseUrl: env.apiUrl,
  baseHeaders: {},
  api: createFetcher({
    getAccessToken: authState.getAccessToken,
    getTenantId: authState.getTenantId,
    onUnauthorized: authState.notifyUnauthorized,
  }),
});

type TsRestResponse = { status: number; body: unknown };
type SuccessStatus = 200 | 201 | 204;

/**
 * Desempaqueta una respuesta ts-rest: devuelve el cuerpo en éxito (2xx) o lanza `ApiError`
 * traducido. Toda llamada de feature pasa por aquí para que React Query trate los 4xx/5xx
 * como errores y la UI muestre un mensaje (y el `correlationId`) consistente. El tipo de
 * retorno se estrecha al cuerpo del miembro 2xx de la unión de respuestas del contrato.
 */
export function unwrap<T extends TsRestResponse>(res: T): Extract<T, { status: SuccessStatus }>["body"] {
  if (res.status >= 200 && res.status < 300) {
    return res.body as Extract<T, { status: SuccessStatus }>["body"];
  }
  throw toApiError(res);
}

function toApiError(res: TsRestResponse): ApiError {
  const body = (res.body ?? null) as { code?: unknown; message?: unknown } | null;
  return normalizeHttpError(res.status, body);
}

/** Header de tenant que exige el contrato. Proviene del JWT (no de input del usuario). */
export function tenantHeader(): { "x-tenant-id": string } {
  const tenantId = authState.getTenantId();
  if (!tenantId) throw normalizeHttpError(401, { message: "Sesión sin tenant" });
  return { "x-tenant-id": tenantId };
}
