import type { Metadata } from "next";
import { Suspense } from "react";
import SceneMap from "@/components/SceneMap";

// The page is Nearby (the audit: "Map" names the screen, not the goal); its address stays /map.
export const metadata: Metadata = { title: "Nearby — Sheltüh" };

export default function MapPage() {
  return (
    // The rules' content column (1312px, margins 16 / 32 / 64), as the other redesigned pages.
    <div className="page-container flex flex-col gap-8 py-12 lg:py-16">
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <SceneMap />
      </Suspense>
    </div>
  );
}
