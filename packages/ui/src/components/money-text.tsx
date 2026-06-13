import { Text, type TextProps } from "../primitives/text";
import { formatMoney } from "../format/money";

export type MoneyTextProps = Omit<TextProps, "children"> & {
  amountMinor: number;
  currency: string;
  locale?: string;
};

/** Muestra un importe en unidades menores como dinero formateado y localizado. */
export function MoneyText({ amountMinor, currency, locale, ...rest }: MoneyTextProps) {
  return <Text {...rest}>{formatMoney(amountMinor, currency, locale)}</Text>;
}
