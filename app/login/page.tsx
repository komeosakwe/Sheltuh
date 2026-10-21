import type { Metadata } from "next";
import LegalNote from "@/components/auth/LegalNote";
import { PageHeader } from "@/components/ui/Section";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in — Sheltüh" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <PageHeader flush eyebrow="Account" title="Sign in" />
      <LoginForm next={Array.isArray(next) ? next[0] : next} />
      <LegalNote />
    </div>
  );
}
