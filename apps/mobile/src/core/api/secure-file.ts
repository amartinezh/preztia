import { useQuery } from "@tanstack/react-query";

import { authState } from "../auth/auth-state";
import { env } from "../env";
import { normalizeHttpError } from "../errors";

/**
 * Descarga AUTENTICADA de un archivo sensible (comprobantes descifrados por el backend) como
 * objectURL listo para mostrar. El backend lo sirve con `no-store`; quien lo muestra debe liberar
 * la URL al cerrar (no deja evidencia/PII en memoria).
 */
export async function fetchSecureFileUrl(path: string): Promise<{ url: string; mimeType: string }> {
  const token = authState.getAccessToken();
  const tenantId = authState.getTenantId();
  if (!token || !tenantId) throw normalizeHttpError(401, { message: "Sesión sin tenant" });

  const res = await fetch(`${env.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
  });
  if (!res.ok) throw normalizeHttpError(res.status, { message: "No se pudo abrir el comprobante" });
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), mimeType: res.headers.get("Content-Type") ?? blob.type };
}

/** Archivo seguro como objectURL, solo mientras hay una ruta seleccionada (sin caché persistente). */
export function useSecureFileUrl(path: string | null) {
  return useQuery({
    queryKey: ["secure-file", path],
    enabled: path != null,
    gcTime: 0,
    staleTime: Infinity,
    queryFn: async () => fetchSecureFileUrl(path as string),
  });
}
