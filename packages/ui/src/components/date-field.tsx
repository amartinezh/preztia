import { useState, type ReactElement } from "react";
import * as ReactNative from "react-native";
import {
  addDaysIso,
  isCompleteIsoDateText,
  isValidIsoDate,
  maskIsoDateInput,
  todayIso,
} from "../format/date";
import { useTheme } from "../hooks/use-theme";
import { Text } from "../primitives/text";
import { Input } from "./input";

const { Platform, Pressable, View } = ReactNative;

export type DateQuickOption = {
  label: string;
  /** Fecha `YYYY-MM-DD` que fija el chip. */
  value: string;
};

export type DateFieldProps = {
  /** Fecha canónica `YYYY-MM-DD`, o `null` si está vacía o no es una fecha válida. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Límites inclusivos `YYYY-MM-DD`; una fecha fuera del rango se reporta como `null` (inválida). */
  min?: string;
  max?: string;
  placeholder?: string;
  /** Texto de error cuando lo tecleado no es una fecha (la pantalla lo traduce). */
  invalidLabel?: string;
  /** Chips rápidos; por defecto Hoy / Ayer / Mañana. `[]` los oculta. */
  quickOptions?: readonly DateQuickOption[];
  invalid?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
};

const DEFAULT_PLACEHOLDER = "AAAA-MM-DD";
const DEFAULT_INVALID_LABEL = "Fecha no válida. Usa AAAA-MM-DD, por ejemplo 2026-11-08";
const ISO_DATE_MAX_LENGTH = 10;

// Mismas medidas que `Input` (min-h-[48px] rounded-xl px-4 text-base) para el control nativo del navegador.
const INPUT_MIN_HEIGHT = 48;
const INPUT_RADIUS = 12;
const INPUT_PADDING_X = 16;
const INPUT_FONT_SIZE = 16;

type DomChangeEvent = { target: { value: string } };
type CreateDomElement = (type: "input", props: Record<string, unknown>) => ReactElement;

// `unstable_createElement` solo existe en react-native-web, que es a lo que Expo resuelve
// `react-native` en web. En nativo es `undefined` y se usa el campo con máscara.
const createDomElement = (ReactNative as unknown as { unstable_createElement?: CreateDomElement })
  .unstable_createElement;

function defaultQuickOptions(): DateQuickOption[] {
  const today = todayIso();
  return [
    { label: "Hoy", value: today },
    { label: "Ayer", value: addDaysIso(today, -1) },
    { label: "Mañana", value: addDaysIso(today, 1) },
  ];
}

// Las fechas ISO se comparan como texto: el orden lexicográfico coincide con el cronológico.
function withinRange(iso: string, min?: string, max?: string): boolean {
  return (!min || iso >= min) && (!max || iso <= max);
}

/**
 * Campo de FECHA (`YYYY-MM-DD`). En web es el selector nativo del navegador (`<input type="date">`,
 * sin ambigüedad de formato); en nativo, un campo numérico con máscara que inserta los guiones
 * mientras se teclea. Chips rápidos para las fechas habituales. Nunca convierte en silencio: un
 * texto incompleto, inexistente en el calendario o fuera de `min`/`max` se reporta como `null` y se
 * marca en rojo; la pantalla bloquea el envío mientras necesite una fecha y reciba `null`.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = DEFAULT_PLACEHOLDER,
  invalidLabel = DEFAULT_INVALID_LABEL,
  quickOptions,
  invalid,
  disabled,
  accessibilityLabel,
}: DateFieldProps) {
  const { colors } = useTheme();
  const [text, setText] = useState(value ?? "");
  const [syncedValue, setSyncedValue] = useState(value);

  const accepted = (candidate: string): string | null =>
    isValidIsoDate(candidate) && withinRange(candidate, min, max) ? candidate : null;

  // Cambio EXTERNO de `value` (chip de la pantalla, "Hoy", reinicio del formulario): se refleja en
  // el texto sin pisar lo que la persona está tecleando (un texto a medias ya reporta `null`).
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (value !== null && value !== text) setText(value);
    else if (value === null && accepted(text) !== null) setText("");
  }

  const emit = (next: string) => {
    setText(next);
    onChange(accepted(next));
  };

  // Rojo solo con una fecha completa que no sirve; a medio teclear todavía no es un error.
  const unreadable = text !== "" && isCompleteIsoDateText(text) && accepted(text) === null;
  const chips = (quickOptions ?? defaultQuickOptions()).filter((o) => withinRange(o.value, min, max));
  const useDomInput = Platform.OS === "web" && createDomElement !== undefined;

  return (
    <View className="gap-2">
      {useDomInput ? (
        createDomElement("input", {
          type: "date",
          value: text,
          min,
          max,
          disabled,
          "aria-label": accessibilityLabel,
          "aria-invalid": invalid || unreadable ? true : undefined,
          onChange: (e: DomChangeEvent) => emit(e.target.value),
          style: {
            minHeight: INPUT_MIN_HEIGHT,
            borderRadius: INPUT_RADIUS,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: invalid || unreadable ? colors.danger : colors.border,
            paddingHorizontal: INPUT_PADDING_X,
            fontSize: INPUT_FONT_SIZE,
            color: colors.text,
            backgroundColor: colors.surface,
            width: "100%",
          },
        })
      ) : (
        <Input
          value={text}
          onChangeText={(raw) => emit(maskIsoDateInput(raw))}
          placeholder={placeholder}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={ISO_DATE_MAX_LENGTH}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          invalid={invalid || unreadable}
          accessibilityLabel={accessibilityLabel}
        />
      )}

      {chips.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {chips.map((option) => {
            const active = text === option.value;
            return (
              <Pressable
                key={`${option.value}:${option.label}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                disabled={disabled}
                onPress={() => emit(option.value)}
                className={`min-h-[36px] justify-center rounded-full border px-3 ${
                  active ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <Text variant="label" tone={active ? "primary" : "muted"}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {unreadable ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {invalidLabel}
        </Text>
      ) : null}
    </View>
  );
}
