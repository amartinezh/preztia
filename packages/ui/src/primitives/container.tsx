import { View, type ViewProps } from "react-native";

export type ContainerProps = ViewProps & {
  /** Limita el ancho y centra el contenido en pantallas grandes (web/tablet). */
  centered?: boolean;
  className?: string;
};

/**
 * Contenedor de contenido responsivo: ocupa todo el ancho en móvil y se limita a
 * un ancho legible centrado en pantallas grandes. La perfección web depende de no
 * estirar líneas de texto a todo lo ancho del monitor.
 */
export function Container({ centered = true, className, ...rest }: ContainerProps) {
  return (
    <View
      className={`w-full px-4 ${centered ? "mx-auto max-w-[880px]" : ""} ${className ?? ""}`}
      {...rest}
    />
  );
}
