import type { Metadata } from "next";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password — Sheltüh" };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Reset your password</h1>
      <ForgotPasswordForm />
    </div>
  );
}
