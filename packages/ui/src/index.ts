// Design system de PreztiaOS. Capa de presentación pura: sin dominio, sin contratos,
// sin fetch. Solo react-native + nativewind.

export * from "./tokens";
export * from "./format/money";

// Hooks de tema/layout
export { useColorScheme } from "./hooks/use-color-scheme";
export { useTheme } from "./hooks/use-theme";
export { useBreakpoint } from "./hooks/use-breakpoint";

// Primitivos
export { Text, type TextProps } from "./primitives/text";
export { Stack, Row, type StackProps } from "./primitives/stack";
export { Container, type ContainerProps } from "./primitives/container";

// Componentes
export { Button, type ButtonProps } from "./components/button";
export { Input, type InputProps } from "./components/input";
export { Field, type FieldProps } from "./components/field";
export { Card, type CardProps } from "./components/card";
export { Modal, type ModalProps } from "./components/modal";
export { Select, type SelectProps, type SelectOption } from "./components/select";
export { Switch, type SwitchProps } from "./components/switch";
export { Badge, type BadgeTone } from "./components/badge";
export { Spinner } from "./components/spinner";
export { Skeleton } from "./components/skeleton";
export { EmptyState, ErrorState } from "./components/states";
export { Banner } from "./components/banner";
export { ListItem, type ListItemProps } from "./components/list-item";
export { MoneyText, type MoneyTextProps } from "./components/money-text";

// Feedback
export { ErrorBoundary } from "./feedback/error-boundary";
