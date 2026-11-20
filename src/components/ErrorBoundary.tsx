import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[Echat] Uncaught UI error:', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F0F2F5] p-4">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-extrabold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-slate-500 mt-2">
            Echat hit an unexpected error. Reloading usually fixes it.
          </p>
          <pre className="mt-4 text-left text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 overflow-auto max-h-32 text-red-600">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition"
          >
            Reload Echat
          </button>
        </div>
      </div>
    );
  }
}
