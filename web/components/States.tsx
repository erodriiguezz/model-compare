import type { ReactNode } from "react";

const Icon = () => (
  <svg className="state-icon" width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <rect x="7" y="22" width="6" height="11" rx="1.5" /><rect x="17" y="12" width="6" height="21" rx="1.5" /><rect x="27" y="17" width="6" height="16" rx="1.5" />
  </svg>
);

/** Skeleton panel. The label stays visible text so it is also the status announcement. */
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="card state state-skeleton" role="status" aria-live="polite" aria-busy="true">
      <div className="skeleton short" />
      <div className="skeleton tall" />
      <div className="skeleton-grid"><div className="skeleton tall" /><div className="skeleton tall" /><div className="skeleton tall" /></div>
      <span className="muted">{label}…</span>
    </div>
  );
}

/** Empty panel: what is missing, why, and one next step (`action`, usually a link styled `btn`). */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card state" data-state="empty">
      <Icon />
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/** Error panel with a retry button that calls `onRetry`. */
export function ErrorState({ message, onRetry, retryLabel = "Try again", children }: { message: string; onRetry: () => void; retryLabel?: string; children?: ReactNode }) {
  return (
    <div className="card state" role="alert" data-state="error">
      <h2>Something went wrong</h2>
      <p className="state-msg">{message}</p>
      {children && <p className="muted">{children}</p>}
      <button type="button" className="btn" onClick={onRetry}>{retryLabel}</button>
    </div>
  );
}
