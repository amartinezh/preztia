import { type ReactNode } from "react";
import { Modal as RNModal, Pressable, View } from "react-native";
import { Text } from "../primitives/text";

export type ModalProps = {
  visible: boolean;
  /** Cierre fácil: backdrop, botón ✕ y botón atrás del sistema lo invocan. */
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

/**
 * Superficie modal presentacional, responsiva y fácil de cerrar: se cierra tocando el
 * backdrop, el botón ✕ o el botón atrás (Android). En web/tablet se centra con ancho máximo;
 * en móvil ocupa el ancho disponible. Sin dominio ni fetch (solo presentación).
 *
 * El backdrop es un `Pressable` ABSOLUTO hermano del panel (no lo envuelve): en web cada
 * `Pressable` es un `<button>`, así que anidar el panel/sus botones dentro del backdrop
 * produciría `<button>` dentro de `<button>` (HTML inválido / error de hidratación).
 * Manteniéndolos como hermanos, tocar fuera cierra y tocar dentro no, sin botones anidados.
 */
export function Modal({ visible, onClose, title, children }: ModalProps) {
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center p-4">
        {/* Backdrop: cubre toda la superficie DETRÁS del panel; cerrar al tocarlo. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
          onPress={onClose}
          className="absolute inset-0 bg-black/50"
        />

        {/* Panel: es un View (no botón), por lo que sus botones internos son válidos. */}
        <View className="max-h-[90%] w-full max-w-[640px] overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <View className="flex-row items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
            <Text variant="subtitle">{title ?? ""}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              onPress={onClose}
              className="h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <Text variant="subtitle" tone="muted">
                ✕
              </Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </RNModal>
  );
}
