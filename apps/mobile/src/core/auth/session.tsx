import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, unwrap } from "../api/client";
import { queryClient } from "../query";
import { logger } from "../logger";
import { authState } from "./auth-state";
import { decodeSessionClaims, isExpired, type SessionClaims, type UserRole } from "./jwt";
import { tokenStorage, type StoredTokens } from "./token-storage";

type Status = "loading" | "authenticated" | "unauthenticated";

type SessionContextValue = {
  status: Status;
  claims: SessionClaims | null;
  role: UserRole | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Provee la sesión a la app y mantiene sincronizado el snapshot del transporte (`authState`).
 * La identidad (tenant/rol/zonas) se DERIVA de los claims del JWT; el usuario nunca la elige.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [claims, setClaims] = useState<SessionClaims | null>(null);

  // Aplica tokens válidos a memoria + almacenamiento seguro + snapshot del transporte.
  const applyTokens = useMemo(
    () =>
      async (tokens: StoredTokens): Promise<void> => {
        const decoded = decodeSessionClaims(tokens.accessToken);
        if (!decoded || isExpired(decoded)) {
          await tokenStorage.clear();
          authState.clear();
          setClaims(null);
          setStatus("unauthenticated");
          return;
        }
        authState.set({ accessToken: tokens.accessToken, claims: decoded });
        await tokenStorage.save(tokens);
        setClaims(decoded);
        setStatus("authenticated");
      },
    [],
  );

  const signOut = useMemo(
    () => async (): Promise<void> => {
      await tokenStorage.clear();
      authState.clear();
      queryClient.clear(); // no filtrar datos de un tenant a la siguiente sesión
      setClaims(null);
      setStatus("unauthenticated");
    },
    [],
  );

  const signIn = useMemo(
    () =>
      async (email: string, password: string): Promise<void> => {
        const tokens = unwrap(await api.login({ body: { email, password } }));
        await applyTokens(tokens);
        logger.info("session_signed_in", { tenantId: authState.getTenantId() ?? undefined });
      },
    [applyTokens],
  );

  // El transporte cierra sesión ante un 401 del backend.
  useEffect(() => {
    authState.registerUnauthorizedHandler(() => {
      void signOut();
    });
  }, [signOut]);

  // Rehidratación inicial desde almacenamiento seguro.
  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await tokenStorage.load();
      if (!active) return;
      if (stored) await applyTokens(stored);
      else setStatus("unauthenticated");
    })();
    return () => {
      active = false;
    };
  }, [applyTokens]);

  const value = useMemo<SessionContextValue>(
    () => ({ status, claims, role: claims?.role ?? null, signIn, signOut }),
    [status, claims, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession debe usarse dentro de <SessionProvider>");
  return ctx;
}
