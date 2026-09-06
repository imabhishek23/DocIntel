import React from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border-2 border-rose-200 bg-white p-6 shadow-xl text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900">
              {this.props.title || 'Something unexpected happened'}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              DocIntel encountered a render issue, but your session is safe. You can reload or return home without losing data.
            </p>
            {this.state.error?.message && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-left font-mono text-[11px] text-rose-700 max-h-28 overflow-auto">
                {this.state.error.message}
              </div>
            )}
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 transition shadow-sm"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry View
              </button>
              <button
                onClick={() => (window.location.href = '/')}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <Home className="h-3.5 w-3.5" />
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

