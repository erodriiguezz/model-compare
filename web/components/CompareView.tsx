"use client";

import { useRouter, useSearchParams } from "next/navigation";
import JobView from "./JobView";
import RunForm from "./RunForm";
import SectionTabs from "./SectionTabs";

/** /compare/ shows the run form; /compare/?job=<id> follows that job. */
export default function CompareView() {
  const router = useRouter();
  const job = useSearchParams().get("job");
  return (
    <main className="page">
      <h1>Compare</h1>
      <p className="muted lede">Run benchmarks and compare models side by side.</p>
      <SectionTabs active="/compare/" />
      {job ? <JobView key={job} id={job} /> : <RunForm onStart={(id) => router.push(`/compare/?job=${id}`)} />}
    </main>
  );
}
