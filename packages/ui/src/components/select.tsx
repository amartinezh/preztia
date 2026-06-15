import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "../primitives/text";
import { Modal } from "./modal";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Detalle secundario opcional (p. ej. el path de una zona). */
  hint?: string;
};

export type SelectProps<T extends string> = {
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  title?: string;
  invalid?: boolean;
  disabled?: boolean;
};

/**
 * Selector de un valor entre opciones. Presentación pura: un control con la opción actual que
 * abre un `Modal` con la lista. Responsivo (móvil/web) y accesible (hit targets ≥ 44px). La
 * validación/etiqueta la aporta `Field`; las opciones las decide la pantalla (no conoce dominio).
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = "Seleccionar…",
  title,
  invalid,
  disabled,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;
  const borderTone = invalid
    ? "border-red-500"
    : "border-zinc-200 dark:border-zinc-700";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={`min-h-[48px] flex-row items-center justify-between rounded-xl border px-4 ${borderTone} bg-white disabled:opacity-50 dark:bg-zinc-900`}
      >
        <Text variant="body" tone={selected ? "default" : "muted"}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text variant="body" tone="muted">
          ▾
        </Text>
      </Pressable>

      <Modal visible={open} onClose={() => setOpen(false)} title={title ?? placeholder}>
        <ScrollView className="max-h-[60vh]">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="min-h-[52px] flex-row items-center justify-between border-b border-zinc-100 px-4 py-3 active:bg-zinc-100 dark:border-zinc-800 dark:active:bg-zinc-800"
              >
                <View className="flex-1 pr-3">
                  <Text variant="body">{option.label}</Text>
                  {option.hint ? (
                    <Text variant="caption" tone="muted">
                      {option.hint}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? (
                  <Text variant="body" tone="primary">
                    ✓
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Modal>
    </>
  );
}
