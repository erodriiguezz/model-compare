import { Suspense } from "react";
import ModelsView from "@/components/ModelsView";

export const metadata = { title: "Models · ModelCompare" };

export default function Page() {
  return <Suspense><ModelsView /></Suspense>;
}
