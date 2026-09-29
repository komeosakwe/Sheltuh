import type { Metadata } from "next";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in — Sheltüh" };

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <h1 className="display-lg">Sign in</h1>
      <LoginForm />
    </div>
  );
}
