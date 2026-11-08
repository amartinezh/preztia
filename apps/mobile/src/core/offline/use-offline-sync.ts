import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { flush, pendingCount, subscribePending, type FlushResult } from "./queue";

type SyncOutcome = Pick<FlushResult, "processed" | "dropped">;

/**
 * Dispara el vaciado de la cola offline al montar, cuando el navegador recupera red (web) y cada
 * vez que la app vuelve al frente (nativo: un cobro tomado sin señal a las 9:00 no debe esperar al
 * reinicio). Devuelve el número de operaciones pendientes para el banner y notifica cada barrido
 * con envíos o descartes para que la pantalla se lo diga a la persona (nunca en silencio).
 */
export function useOfflineSync(onOutcome?: (outcome: SyncOutcome) => void): {
  pending: number;
  sync: () => void;
} {
  const [pending, setPending] = useState(0);
  // El callback vive en un ref para que `sync` sea estable y lea siempre la versión más reciente.
  const onOutcomeRef = useRef(onOutcome);
  useEffect(() => {
    onOutcomeRef.current = onOutcome;
  }, [onOutcome]);

  const sync = () => {
    void (async () => {
      const result = await flush();
      setPending(result.remaining);
      if (result.processed > 0 || result.dropped > 0) {
        onOutcomeRef.current?.({ processed: result.processed, dropped: result.dropped });
      }
    })();
  };

  useEffect(() => {
    sync();
    void pendingCount().then(setPending);
    const unsubscribe = subscribePending(setPending);

    if (Platform.OS === "web" && typeof globalThis.addEventListener === "function") {
      const handler = () => sync();
      globalThis.addEventListener("online", handler);
      return () => {
        globalThis.removeEventListener("online", handler);
        unsubscribe();
      };
    }

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, []);

  return { pending, sync };
}
