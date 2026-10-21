import type { Metadata } from "next";
import LegalNote from "@/components/auth/LegalNote";
import { LoadingIndicator } from "@/components/ui/ProgressLoader";
import { PageHeader } from "@/components/ui/Section";
import { Suspense } from "react";
import VerifyForm from "@/components/auth/VerifyForm";

export const metadata: Metadata = { title: "Verify your email — Sheltüh" };

export default function VerifyPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <PageHeader
        flush
        eyebrow="Account"
        title="Verify your email"
        intro="Enter the code we emailed you to finish creating your account."
      />
      <Suspense fallback={<LoadingIndicator />}>
        <VerifyForm />
      </Suspense>
      <LegalNote />
    </div>
  );
}
