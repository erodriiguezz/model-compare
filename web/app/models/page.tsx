import { Suspense } from "react";
import { Loading } from "@/components/States";
import ModelsView from "@/components/ModelsView";

export const metadata = { title: "Models · ModelCompare" };

export default function Page() {
  return <Suspense fallback={<main className="page"><h1>Models</h1><Loading label="Loading" /></main>}><ModelsView /></Suspense>;
}
