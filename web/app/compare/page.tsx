import { Suspense } from "react";
import { Loading } from "@/components/States";
import CompareView from "@/components/CompareView";

export const metadata = { title: "Compare · ModelCompare" };

export default function Page() {
  return <Suspense fallback={<main className="page"><h1>Compare</h1><Loading label="Loading" /></main>}><CompareView /></Suspense>;
}
