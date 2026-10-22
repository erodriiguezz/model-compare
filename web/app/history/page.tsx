import { Suspense } from "react";
import HistoryView from "@/components/HistoryView";

export const metadata = { title: "History · ModelCompare" };

export default function Page() {
  return <Suspense><HistoryView /></Suspense>;
}
