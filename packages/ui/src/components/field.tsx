import { type ReactNode } from "react";
import { View } from "react-native";
import { Text } from "../primitives/text";

export type FieldProps = {
  label: string;
  /** Mensaje de error de validación (zod del contrato). Activa estilo inválido. */
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  children: ReactNode;
};

/**
 * Envoltura accesible para un control de formulario: etiqueta + control + error.
 * El error proviene de la validación en la frontera (zod del contrato), no de reglas
 * de dominio. La presencia de `error` debe propagarse como `invalid` al control hijo.
 */
export function Field({ label, error, hint, required, children }: FieldProps) {
  return (
    <View className="w-full gap-1.5">
      <Text variant="label" tone="muted">
        {label}
        {required ? <Text tone="danger"> *</Text> : null}
      </Text>
      {children}
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
