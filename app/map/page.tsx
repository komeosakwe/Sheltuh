import type { Metadata } from "next";
import { Suspense } from "react";
import SceneMap from "@/components/SceneMap";

export const metadata: Metadata = { title: "Scene map — Sheltüh" };

export default function MapPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:max-w-[92rem]">
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <SceneMap />
      </Suspense>
    </div>
  );
}
