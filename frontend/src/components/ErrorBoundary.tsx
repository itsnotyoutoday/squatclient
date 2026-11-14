import { Component, type ErrorInfo, type ReactNode } from 'react';

import { recordProblem } from '../lib/problems';

interface State {
  error: Error | null;
  info: string;
}

/**
 * Last line of defence: if any component throws while rendering, show what happened
 * (with a Copy button) instead of leaving a blank window.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? '' });
    recordProblem('render', `${error.message} ${info.componentStack ?? ''}`);
    console.error('UI crashed:', error, info.componentStack);
  }

  private details(): string {
    const { error, info } = this.state;
    return `${error?.name ?? 'Error'}: ${error?.message ?? ''}\n${error?.stack ?? ''}\n${info}`.trim();
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="crash">
        <h1>SquatClient hit a problem</h1>
        <p>Something went wrong while drawing the window. Your connections are not affected.</p>
        <pre className="crash-details">{this.details()}</pre>
        <div className="crash-actions">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(this.details())}>
            Copy details
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Reload window
          </button>
        </div>
      </div>
    );
  }
}
