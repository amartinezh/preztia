import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "../components/states";

type Props = {
  children: ReactNode;
  /** Reporta el error a la capa de observabilidad (logger) sin exponer PII. */
  onError?: (error: Error, info: ErrorInfo) => void;
  fallback?: ReactNode;
};

type State = { hasError: boolean };

/**
 * Captura errores de render para evitar pantallas en blanco. La presentación nunca
 * debe tumbar la app; los errores se reportan a observabilidad y se ofrece recuperación.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  private reset = () => this.setState({ hasError: false });

  override render() {
    if (!this.state.hasError) return this.props.children;
    return (
      this.props.fallback ?? (
        <ErrorState
          title="Algo salió mal"
          description="Ocurrió un error inesperado. Puedes reintentar."
          onRetry={this.reset}
        />
      )
    );
  }
}
