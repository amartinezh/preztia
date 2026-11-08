import { View } from "react-native";
import { formatMoney, parseMoneyInput } from "../format/money";
import { Text } from "../primitives/text";
import { Input, type InputProps } from "./input";

export type MoneyInputProps = Omit<InputProps, "value" | "onChangeText" | "keyboardType"> & {
  /** Texto tal cual lo teclea la persona (la pantalla lo guarda en su estado). */
  value: string;
  onChangeText: (text: string) => void;
  /**
   * Monto leído en unidades menores, o `null` si el texto no es un monto inequívoco. Se emite con
   * cada cambio de texto para que la pantalla bloquee el envío sin volver a parsear; el valor
   * inicial lo deriva la pantalla con `parseMoneyInput` al montar.
   */
  onChangeAmount?: (amountMinor: number | null) => void;
  currency: string;
  locale?: string;
  /** Texto de error cuando lo tecleado no es un monto (la pantalla lo traduce). */
  invalidLabel?: string;
};

const DEFAULT_INVALID_LABEL = "Monto no válido. Escribe solo números, por ejemplo 20000 o 20.000";

/**
 * Campo de dinero: lee la convención de la región (punto de miles, coma decimal), muestra debajo
 * el monto formateado que se va a enviar ("= $ 20.000,00") y marca en rojo lo que no es un monto.
 * Nunca convierte en silencio: un texto ambiguo se reporta como `null`, no como 0 ni como otro
 * número. Presentación pura; la validación de negocio (mínimos, saldos) la hace la pantalla.
 */
export function MoneyInput({
  value,
  onChangeText,
  onChangeAmount,
  currency,
  locale,
  invalidLabel = DEFAULT_INVALID_LABEL,
  invalid,
  ...rest
}: MoneyInputProps) {
  const amountMinor = parseMoneyInput(value);
  const typed = value.trim() !== "";
  const unreadable = typed && amountMinor === null;

  const handleChangeText = (text: string) => {
    onChangeText(text);
    onChangeAmount?.(parseMoneyInput(text));
  };

  return (
    <View className="gap-1">
      <Input
        {...rest}
        value={value}
        onChangeText={handleChangeText}
        keyboardType="decimal-pad"
        inputMode="decimal"
        invalid={invalid || unreadable}
      />
      {unreadable ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {invalidLabel}
        </Text>
      ) : typed && amountMinor !== null ? (
        <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
          = {formatMoney(amountMinor, currency, locale)}
        </Text>
      ) : null}
    </View>
  );
}
