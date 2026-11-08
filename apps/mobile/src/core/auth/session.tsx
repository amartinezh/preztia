import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { api, unwrap } from "../api/client";
import { queryClient } from "../query";
import { logger } from "../logger";
import { authState } from "./auth-state";
import { decodeSessionClaims, type SessionClaims, type UserRole } from "./jwt";
import { applySessionTokens, msUntilRefresh, needsRefresh, REFRESH_RETRY_MS, refreshSession } from "./refresh";
import { tokenStorage, type StoredTokens } from "./token-storage";

type Status = "loading" | "authenticated" | "unauthenticated";

/** Por qué se cerró la sesión: la persona lo pidió o el servidor dejó de aceptar el token. */
export type SignOutReason = "user" | "expired";

type SessionContextValue = {
  status: Status;
  claims: SessionClaims | null;
  role: UserRole | null;
  /** Motivo del último cierre de sesión (para explicarlo en la pantalla de acceso). */
  lastSignOutReason: SignOutReason | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: (reason?: SignOutReason) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Provee la sesión a la app y mantiene sincronizado el snapshot del transporte (`authState`).
 * La identidad (tenant/rol/zonas) se DERIVA de los claims del JWT; el usuario nunca la elige.
 * La sesión se renueva sola antes de vencer (ver `refreshSession`): nadie es expulsado a los
 * 15 minutos mientras el refresh token siga siendo válido.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [claims, setClaims] = useState<SessionClaims | null>(null);
  const [lastSignOutReason, setLastSignOutReason] = useState<SignOutReason | null>(null);

  const signOut = useMemo(
    () => async (reason: SignOutReason = "user"): Promise<void> => {
      await tokenStorage.clear();
      authState.clear();
      queryClient.clear(); // no filtrar datos de un tenant a la siguiente sesión
      setClaims(null);
      setLastSignOutReason(reason);
      setStatus("unauthenticated");
    },
    [],
  );

  // Aplica tokens válidos a memoria + almacenamiento seguro + snapshot del transporte.
  const applyTokens = useMemo(
    () =>
      async (tokens: StoredTokens): Promise<void> => {
        const decoded = await applySessionTokens(tokens);
        if (!decoded) {
          await signOut("expired");
          return;
        }
        setClaims(decoded);
        setStatus("authenticated");
      },
    [signOut],
  );

  const signIn = useMemo(
    () =>
      async (email: string, password: string): Promise<void> => {
        const tokens = unwrap(await api.login({ body: { email, password } }));
        await applyTokens(tokens);
        setLastSignOutReason(null);
        logger.info("session_signed_in", { tenantId: authState.getTenantId() ?? undefined });
      },
    [applyTokens],
  );

  // El transporte renueva ante un 401 y, si la renovación es rechazada, cierra sesión (token
  // vencido o revocado). Un 401 del propio login (contraseña errónea) no es una sesión expirada:
  // ahí no había sesión.
  useEffect(() => {
    authState.registerRefreshHandler(refreshSession);
    authState.registerUnauthorizedHandler(() => {
      if (authState.getAccessToken()) void signOut("expired");
    });
  }, [signOut]);

  // Los claims renovados por el transporte (fuera de React) se reflejan en el contexto.
  useEffect(() => authState.subscribe((next) => setClaims((prev) => (next === prev ? prev : next))), []);

  // Rehidratación inicial desde almacenamiento seguro. Si el access token ya venció pero hay
  // refresh token, se intenta renovar antes de mandar a la persona al login.
  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await tokenStorage.load();
      if (!active) return;
      if (!stored) {
        setStatus("unauthenticated");
        return;
      }
      const decoded = decodeSessionClaims(stored.accessToken);
      if (decoded && !needsRefresh(decoded)) {
        await applyTokens(stored);
        return;
      }
      if (!decoded || !stored.refreshToken) {
        await signOut("expired");
        return;
      }
      // Access vencido (o por vencer) con refresh token: el snapshot recibe el refresh token y
      // se renueva. Sin red se conserva la sesión con los claims guardados (la cola offline y el
      // temporizador siguen funcionando); el transporte renovará en cuanto haya señal.
      authState.set({ accessToken: stored.accessToken, refreshToken: stored.refreshToken, claims: decoded });
      const outcome = await refreshSession();
      if (!active) return;
      if (outcome === "rejected") {
        await signOut("expired");
        return;
      }
      setClaims(authState.getClaims());
      setStatus("authenticated");
    })();
    return () => {
      active = false;
    };
  }, [applyTokens, signOut]);

  // Renovación PROACTIVA: un temporizador renueva cuando faltan < 2 min para `exp`. Cada par de
  // tokens nuevo cambia `claims` y reprograma el siguiente. Sin red se reintenta al rato.
  useEffect(() => {
    if (status !== "authenticated" || !claims) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delayMs: number) => {
      timer = setTimeout(() => {
        void refreshSession().then((outcome) => {
          if (cancelled) return;
          if (outcome === "rejected") void signOut("expired");
          else if (outcome === "unavailable") schedule(REFRESH_RETRY_MS);
        });
      }, delayMs);
    };
    schedule(msUntilRefresh(claims));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [claims, status, signOut]);

  // En nativo los temporizadores no corren en segundo plano: al volver al frente, si el token ya
  // está por vencer, se renueva de inmediato en vez de esperar al primer 401.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const current = authState.getClaims();
      if (state === "active" && current && needsRefresh(current)) {
        void refreshSession().then((outcome) => {
          if (outcome === "rejected") void signOut("expired");
        });
      }
    });
    return () => subscription.remove();
  }, [signOut]);

  const value = useMemo<SessionContextValue>(
    () => ({ status, claims, role: claims?.role ?? null, lastSignOutReason, signIn, signOut }),
    [status, claims, lastSignOutReason, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession debe usarse dentro de <SessionProvider>");
  return ctx;
}
