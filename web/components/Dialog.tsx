"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

/** A modal in-page dialog on the native <dialog>: focus stays inside, Esc closes, focus returns to the trigger. */
export default function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  // Tab wraps inside the dialog instead of leaving the page for the browser's own controls.
  const wrap = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.code !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]")];
    const edge = items[e.shiftKey ? 0 : items.length - 1], other = items[e.shiftKey ? items.length - 1 : 0];
    if (items.length && document.activeElement === edge) { e.preventDefault(); other.focus(); }
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={id} onClose={onClose} onKeyDown={wrap}>
      {open && <div className="form"><h2 id={id}>{title}</h2>{children}</div>}
    </dialog>
  );
}
