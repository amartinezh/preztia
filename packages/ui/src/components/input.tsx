import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";

export type InputProps = TextInputProps & {
  invalid?: boolean;
  className?: string;
};

const BASE =
  "min-h-[48px] rounded-xl border px-4 text-base text-zinc-900 dark:text-zinc-50 bg-white dark:bg-zinc-900";

/** Campo de texto temático. La validación/etiqueta la aporta `Field`. */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  const borderTone = invalid
    ? "border-red-500"
    : "border-zinc-200 dark:border-zinc-700 focus:border-brand-500";
  return (
    <TextInput
      ref={ref}
      placeholderTextColor="#a1a1aa"
      className={`${BASE} ${borderTone} ${className ?? ""}`}
      {...rest}
    />
  );
});
