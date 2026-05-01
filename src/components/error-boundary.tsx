// Catches uncaught render errors anywhere in the tree and shows a
// recovery UI instead of a blank white screen. Logs to console so the
// stack trace stays visible during development. Resets when the user
// clicks "Try again" — re-mounts the children subtree.
//
// Use at the layout level so a single page crash doesn't take down
// the whole shell.

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  // Optional fallback override; default UI shown when not supplied.
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Visible in browser devtools so a debugging manager / engineer
    // can grab the stack. In production we'd ship to an error tracker
    // (Sentry, Highlight, etc.) here.
    console.error("UI error caught by ErrorBoundary:", error, errorInfo);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-background border rounded-lg p-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-rose-500/15 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </div>
              <h2 className="text-lg font-semibold">Something went wrong on this page.</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              The page hit an unexpected error. Try reloading — if it keeps happening, send the
              details below to whoever maintains this app.
            </p>
            <details className="text-xs bg-muted/40 rounded p-2 font-mono whitespace-pre-wrap break-words">
              <summary className="cursor-pointer text-muted-foreground">Error details</summary>
              <div className="mt-2 text-foreground">
                {this.state.error.name}: {this.state.error.message}
                {this.state.error.stack && `\n\n${this.state.error.stack.split("\n").slice(0, 8).join("\n")}`}
              </div>
            </details>
            <div className="flex gap-2">
              <Button onClick={this.reset} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Try again
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Hard reload
              </Button>
              <Button variant="ghost" onClick={() => window.location.assign("/")}>
                Go home
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
