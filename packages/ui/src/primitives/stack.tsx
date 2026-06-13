import { View, type ViewProps } from "react-native";

const GAP: Record<string, string> = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
  xl: "gap-6",
};

export type StackProps = ViewProps & {
  gap?: keyof typeof GAP;
  className?: string;
};

/** Columna vertical con separación consistente. */
export function Stack({ gap = "md", className, ...rest }: StackProps) {
  return <View className={`flex-col ${GAP[gap]} ${className ?? ""}`} {...rest} />;
}

/** Fila horizontal con separación consistente. */
export function Row({ gap = "md", className, ...rest }: StackProps) {
  return <View className={`flex-row items-center ${GAP[gap]} ${className ?? ""}`} {...rest} />;
}
