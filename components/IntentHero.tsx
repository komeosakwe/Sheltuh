"use client";

import Link from "next/link";
import { Space_Grotesk } from "next/font/google";
import { useState } from "react";

// This hero reproduces the "identity-led discovery" direction picked from
// the earlier design exploration, which used Space Grotesk and an orange
// accent distinct from the rest of the app's Bebas Neue / blue — both
// scoped to this component only, not a site-wide rebrand.
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"] });

type Intent = "discover" | "connect" | "make";

const INTENTS: { id: Intent; icon: string; label: string; blurb: string }[] = [
  { id: "discover", icon: "◌", label: "I want to discover", blurb: "something new tonight" },
  { id: "connect", icon: "✳", label: "I want to connect", blurb: "with creative people" },
  { id: "make", icon: "▧", label: "I want to make", blurb: "or share an event" },
];

const ORANGE = "#e15b27";

export default function IntentHero() {
  const [intent, setIntent] = useState<Intent>("discover");

  return (
    <div className={`${spaceGrotesk.className} border border-surface-border bg-[#0c0b0a] p-6 sm:p-8`}>
      <p className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: ORANGE }}>
        Melbourne &middot; Naarm
      </p>

      <div className="mt-4 flex flex-col gap-6 border-b border-surface-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <h1
          className="max-w-2xl text-[42px] leading-[0.9] font-bold tracking-[-0.03em] text-foreground sm:text-6xl lg:text-7xl"
          style={{ ...spaceGrotesk.style, textTransform: "none" }}
        >
          Find your room.
          <br />
          <span style={{ color: ORANGE }}>Find your people.</span>
        </h1>
        <p className="max-w-[290px] text-sm leading-relaxed text-muted">
          Choose what you are looking for. Sheltüh surfaces the rooms, nights and events that fit.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="What are you here for?"
        className="my-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3"
      >
        {INTENTS.map((option) => {
          const selected = intent === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setIntent(option.id)}
              className="min-h-[115px] border px-5 py-5 text-left transition-colors"
              style={{
                background: selected ? "#281812" : "#151311",
                borderColor: selected ? ORANGE : "#3d352e",
                color: "#eee7dc",
              }}
            >
              <span className="mb-5 block text-2xl">{option.icon}</span>
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="mt-1 block text-sm" style={{ color: "#898178" }}>
                {option.blurb}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em]" style={{ color: ORANGE }}>
        Picked for the scene you chose
      </p>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <a
          href="#feed"
          className="flex min-h-[210px] flex-col justify-between p-5 transition-opacity hover:opacity-90"
          style={{ background: "#efe9df", color: "#151210" }}
        >
          <div className="flex justify-between text-[11px] font-medium uppercase tracking-wide">
            <span>Tonight &middot; Melbourne</span>
            <span>Live</span>
          </div>
          <h3
            className="mt-4 text-[26px] leading-[1] font-bold tracking-[-0.02em]"
            style={{ ...spaceGrotesk.style, textTransform: "none" }}
          >
            See what&rsquo;s on
          </h3>
          <p className="mt-3 text-[13px]">
            Live music, art, workshops and pop-ups &mdash; updated as organisers publish.
          </p>
        </a>
        <Link
          href="/organisers/apply"
          className="flex min-h-[210px] flex-col justify-between p-5 text-white transition-opacity hover:opacity-90"
          style={{ background: ORANGE }}
        >
          <div className="flex justify-between text-[11px] font-medium uppercase tracking-wide">
            <span>Organisers</span>
            <span>Reviewed before it&rsquo;s live</span>
          </div>
          <h3
            className="mt-4 text-[26px] leading-[1] font-bold tracking-[-0.02em]"
            style={{ ...spaceGrotesk.style, textTransform: "none" }}
          >
            Have something on?
          </h3>
          <p className="mt-3 text-[13px]">Submit your fashion, music, art or third-space event.</p>
        </Link>
      </div>

      <p className="mt-6 text-[13px]" style={{ color: "#8e877e" }}>
        You don&rsquo;t need to know the right account to follow. You just need to know what kind of
        room you want to walk into.
      </p>
    </div>
  );
}
