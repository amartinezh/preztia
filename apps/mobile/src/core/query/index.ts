import { QueryClient } from "@tanstack/react-query";

import { isApiError } from "../errors";

/**
 * Cliente de React Query de la app.
 *
 * - Las QUERIES reintentan con prudencia, pero NUNCA ante 4xx (auth/validación): reintentar
 *   un 401/403/404 no ayuda y oculta el problema.
 * - Las MUTATIONS no reintentan por defecto: el reintento seguro de dinero lo gobierna la
 *   capa de transporte (con `Idempotency-Key`) y la cola offline, no React Query.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
