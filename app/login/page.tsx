import type { Metadata } from "next";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in — Sheltüh" };

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Sign in</h1>
      <LoginForm />
    </div>
  );
}
