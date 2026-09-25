import Svg, { Path } from "react-native-svg";

/**
 * Glifo de avión de papel (envío de mensaje) como SVG vectorial, sin assets binarios. Representa un
 * envío por Telegram o por "el canal alcanzable" cuando el tenant opera ambos proveedores.
 */
export function SendPlaneIcon({ size = 24, color = "#ffffff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M21.4 3.6 2.9 10.8c-1.2.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.5c.3-1.3-.5-1.8-1.4-1.4ZM8.3 13.4l9.6-6.1c.5-.3.9-.1.5.2l-8 7.2-.3 3.3-1.8-4.6Z"
      />
    </Svg>
  );
}
