import type { Metadata } from "next";
import EmailOnlyLegalNote from "@/components/auth/EmailOnlyLegalNote";
import OAuthButtons from "@/components/auth/OAuthButtons";
import { PageHeader } from "@/components/ui/Section";
import LoginForm from "@/components/auth/LoginForm";
import { EMAIL_SIGN_IN_ID } from "@/lib/auth/oauth";

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
        {/* /auth/callback's "Use email instead" lands here; the page's scroll-padding-top
            (globals.css) keeps it, label and all, clear of the sticky header. */}
        <div id={EMAIL_SIGN_IN_ID}>
          <LoginForm next={next} />
        </div>
        {/* Only without the buttons: theirs is the page's privacy line otherwise. */}
        <EmailOnlyLegalNote />
      </div>
    </div>
  );
}
