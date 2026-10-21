import type { Metadata } from "next";
import { Suspense } from "react";
import SceneMap from "@/components/SceneMap";

export const metadata: Metadata = { title: "Scene map — Sheltüh" };

export default function MapPage() {
  return (
    // The site's page edges, so the heading lines up with the logo; only the map and list
    // panel widens on large screens (SceneMap, .map-bleed).
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <SceneMap />
      </Suspense>
    </div>
  );
}
