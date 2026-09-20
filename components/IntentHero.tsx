"use client";

import Link from "next/link";
import { useState } from "react";

type Intent = "discover" | "host" | "return";

const INTENTS: { id: Intent; label: string; blurb: string }[] = [
  {
    id: "discover",
    label: "I want to discover",
    blurb: "See what's on tonight and this week.",
  },
  {
    id: "host",
    label: "I want to host",
    blurb: "Submit your own fashion, music, art or third-space event.",
  },
  {
    id: "return",
    label: "I'm already in",
    blurb: "Sign in to manage your events or application.",
  },
];

/**
 * Intent-led homepage hero: the visitor picks what they're here for, and the
 * call to action below reflects it. Every option routes to something the app
 * actually does (the feed below, the real organiser-application flow, or
 * real sign-in) — no placeholder "connect with people" feature that doesn't
 * exist yet.
 */
export default function IntentHero() {
  const [intent, setIntent] = useState<Intent>("discover");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">Melbourne · Naarm</p>
        <h1 className="font-heading text-4xl text-foreground sm:text-5xl">
          Find your room.
          <br />
          <span className="text-accent">Find your people.</span>
        </h1>
        <p className="max-w-2xl text-muted">
          Melbourne&rsquo;s fashion, music, art and third-space nights don&rsquo;t trend &mdash; they get
          shared in a group chat and forgotten by morning. Sheltüh is where they surface.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="What are you here for?"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {INTENTS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={intent === option.id}
            onClick={() => setIntent(option.id)}
            className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
              intent === option.id
                ? "border-accent bg-accent/10"
                : "border-surface-border bg-surface hover:border-accent/50"
            }`}
          >
            <span className="font-medium text-foreground">{option.label}</span>
            <span className="text-sm text-muted">{option.blurb}</span>
          </button>
        ))}
      </div>

      <div>
        {intent === "discover" && (
          <a
            href="#feed"
            className="inline-block rounded bg-accent px-5 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
          >
            See what&rsquo;s on ↓
          </a>
        )}
        {intent === "host" && (
          <Link
            href="/organisers/apply"
            className="inline-block rounded bg-accent px-5 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
          >
            Apply as an organiser
          </Link>
        )}
        {intent === "return" && (
          <Link
            href="/login"
            className="inline-block rounded bg-accent px-5 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
          >
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}
