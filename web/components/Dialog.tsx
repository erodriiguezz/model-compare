"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

/** A modal in-page dialog on the native <dialog>: focus stays inside, Esc closes, focus returns to the trigger.
 *  Its content sits in its own form, so Enter submits the dialog (onSubmit) and never a form behind it. */
export default function Dialog({ open, title, onClose, onSubmit, children }: { open: boolean; title: string; onClose: () => void; onSubmit?: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const quiet = useRef(false); // a close we asked for is not a user dismissal
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) { quiet.current = true; d.close(); }
  }, [open]);
  // Tab wraps inside the dialog instead of leaving the page for the browser's own controls.
  const wrap = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]")];
    const edge = items[e.shiftKey ? 0 : items.length - 1], other = items[e.shiftKey ? items.length - 1 : 0];
    if (items.length && document.activeElement === edge) { e.preventDefault(); other.focus(); }
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={id} onClose={() => (quiet.current ? (quiet.current = false) : onClose())} onKeyDown={wrap}>
      {open && <form className="form" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}><h2 id={id}>{title}</h2>{children}</form>}
    </dialog>
  );
}
