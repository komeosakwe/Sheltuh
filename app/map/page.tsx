import type { Metadata } from "next";
import SceneMap from "@/components/SceneMap";

export const metadata: Metadata = { title: "Scene map — Sheltüh" };

export default function MapPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <SceneMap />
    </div>
  );
}
