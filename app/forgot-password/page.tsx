import type { Metadata } from "next";
import LegalNote from "@/components/auth/LegalNote";
import { Page, PageHeader } from "@/components/ui/Section";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password — Sheltüh" };

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { next } = await searchParams;
  return (
    <Page width="form">
      <PageHeader flush eyebrow="Account" title="Reset your password" />
      <ForgotPasswordForm next={Array.isArray(next) ? next[0] : next} />
      <LegalNote />
    </Page>
  );
}
