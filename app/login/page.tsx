import type { Metadata } from "next";
import AuthShell from "@/components/auth/AuthShell";
import { AgreeNote } from "@/components/auth/LegalNote";
import LoginForm from "@/components/auth/LoginForm";
import LoginLinks from "@/components/auth/LoginLinks";
import OAuthButtons from "@/components/auth/OAuthButtons";
import { EMAIL_SIGN_IN_ID } from "@/lib/auth/oauth";

export const metadata: Metadata = { title: "Sign in — Sheltüh" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next: raw } = await searchParams;
  const next = Array.isArray(raw) ? raw[0] : raw;
  return (
    <AuthShell title="Welcome to Sheltüh" intro="Find your place, find your people.">
      {/* /auth/callback's "Use email instead" lands here; the page's scroll-padding-top
          (globals.css) keeps it, label and all, clear of the sticky header. */}
      <div id={EMAIL_SIGN_IN_ID}>
        <LoginForm next={next} />
      </div>
      {/* "Or continue with", Apple and Google (when enabled). */}
      <OAuthButtons next={next} placement="below" legal={false} />
      {/* The page's one privacy line, for the email form and the buttons alike. */}
      <AgreeNote />
      <LoginLinks next={next} />
    </AuthShell>
  );
}
