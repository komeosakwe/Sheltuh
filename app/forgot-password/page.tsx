import type { Metadata } from "next";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password — Sheltüh" };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <h1 className="display-lg">Reset your password</h1>
      <ForgotPasswordForm />
    </div>
  );
}
