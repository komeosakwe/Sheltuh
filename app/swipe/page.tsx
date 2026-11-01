import type { Metadata } from "next";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import SwipeFeed from "@/components/swipe/SwipeFeed";

export const metadata: Metadata = { title: "Swipe events | Sheltüh" };

export default function SwipePage() {
  return (
    <HomeEventsProvider>
      <SwipeFeed />
    </HomeEventsProvider>
  );
}
