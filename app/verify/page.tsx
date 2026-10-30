import type { Metadata } from "next";
import LegalNote from "@/components/auth/LegalNote";
import { LoadingIndicator } from "@/components/ui/ProgressLoader";
import { Page, PageHeader } from "@/components/ui/Section";
import { Suspense } from "react";
import VerifyForm from "@/components/auth/VerifyForm";

export const metadata: Metadata = { title: "Verify your email — Sheltüh" };

export default function VerifyPage() {
  return (
    <Page width="form">
      <PageHeader
        flush
        eyebrow="Account"
        title="Verify your email"
        intro="Enter the code we emailed you."
      />
      <Suspense fallback={<LoadingIndicator />}>
        <VerifyForm />
      </Suspense>
      <LegalNote />
    </Page>
  );
}
