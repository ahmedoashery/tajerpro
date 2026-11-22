import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  viewTitle?: string;
  onGoHome?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

/**
 * Isolates runtime render errors per workspace tab so an unexpected failure in one
 * screen never crashes the entire POS / multi-tab desktop shell.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'حدث خطأ غير متوقع أثناء عرض هذه الشاشة.',
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[WorkspaceErrorBoundary]', this.props.viewTitle || 'screen', error, info.componentStack);
  }

  public componentDidUpdate(prevProps: AppErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        dir="rtl"
        role="alert"
        className="mx-auto my-8 max-w-lg rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm dark:border-rose-900/60 dark:bg-slate-900"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
          <AlertTriangle className="h-6 w-6" />
        </div>

        <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
          تعذر عرض {this.props.viewTitle ? `شاشة "${this.props.viewTitle}"` : 'هذه الشاشة'} مؤقتاً
        </h3>

        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          تم احتواء الخطأ تلقائياً دون التأثير على باقي التبويبات أو الفواتير المفتوحة. يمكنك إعادة المحاولة أو العودة للرئيسية.
        </p>

        {this.state.errorMessage && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right font-mono-num text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            {this.state.errorMessage}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>إعادة تحميل الشاشة</span>
          </button>

          {this.props.onGoHome && (
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                this.props.onGoHome?.();
              }}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Home className="h-3.5 w-3.5 text-emerald-600" />
              <span>العودة للرئيسية</span>
            </button>
          )}
        </div>
      </div>
    );
  }
}
