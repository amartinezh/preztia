import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform, Pressable, View } from "react-native";
import { Text } from "../primitives/text";

export type ToastTone = "success" | "info" | "warning" | "danger";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milisegundos en pantalla; los errores duran más para poder leerlos. */
  durationMs?: number;
};

type ToastItem = ToastInput & { id: number; tone: ToastTone };

type ToastContextValue = {
  show: (toast: ToastInput) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4000;
const DANGER_DURATION_MS = 7000;
const MAX_VISIBLE = 3;

const SURFACE: Record<ToastTone, string> = {
  success: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950",
  info: "border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-zinc-900",
  warning: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
  danger: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950",
};

const TITLE_TONE: Record<ToastTone, Parameters<typeof Text>[0]["tone"]> = {
  success: "success",
  info: "primary",
  warning: "default",
  danger: "danger",
};

/**
 * Aviso transitorio ("Abono registrado · saldo $X", "Guardado sin señal"). Sustituye a
 * `Alert.alert`, que en web no hace nada, y da confirmación visible a las mutaciones que navegan.
 * Se apila (máx. 3), se descarta solo o al tocarlo, y se anuncia a lectores de pantalla. Vive en
 * el design system (sin dominio); la app lo monta una vez en la raíz.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      const tone = toast.tone ?? "info";
      const duration =
        toast.durationMs ?? (tone === "danger" ? DANGER_DURATION_MS : DEFAULT_DURATION_MS);
      setItems((prev) => [...prev, { ...toast, id, tone }].slice(-MAX_VISIBLE));
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** Acceso al toast desde cualquier pantalla montada bajo `ToastProvider`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}

// En móvil los avisos salen sobre la barra inferior de pestañas; en web, abajo a la derecha.
const BOTTOM_OFFSET = Platform.OS === "web" ? 24 : 96;

function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 16, right: 16, bottom: BOTTOM_OFFSET }}
      className="items-center web:items-end"
    >
      <View className="w-full max-w-[420px] gap-2">
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            onPress={() => onDismiss(item.id)}
            className={`rounded-xl border px-4 py-3 shadow-lg ${SURFACE[item.tone]}`}
          >
            <Text variant="label" tone={TITLE_TONE[item.tone]}>
              {item.title}
            </Text>
            {item.description ? (
              <Text variant="caption" tone="muted" className="mt-0.5">
                {item.description}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
