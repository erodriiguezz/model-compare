import { Suspense } from "react";
import CompareView from "@/components/CompareView";

export const metadata = { title: "Compare · ModelCompare" };

export default function Page() {
  return <Suspense><CompareView /></Suspense>;
}
