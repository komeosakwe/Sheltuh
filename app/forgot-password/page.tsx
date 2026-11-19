import type { Metadata } from "next";
import AuthShell from "@/components/auth/AuthShell";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import LegalNote from "@/components/auth/LegalNote";

export const metadata: Metadata = { title: "Reset your password — Sheltüh" };

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { next } = await searchParams;
  return (
    <AuthShell title="Reset your password">
      <ForgotPasswordForm next={Array.isArray(next) ? next[0] : next} />
      <LegalNote />
    </AuthShell>
  );
}
