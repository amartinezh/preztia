import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { flush, pendingCount } from "./queue";

/**
 * Dispara el vaciado de la cola offline al montar y cuando el navegador recupera red (web).
 * En nativo, el vaciado se intenta al montar y tras cada operación; un disparo por
 * conectividad (NetInfo) queda como mejora. Devuelve el número de operaciones pendientes
 * para mostrar un banner de degradación elegante.
 */
export function useOfflineSync(): { pending: number; sync: () => void } {
  const [pending, setPending] = useState(0);

  const sync = () => {
    void (async () => {
      await flush();
      setPending(await pendingCount());
    })();
  };

  useEffect(() => {
    sync();
    if (Platform.OS === "web" && typeof globalThis.addEventListener === "function") {
      const handler = () => sync();
      globalThis.addEventListener("online", handler);
      return () => globalThis.removeEventListener("online", handler);
    }
    return undefined;
  }, []);

  return { pending, sync };
}
