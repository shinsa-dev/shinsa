import * as React from 'react';
import { type ErrorFallbackSize, type RenderError, resolveRenderError } from '@/lib/errors.ts';
import { ErrorFallback } from './fallback.tsx';

interface ErrorBoundaryProps {
  size: ErrorFallbackSize;
  resetKey?: string;
  title?: string;
  description?: string;
  className?: string;
  onError?: (error: RenderError) => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  caught: unknown;
  error: RenderError | null;
  resetKey: string | undefined;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { caught: null, error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState) {
    if (props.resetKey === state.resetKey) return null;
    return { caught: null, error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown) {
    return { caught: error, error: resolveRenderError(error, null) };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const resolved = resolveRenderError(error, info.componentStack ?? null);
    // biome-ignore lint/suspicious/noConsole: a caught render error is reported to the browser console with where it happened
    console.error('[ErrorBoundary] A render error was caught', error, info.componentStack);
    this.setState((state) => (state.caught === error ? { error: resolved } : null));
    this.props.onError?.(resolved);
  }

  readonly retry = () => {
    this.setState({ caught: null, error: null });
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.size === 'silent') return null;
    const fallback = (
      <ErrorFallback
        size={this.props.size}
        error={error}
        title={this.props.title}
        description={this.props.description}
        onRetry={this.retry}
      />
    );
    if (!this.props.className) return fallback;
    return <div className={this.props.className}>{fallback}</div>;
  }
}
