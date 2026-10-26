import type { Metadata } from "next";
import OAuthButtons from "@/components/auth/OAuthButtons";
import { PageHeader } from "@/components/ui/Section";
import SignupForm from "@/components/auth/SignupForm";

export const metadata: Metadata = { title: "Sign up — Sheltüh" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next: raw } = await searchParams;
  const next = Array.isArray(raw) ? raw[0] : raw;
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-md flex-col gap-8">
        <PageHeader
          flush
          eyebrow="Account"
          title="Create an account"
          intro="An account lets you add yourself to an event’s Who’s Going list, see who else is going, message people going to the same event, and apply as an organiser. You don’t need one to browse events or buy tickets."
        />
        {/* Apple and Google (when enabled), their privacy line and the "or" divider. */}
        <OAuthButtons next={next} />
        {/* The privacy line is inside the form, above Sign up. */}
        <SignupForm next={next} />
      </div>
    </div>
  );
}
