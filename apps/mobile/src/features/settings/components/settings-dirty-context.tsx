import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";

type DirtyRegistry = Readonly<Record<string, true>>;

type SettingsDirtyValue = {
  /** ¿Alguna sección registrada tiene un borrador sin guardar? */
  isDirty: boolean;
  /** Registra (o limpia) el borrador de una sección identificada por una clave estable. */
  setDirty: (sectionKey: string, dirty: boolean) => void;
  /** Olvida todos los borradores (cuando la persona elige descartar). */
  clearAll: () => void;
};

const SettingsDirtyContext = createContext<SettingsDirtyValue | null>(null);

/**
 * Registro de "cambios sin guardar" de Ajustes. Cada formulario con borrador se anota con
 * `useSettingsDirty`; el layout consulta `isDirty` antes de cambiar de pestaña y, en web, el
 * navegador avisa antes de cerrar o recargar la página mientras haya un borrador (`beforeunload`).
 * El registro es por clave para que varias tarjetas de una misma pestaña convivan sin pisarse.
 */
export function SettingsDirtyProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<DirtyRegistry>({});
  const isDirty = Object.keys(registry).length > 0;

  const setDirty = useCallback((sectionKey: string, dirty: boolean) => {
    setRegistry((prev) => {
      if (dirty === sectionKey in prev) return prev;
      if (dirty) return { ...prev, [sectionKey]: true };
      const next: Record<string, true> = { ...prev };
      delete next[sectionKey];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setRegistry({}), []);

  // Web: recargar o cerrar la pestaña del navegador con un borrador pide confirmación.
  useEffect(() => {
    if (Platform.OS !== "web" || !isDirty) return;
    if (typeof globalThis.addEventListener !== "function") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Algunos navegadores solo muestran el aviso si `returnValue` queda definido.
      event.returnValue = "";
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const value = useMemo<SettingsDirtyValue>(
    () => ({ isDirty, setDirty, clearAll }),
    [isDirty, setDirty, clearAll],
  );

  return <SettingsDirtyContext.Provider value={value}>{children}</SettingsDirtyContext.Provider>;
}

/**
 * Anota en el registro si ESTE formulario tiene cambios sin guardar. Al desmontar se limpia solo
 * (cambiar de pestaña tras descartar no deja borradores fantasma). Fuera del proveedor no hace nada:
 * los tabs también se pueden renderizar sueltos.
 */
export function useSettingsDirty(sectionKey: string, dirty: boolean): void {
  const setDirty = useContext(SettingsDirtyContext)?.setDirty;
  useEffect(() => {
    setDirty?.(sectionKey, dirty);
  }, [setDirty, sectionKey, dirty]);
  useEffect(() => () => setDirty?.(sectionKey, false), [setDirty, sectionKey]);
}

/** Lectura del registro para el layout: si hay borradores y cómo descartarlos todos. */
export function useSettingsDirtyState(): Pick<SettingsDirtyValue, "isDirty" | "clearAll"> {
  const ctx = useContext(SettingsDirtyContext);
  if (!ctx) throw new Error("useSettingsDirtyState requiere SettingsDirtyProvider");
  return { isDirty: ctx.isDirty, clearAll: ctx.clearAll };
}
