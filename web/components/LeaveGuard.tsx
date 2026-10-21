"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Dialog from "./Dialog";

/** While `dirty`, in-app links ask first (in-page dialog); closing the tab uses the browser's own prompt. */
export default function LeaveGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const click = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || a.origin !== location.origin) return;
      e.preventDefault(); e.stopPropagation();
      setHref(a.pathname + a.search);
    };
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("click", click, true); window.removeEventListener("beforeunload", unload); };
  }, [dirty]);
  return (
    <Dialog open={href !== null} title="Leave without saving?" onClose={() => setHref(null)}>
      <p className="muted">Your changes to this project are not saved.</p>
      <div className="bar-actions">
        <button type="button" className="btn secondary" onClick={() => setHref(null)}>Stay</button>
        <button type="button" className="btn destructive" onClick={() => { const to = href!; setHref(null); router.push(to); }}>Discard and leave</button>
      </div>
    </Dialog>
  );
}
