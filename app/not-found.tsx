import type { Metadata } from "next";
import NotFoundMessage from "@/components/NotFoundMessage";

export const metadata: Metadata = { title: "Page not found — Sheltüh" };

export default function NotFound() {
  return <NotFoundMessage />;
}
