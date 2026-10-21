import { Suspense } from "react";
import ProjectEditor from "@/components/ProjectEditor";
import { Loading } from "@/components/States";

export const metadata = { title: "Edit project · ModelCompare" };

export default function Page() {
  return <Suspense fallback={<main className="page"><h1>Project</h1><Loading label="Loading" /></main>}><ProjectEditor /></Suspense>;
}
