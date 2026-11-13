import type { Metadata } from "next";
import AuthShell from "@/components/auth/AuthShell";
import OAuthButtons from "@/components/auth/OAuthButtons";
import SignupForm from "@/components/auth/SignupForm";

export const metadata: Metadata = { title: "Sign up — Sheltüh" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next: raw } = await searchParams;
  const next = Array.isArray(raw) ? raw[0] : raw;
  return (
    <AuthShell title="Create an account">
      {/* Apple and Google (when enabled), their privacy line and the "or" divider. */}
      <OAuthButtons next={next} />
      {/* The privacy line is inside the form, above Sign up. */}
      <SignupForm next={next} />
    </AuthShell>
  );
}
