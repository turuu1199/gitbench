import { Component, ReactNode } from "react";

/** Shows the error instead of unmounting the whole app when a panel crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: undefined as unknown };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { error: Error | null; key: unknown }) {
    // Clear the error when the context (e.g. selected tab) changes.
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  render() {
    if (this.state.error)
      return (
        <div className="empty error">
          <b>Something went wrong in this panel.</b>
          <pre className="output">{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    return this.props.children;
  }
}
