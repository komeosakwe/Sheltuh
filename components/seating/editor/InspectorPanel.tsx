"use client";

import { useId } from "react";
import type { MapIssue, SeatPatch, TierStats } from "@/lib/seating/editing";
import type { FlatSeat, SeatKind } from "@/lib/seating/template";
import type { TicketType } from "@/lib/types";

const fieldClass = "min-h-10 px-2 text-sm";

/**
 * The editor's right panel (docs/design/seating.md §5.13). One seat: its
 * fields. Several: counts per tier and kind. None: the map's totals and its
 * issues (each a button selecting the seats concerned).
 */
export default function InspectorPanel({
  selection,
  tiers,
  usableTierIds,
  stats,
  issues,
  readOnly,
  onPatch,
  onSelectIssue,
}: {
  selection: FlatSeat[];
  tiers: TicketType[];
  usableTierIds: ReadonlySet<string>;
  stats: { total: TierStats; byTier: Map<string, TierStats> };
  issues: MapIssue[];
  readOnly: boolean;
  onPatch: (patch: SeatPatch) => void;
  onSelectIssue: (issue: MapIssue) => void;
}) {
  const id = useId();
  const tierName = (tierId: string) => tiers.find((t) => t.id === tierId)?.name ?? "Unknown tier";

  if (selection.length === 1) {
    const seat = selection[0];
    const number = (label: string, value: number, key: "x" | "y" | "rotation") => (
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-${key}`} className="eyebrow text-muted">
          {label}
        </label>
        <input
          id={`${id}-${key}`}
          type="number"
          value={value}
          disabled={readOnly}
          onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onPatch({ [key]: e.target.valueAsNumber })}
          className={fieldClass}
        />
      </div>
    );
    return (
      <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
        <h2 id={`${id}-h`} className="font-heading text-lg">
          Seat
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Section</dt>
          <dd>{seat.section}</dd>
          <dt className="text-muted">Row</dt>
          <dd>{seat.row || "(no name)"}</dd>
        </dl>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-label`} className="eyebrow text-muted">
            Seat label
          </label>
          <input
            id={`${id}-label`}
            value={seat.seat}
            maxLength={10}
            disabled={readOnly}
            onChange={(e) => onPatch({ label: e.target.value })}
            className={fieldClass}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {number("X", seat.x, "x")}
          {number("Y", seat.y, "y")}
          {number("Rotation", seat.rotation, "rotation")}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-tier`} className="eyebrow text-muted">
            Tier
          </label>
          <select id={`${id}-tier`} value={seat.ticketTypeId} disabled={readOnly} onChange={(e) => onPatch({ ticketTypeId: e.target.value })} className={fieldClass}>
            {tiers.map((t) => (
              <option key={t.id} value={t.id} disabled={!usableTierIds.has(t.id)}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-col">
          <legend className="eyebrow mb-1 text-muted">Kind</legend>
          {(["standard", "wheelchair", "companion"] as SeatKind[]).map((kind) => (
            <label key={kind} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="radio" name={`${id}-kind`} checked={seat.kind === kind} disabled={readOnly} onChange={() => onPatch({ kind })} className="size-4" />
              {kind === "standard" ? "Standard" : kind === "wheelchair" ? "Wheelchair space" : "Companion seat"}
            </label>
          ))}
        </fieldset>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={seat.blocked} disabled={readOnly} onChange={(e) => onPatch({ blocked: e.target.checked })} className="size-4" />
          Blocked (never sold)
        </label>
      </section>
    );
  }

  if (selection.length > 1) {
    const perTier = new Map<string, number>();
    let wheelchair = 0;
    let companion = 0;
    let blocked = 0;
    for (const seat of selection) {
      perTier.set(seat.ticketTypeId, (perTier.get(seat.ticketTypeId) ?? 0) + 1);
      if (seat.kind === "wheelchair") wheelchair += 1;
      if (seat.kind === "companion") companion += 1;
      if (seat.blocked) blocked += 1;
    }
    return (
      <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
        <h2 id={`${id}-h`} className="font-heading text-lg">
          {selection.length} seats selected
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
          {[...perTier].map(([tierId, n]) => (
            <div key={tierId} className="contents">
              <dt>{tierName(tierId)}</dt>
              <dd className="text-right tabular-nums">{n}</dd>
            </div>
          ))}
          <dt className="text-muted">Wheelchair</dt>
          <dd className="text-right tabular-nums">{wheelchair}</dd>
          <dt className="text-muted">Companion</dt>
          <dd className="text-right tabular-nums">{companion}</dd>
          <dt className="text-muted">Blocked</dt>
          <dd className="text-right tabular-nums">{blocked}</dd>
        </dl>
      </section>
    );
  }

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-4">
      <h2 id={`${id}-h`} className="font-heading text-lg">
        Map totals
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="eyebrow border-b border-foreground text-muted">
            <th scope="col" className="py-2 text-left font-medium">
              Tier
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Seats
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              <abbr title="Wheelchair spaces">WC</abbr>
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              <abbr title="Companion seats">Comp</abbr>
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              <abbr title="Blocked">Blk</abbr>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...stats.byTier].map(([tierId, s]) => (
            <tr key={tierId} className="border-b border-surface-border">
              <th scope="row" className="py-2 text-left font-normal">
                {tierName(tierId)}
              </th>
              <td className="py-2 text-right tabular-nums">{s.seats}</td>
              <td className="py-2 text-right tabular-nums">{s.wheelchair}</td>
              <td className="py-2 text-right tabular-nums">{s.companion}</td>
              <td className="py-2 text-right tabular-nums">{s.blocked}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <th scope="row" className="py-2 text-left">
              Total
            </th>
            <td className="py-2 text-right tabular-nums">{stats.total.seats}</td>
            <td className="py-2 text-right tabular-nums">{stats.total.wheelchair}</td>
            <td className="py-2 text-right tabular-nums">{stats.total.companion}</td>
            <td className="py-2 text-right tabular-nums">{stats.total.blocked}</td>
          </tr>
        </tbody>
      </table>
      <div className="flex flex-col gap-2">
        <h3 className="eyebrow text-muted">Issues</h3>
        {issues.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="flex flex-col">
            {issues.map((issue) => (
              <li key={issue.path} className="border-t border-surface-border">
                {issue.seatIds.length > 0 ? (
                  <button type="button" onClick={() => onSelectIssue(issue)} className="flex min-h-11 w-full flex-col items-start py-2 text-left">
                    <span className="text-sm text-danger">{issue.message}</span>
                    <span className="meta text-muted">
                      {issue.path} · select {issue.seatIds.length} {issue.seatIds.length === 1 ? "seat" : "seats"}
                    </span>
                  </button>
                ) : (
                  <p className="py-2 text-sm text-danger">{issue.message}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
