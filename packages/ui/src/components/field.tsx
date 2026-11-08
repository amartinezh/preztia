import { Children, cloneElement, Fragment, isValidElement, useId, type ReactNode } from "react";
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

/** Props de accesibilidad que `Field` completa en el control hijo cuando este no las trae. */
type ControlA11yProps = {
  accessibilityLabel?: string;
  accessibilityLabelledBy?: string;
  "aria-labelledby"?: string;
  nativeID?: string;
};

/**
 * Asocia la etiqueta al control: si el hijo único es un elemento (no un fragmento ni varios), se
 * clona con `accessibilityLabel` (iOS/Android), `accessibilityLabelledBy`/`aria-labelledby`
 * (Android/web) y `nativeID`, respetando lo que el control ya traiga. Un control que no acepte
 * estas props simplemente las ignora: ningún uso existente cambia de comportamiento.
 */
function associateControl(children: ReactNode, label: string, labelId: string, controlId: string): ReactNode {
  if (Children.count(children) !== 1 || !isValidElement<ControlA11yProps>(children) || children.type === Fragment) {
    return children;
  }
  const props = children.props;
  return cloneElement(children, {
    accessibilityLabel: props.accessibilityLabel ?? label,
    accessibilityLabelledBy: props.accessibilityLabelledBy ?? labelId,
    "aria-labelledby": props["aria-labelledby"] ?? labelId,
    nativeID: props.nativeID ?? controlId,
  });
}

/**
 * Envoltura accesible para un control de formulario: etiqueta + control + error. La etiqueta
 * queda ASOCIADA al control (lector de pantalla y `label`/`aria-labelledby` en web). El error
 * proviene de la validación en la frontera (zod del contrato), no de reglas de dominio; su
 * presencia debe propagarse como `invalid` al control hijo.
 */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const controlId = `${id}-control`;
  return (
    <View className="w-full gap-1.5">
      <Text nativeID={labelId} variant="label" tone="muted">
        {label}
        {required ? <Text tone="danger"> *</Text> : null}
      </Text>
      {associateControl(children, label, labelId, controlId)}
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
