import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/Section";
import SignupForm from "@/components/auth/SignupForm";

export const metadata: Metadata = { title: "Sign up — Sheltüh" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-md flex-col gap-8">
        <PageHeader
          flush
          eyebrow="Account"
          title="Create an account"
          intro="An account lets you apply as an organiser. Browsing and (later) buying tickets never requires one."
        />
        {/* The privacy line is inside the form, above Sign up. */}
        <SignupForm next={Array.isArray(next) ? next[0] : next} />
      </div>
    </div>
  );
}
