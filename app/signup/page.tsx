import type { Metadata } from "next";
import SignupForm from "@/components/auth/SignupForm";

export const metadata: Metadata = { title: "Sign up — Sheltüh" };

export default function SignupPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Create an account</h1>
      <p className="text-sm text-muted">
        An account lets you apply as an organiser. Browsing and (later) buying tickets never
        requires one.
      </p>
      <SignupForm />
    </div>
  );
}
