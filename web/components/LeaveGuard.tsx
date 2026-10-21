"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";

type Ask = { href: string } | "back" | null;

/**
 * While `dirty`, leaving asks first, in an in-page dialog: link clicks are intercepted, and the browser Back button is caught
 * with a sentinel history entry pushed when the form turns dirty (Back pops it, we ask, "Stay" pushes it again).
 * Closing the tab uses the browser's own prompt.
 */
export default function LeaveGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [ask, setAsk] = useState<Ask>(null);
  const sentinel = useRef(false);
  const leaving = useRef(false);
  const push = () => { window.history.pushState(window.history.state, "", window.location.href); sentinel.current = true; };
  useEffect(() => {
    if (!dirty) return;
    if (!sentinel.current) push();
    const click = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || a.origin !== location.origin) return;
      e.preventDefault(); e.stopPropagation();
      setAsk({ href: a.pathname + a.search });
    };
    const pop = () => { if (leaving.current) return; sentinel.current = false; setAsk("back"); };
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("click", click, true); window.removeEventListener("popstate", pop); window.removeEventListener("beforeunload", unload); };
  }, [dirty]);

  const stay = () => { if (ask === "back" && !sentinel.current) push(); setAsk(null); };
  const leave = () => {
    const to = ask;
    setAsk(null);
    if (to === "back") { leaving.current = true; window.history.back(); } else if (to) router.push(to.href);
  };
  return (
    <Dialog open={ask !== null} title="Leave without saving?" onClose={stay} onSubmit={leave}>
      <p className="muted">Your changes to this project are not saved.</p>
      <div className="bar-actions">
        <button type="button" className="btn secondary" onClick={stay}>Stay</button>
        <button type="submit" className="btn destructive">Discard and leave</button>
      </div>
    </Dialog>
  );
}
