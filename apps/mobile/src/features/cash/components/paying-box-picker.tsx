import { Pressable } from "react-native";
import { MoneyText, Stack, Text } from "@preztiaos/ui";

/** Caja candidata a pagar algo a nombre de un cobrador (gasto, comisión). */
export interface PayingBoxOption {
  id: string;
  name: string;
  /** Saldo disponible si se conoce (las cajas de ruta no lo exponen aquí). */
  balanceMinor: number | null;
  hint?: string;
}

/**
 * Lista seleccionable de cajas pagadoras con su saldo. Solo presenta: qué cajas se ofrecen lo decide
 * quien la usa y el servidor vuelve a validar la regla de caja pagadora y el saldo.
 */
export function PayingBoxPicker({
  options,
  selectedId,
  currency,
  onSelect,
}: {
  options: readonly PayingBoxOption[];
  selectedId: string | null;
  currency: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Stack gap="xs">
      {options.map((o) => {
        const isSelected = o.id === selectedId;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(o.id)}
            className={`min-h-[48px] flex-row items-center justify-between rounded-xl border px-3 ${
              isSelected ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
            }`}
          >
            <Stack gap="xs" className="flex-1 pr-2">
              <Text variant="label" tone={isSelected ? "primary" : "muted"}>
                {o.name}
              </Text>
              {o.hint ? (
                <Text variant="caption" tone="muted">
                  {o.hint}
                </Text>
              ) : null}
            </Stack>
            {o.balanceMinor != null ? <MoneyText variant="label" amountMinor={o.balanceMinor} currency={currency} /> : null}
          </Pressable>
        );
      })}
    </Stack>
  );
}
