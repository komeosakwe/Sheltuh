import type { Metadata } from "next";
import { Suspense } from "react";
import VerifyForm from "@/components/auth/VerifyForm";

export const metadata: Metadata = { title: "Verify your email — Sheltüh" };

export default function VerifyPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Verify your email</h1>
      <p className="text-sm text-muted">Enter the code we emailed you to finish creating your account.</p>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <VerifyForm />
      </Suspense>
    </div>
  );
}
