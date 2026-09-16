import type { ReactNode } from "react";
import type { EventPoster } from "@/lib/types";

/**
 * Deterministic local poster art: pure CSS/SVG shapes per pattern, no remote
 * images. Purely decorative — event titles are always rendered as real text
 * elsewhere, so this can be hidden from assistive tech.
 */
function renderPattern(poster: EventPoster) {
  const { pattern, primary, secondary } = poster;

  switch (pattern) {
    case "burst": {
      const spokes = Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * 2 * Math.PI;
        const inner = 15;
        const outer = i % 2 === 0 ? 75 : 55;
        return (
          <line
            key={i}
            x1={50 + Math.cos(angle) * inner}
            y1={50 + Math.sin(angle) * inner}
            x2={50 + Math.cos(angle) * outer}
            y2={50 + Math.sin(angle) * outer}
            stroke={i % 2 === 0 ? primary : secondary}
            strokeWidth={i % 2 === 0 ? 3 : 1.5}
            opacity={0.85}
          />
        );
      });
      return (
        <>
          {spokes}
          <circle cx="50" cy="50" r="13" fill={secondary} />
          <circle cx="50" cy="50" r="13" fill="none" stroke={primary} strokeWidth="2" />
        </>
      );
    }

    case "rings":
      return (
        <>
          {[45, 34, 23].map((r, i) => (
            <circle
              key={r}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={i % 2 === 0 ? primary : secondary}
              strokeWidth="5"
              opacity="0.9"
            />
          ))}
          <circle cx="50" cy="50" r="8" fill={secondary} />
        </>
      );

    case "grid": {
      const verticals = Array.from({ length: 6 }, (_, i) => (i + 1) * (100 / 7));
      const horizontals = Array.from({ length: 4 }, (_, i) => (i + 1) * (100 / 5));
      return (
        <>
          {verticals.map((x) => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" stroke={primary} strokeWidth="0.6" opacity="0.45" />
          ))}
          {horizontals.map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2="100" y2={y} stroke={primary} strokeWidth="0.6" opacity="0.45" />
          ))}
          <circle cx="50" cy="24" r="10" fill={secondary} opacity="0.9" />
          <ellipse cx="50" cy="62" rx="20" ry="28" fill={secondary} opacity="0.9" />
        </>
      );
    }

    case "stripes":
      return (
        <>
          {Array.from({ length: 6 }, (_, i) => (
            <line
              key={i}
              x1={-20 + i * 24}
              y1="120"
              x2={40 + i * 24}
              y2="-20"
              stroke={i % 2 === 0 ? primary : secondary}
              strokeWidth="9"
              opacity="0.75"
            />
          ))}
        </>
      );

    case "waves":
      return (
        <>
          <path d="M0,42 Q25,15 50,42 T100,42" stroke={primary} strokeWidth="2.5" fill="none" opacity="0.55" />
          <path d="M0,58 Q25,30 50,58 T100,58" stroke={secondary} strokeWidth="3.5" fill="none" opacity="0.9" />
          <path d="M0,74 Q25,50 50,74 T100,74" stroke={primary} strokeWidth="3" fill="none" opacity="0.75" />
        </>
      );

    case "confetti": {
      const shapes: { x: number; y: number; r: number; c: string }[] = [
        { x: 14, y: 18, r: 5, c: secondary },
        { x: 34, y: 12, r: 3, c: primary },
        { x: 62, y: 16, r: 6, c: primary },
        { x: 82, y: 24, r: 4, c: secondary },
        { x: 20, y: 48, r: 4, c: primary },
        { x: 48, y: 42, r: 7, c: secondary },
        { x: 74, y: 52, r: 3.5, c: primary },
        { x: 12, y: 78, r: 6, c: secondary },
        { x: 40, y: 80, r: 3, c: primary },
        { x: 66, y: 76, r: 5, c: secondary },
        { x: 88, y: 70, r: 4, c: primary },
      ];
      return (
        <>
          {shapes.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={s.c} opacity="0.9" />
          ))}
        </>
      );
    }

    case "curtain":
      return (
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <rect
              key={i}
              x={i * 12.5}
              y="0"
              width="12.5"
              height="100"
              fill={i % 2 === 0 ? primary : secondary}
              opacity={0.55 + (i % 3) * 0.15}
            />
          ))}
        </>
      );

    case "halftone": {
      const dots = [];
      for (let row = 0; row < 6; row += 1) {
        for (let col = 0; col < 6; col += 1) {
          const cx = col * 16 + 10;
          const cy = row * 16 + 10;
          const dist = Math.hypot(cx - 50, cy - 50);
          const r = Math.max(1.2, 7 - dist / 10);
          dots.push(
            <circle key={`${row}-${col}`} cx={cx} cy={cy} r={r} fill={col % 2 === 0 ? primary : secondary} opacity="0.85" />,
          );
        }
      }
      return <>{dots}</>;
    }

    default:
      return null;
  }
}

export default function EventArt({
  poster,
  title,
  className,
  children,
}: {
  poster: EventPoster;
  title: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{ backgroundColor: poster.background }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <text
          x="50"
          y="78"
          textAnchor="middle"
          fontSize="95"
          fontFamily="var(--font-heading), 'Arial Narrow', sans-serif"
          fill="#ffffff"
          opacity="0.08"
        >
          {title.charAt(0).toUpperCase()}
        </text>
        {renderPattern(poster)}
      </svg>
      {children && <div className="absolute inset-0 flex items-end p-3">{children}</div>}
    </div>
  );
}
