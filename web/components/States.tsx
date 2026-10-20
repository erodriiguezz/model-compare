import type { ReactNode } from "react";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="card state" role="status" aria-live="polite">
      <div className="skeleton" />
      <div className="skeleton short" />
      <span className="muted">{label}…</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card state" data-state="empty">
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function Error({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card state" role="alert" data-state="error">
      <h2>Something went wrong</h2>
      <p className="muted">{message}</p>
      <button type="button" className="btn" onClick={onRetry}>Try again</button>
    </div>
  );
}
