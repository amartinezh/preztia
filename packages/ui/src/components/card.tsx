import { View, type ViewProps } from "react-native";

export type CardProps = ViewProps & { className?: string };

/** Superficie elevada para agrupar contenido relacionado. */
export function Card({ className, ...rest }: CardProps) {
  return (
    <View
      className={`rounded-2xl border border-zinc-200 bg-white p-4 web:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className ?? ""}`}
      {...rest}
    />
  );
}
