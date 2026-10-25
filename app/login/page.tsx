import type { Metadata } from "next";
import LegalNote from "@/components/auth/LegalNote";
import OAuthButtons from "@/components/auth/OAuthButtons";
import { PageHeader } from "@/components/ui/Section";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in — Sheltüh" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next: raw } = await searchParams;
  const next = Array.isArray(raw) ? raw[0] : raw;
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-md flex-col gap-8">
        <PageHeader flush eyebrow="Account" title="Sign in" />
        {/* Apple and Google (when enabled), their privacy line and the "or" divider. */}
        <OAuthButtons next={next} />
        <LoginForm next={next} />
        <LegalNote />
      </div>
    </div>
  );
}
