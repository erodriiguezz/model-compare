"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/api";
import JobView from "./JobView";
import RunForm from "./RunForm";
import SectionTabs from "./SectionTabs";
import { Empty } from "./States";

/** /compare/ shows the run form; /compare/?job=<id> follows that job. */
export default function CompareView() {
  const router = useRouter();
  const job = useSearchParams().get("job");
  const [noRuns, setNoRuns] = useState(false);
  useEffect(() => {
    let live = true;
    // Best effort: if the check fails the form is still usable, so a failure shows nothing.
    getJSON<unknown[]>("/runs?limit=1").then((r) => live && setNoRuns(r.length === 0)).catch(() => {});
    return () => { live = false; };
  }, []);
  return (
    <main className="page">
      <h1>Compare</h1>
      <p className="muted lede">Run benchmarks and compare models side by side.</p>
      <SectionTabs active="/compare/" />
      {job ? <JobView key={job} id={job} /> : (
        <>
          {noRuns && <Empty title="No comparisons yet">Nothing has been run on this machine. <Link href="/models/">Choose models</Link>, then start your first comparison below.</Empty>}
          <RunForm onStart={(id) => router.push(`/compare/?job=${id}`)} />
        </>
      )}
    </main>
  );
}
