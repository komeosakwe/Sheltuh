import type { Metadata } from "next";
import { Suspense } from "react";
import AuthShell from "@/components/auth/AuthShell";
import LegalNote from "@/components/auth/LegalNote";
import VerifyForm from "@/components/auth/VerifyForm";
import { LoadingIndicator } from "@/components/ui/ProgressLoader";

export const metadata: Metadata = { title: "Verify your email — Sheltüh" };

export default function VerifyPage() {
  return (
    <AuthShell title="Verify your email" intro="Enter the code we emailed you.">
      <Suspense fallback={<LoadingIndicator />}>
        <VerifyForm />
      </Suspense>
      <LegalNote />
    </AuthShell>
  );
}
