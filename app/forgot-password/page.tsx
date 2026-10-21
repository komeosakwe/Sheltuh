import type { Metadata } from "next";
import LegalNote from "@/components/auth/LegalNote";
import { PageHeader } from "@/components/ui/Section";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password — Sheltüh" };

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-md flex-col gap-8">
        <PageHeader flush eyebrow="Account" title="Reset your password" />
        <ForgotPasswordForm next={Array.isArray(next) ? next[0] : next} />
        <LegalNote />
      </div>
    </div>
  );
}
