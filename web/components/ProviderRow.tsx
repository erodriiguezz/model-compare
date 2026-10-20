import type { ReactNode } from "react";

export type ProviderRowProps = {
  id: string; label: string; token: string; chip: ReactNode; count: number;
  open: boolean; onToggle?: () => void; children?: ReactNode;
};

/** A provider header (a disclosure button when it has models) and its body. */
export default function ProviderRow({ id, label, token, chip, count, open, onToggle, children }: ProviderRowProps) {
  const head = (
    <>
      <span className="provider-dot" style={{ background: `var(--provider-${token})` }} aria-hidden="true" />
      <span className="provider-name">{label}</span>
      {chip}
      {count > 0 && <span className="muted">{count} {count === 1 ? "model" : "models"}</span>}
    </>
  );
  return (
    <section className="card provider" data-group={id}>
      {onToggle ? (
        <button type="button" className="provider-head" aria-expanded={open} onClick={onToggle}>
          <span className="caret" aria-hidden="true">{open ? "▾" : "▸"}</span>{head}
        </button>
      ) : <div className="provider-head">{head}</div>}
      {children}
    </section>
  );
}
