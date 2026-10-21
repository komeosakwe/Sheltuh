"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { formatAud } from "@/lib/format";
import { getTicketBuyerTotalCents } from "@/lib/pricing";
import { GENERATOR_LIMITS, type SectionGeneratorOptions } from "@/lib/seating/editing";
import { MAX_SEATED_TIERS, type SeatMapStage, type SeatMapTemplate } from "@/lib/seating/template";
import type { TicketType } from "@/lib/types";

export type GeneratorDraft = Omit<SectionGeneratorOptions, "origin">;

const fieldClass = "min-h-11 px-3 text-base sm:text-sm";
const labelClass = "eyebrow text-muted";

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} id={id}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className={fieldClass}
      />
    </Field>
  );
}

const tierOption = (tier: TicketType) =>
  `${tier.name} · ${tier.priceCents === 0 ? "Free" : `${formatAud(getTicketBuyerTotalCents(tier))} incl. fee`}`;

/**
 * The editor's left panel (docs/design/seating.md §5.13): "Add a section"
 * (rectangular or curved, with a live ghost on the canvas), the Sections
 * list, the stage and the focus point, and the five-tier check.
 */
export default function GeneratorPanel({
  template,
  tiers,
  usableTierIds,
  draft,
  onDraft,
  onAdd,
  onSelectSection,
  onRenameSection,
  onDeleteSection,
  onStage,
  onFocusPoint,
  sectionButtonRef,
  readOnly,
}: {
  template: SeatMapTemplate;
  tiers: TicketType[];
  /** Tiers that can still be used (at most MAX_SEATED_TIERS on a map). */
  usableTierIds: ReadonlySet<string>;
  draft: GeneratorDraft;
  onDraft: (draft: GeneratorDraft) => void;
  onAdd: () => void;
  onSelectSection: (id: string) => void;
  onRenameSection: (id: string) => void;
  onDeleteSection: (id: string) => void;
  onStage: (stage: SeatMapStage | undefined) => void;
  onFocusPoint: (point: { x: number; y: number }) => void;
  /** Focus moves to the newly added section's Select button. */
  sectionButtonRef: (id: string, node: HTMLButtonElement | null) => void;
  readOnly: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof GeneratorDraft>(key: K, value: GeneratorDraft[K]) => {
    setError(null);
    onDraft({ ...draft, [key]: value });
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) return setError("Give the section a name.");
    if (!draft.ticketTypeId) return setError("Choose a price tier.");
    const [rMin, rMax] = GENERATOR_LIMITS.rows;
    const [sMin, sMax] = GENERATOR_LIMITS.seatsPerRow;
    if (!(draft.rows >= rMin && draft.rows <= rMax)) return setError(`Rows: ${rMin} to ${rMax}.`);
    if (!(draft.seatsPerRow >= sMin && draft.seatsPerRow <= sMax)) return setError(`Seats per row: ${sMin} to ${sMax}.`);
    if (template.sections.some((s) => s.label.toLowerCase() === draft.name.trim().toLowerCase())) {
      return setError("Each section needs its own name.");
    }
    onAdd();
  }

  const stage = template.stage;
  return (
    <div className="flex flex-col gap-6">
      {tiers.length > MAX_SEATED_TIERS && (
        <Notice>
          A seat map can use up to {MAX_SEATED_TIERS} price tiers so buyers can tell them apart without colour. Use{" "}
          {MAX_SEATED_TIERS} or fewer here.
        </Notice>
      )}
      {!readOnly && (
        <section aria-labelledby={`${id}-add`} className="flex flex-col gap-3">
          <h2 id={`${id}-add`} className="font-heading text-lg">
            Add a section
          </h2>
          <form noValidate onSubmit={submit} className="flex flex-col gap-3">
            <fieldset className="flex gap-4">
              <legend className={`${labelClass} mb-1`}>Shape</legend>
              {(["rect", "curved"] as const).map((shape) => (
                <label key={shape} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="radio" name={`${id}-shape`} checked={draft.shape === shape} onChange={() => set("shape", shape)} className="size-4" />
                  {shape === "rect" ? "Rectangular" : "Curved"}
                </label>
              ))}
            </fieldset>
            <Field label="Section name" id={`${id}-name`}>
              <input id={`${id}-name`} value={draft.name} maxLength={40} onChange={(e) => set("name", e.target.value)} className={fieldClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Rows" value={draft.rows} min={1} max={50} onChange={(v) => set("rows", v)} />
              <NumberField label="Seats per row" value={draft.seatsPerRow} min={1} max={80} onChange={(v) => set("seatsPerRow", v)} />
            </div>
            <Field label="Row labels" id={`${id}-rowlabels`}>
              <select id={`${id}-rowlabels`} value={draft.rowLabels} onChange={(e) => set("rowLabels", e.target.value as GeneratorDraft["rowLabels"])} className={fieldClass}>
                <option value="alpha">A, B, C… (AA after Z)</option>
                <option value="numeric">1, 2, 3…</option>
              </select>
            </Field>
            <Field label="Rows run" id={`${id}-order`}>
              <select id={`${id}-order`} value={draft.rowOrder} onChange={(e) => set("rowOrder", e.target.value as GeneratorDraft["rowOrder"])} className={fieldClass}>
                <option value="front-to-back">Front to back</option>
                <option value="back-to-front">Back to front</option>
              </select>
            </Field>
            <Field label="Seat numbers" id={`${id}-numbering`}>
              <select
                id={`${id}-numbering`}
                value={draft.seatNumbering}
                onChange={(e) => set("seatNumbering", e.target.value as GeneratorDraft["seatNumbering"])}
                className={fieldClass}
              >
                <option value="ltr">1, 2, 3… left to right</option>
                <option value="rtl">Right to left</option>
                <option value="odd-even">Odd left, even right</option>
              </select>
            </Field>
            <NumberField label="First seat number" value={draft.firstSeat} min={0} onChange={(v) => set("firstSeat", v)} />
            <Field label="Price tier" id={`${id}-tier`}>
              <select id={`${id}-tier`} value={draft.ticketTypeId} onChange={(e) => set("ticketTypeId", e.target.value)} className={fieldClass}>
                <option value="">Choose…</option>
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id} disabled={!usableTierIds.has(tier.id)}>
                    {tierOption(tier)}
                  </option>
                ))}
              </select>
            </Field>
            {draft.shape === "curved" && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Arc (degrees)" value={draft.arcDegrees ?? 60} min={10} max={180} onChange={(v) => set("arcDegrees", v)} />
                <NumberField label="Radius (u)" value={draft.radius ?? 160} min={28} onChange={(v) => set("radius", v)} />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" variant="solid" className="w-full">
              Add section
            </Button>
          </form>
        </section>
      )}

      <section aria-labelledby={`${id}-sections`} className="flex flex-col">
        <h2 id={`${id}-sections`} className="font-heading text-lg">
          Sections
        </h2>
        {template.sections.length === 0 && <p className="mt-2 text-sm text-muted">None yet.</p>}
        <ul className="mt-2 flex flex-col">
          {template.sections.map((section) => {
            const seats = section.rows.reduce((n, row) => n + row.seats.length, 0);
            return (
              <li key={section.id} className="flex min-h-11 flex-col gap-1 border-t border-surface-border py-2">
                <p className="text-sm font-semibold break-words">{section.label}</p>
                <p className="meta text-muted">
                  {section.rows.length} {section.rows.length === 1 ? "row" : "rows"} · {seats} {seats === 1 ? "seat" : "seats"}
                </p>
                <div className="flex flex-wrap gap-x-4">
                  <button
                    ref={(node) => sectionButtonRef(section.id, node)}
                    type="button"
                    onClick={() => onSelectSection(section.id)}
                    aria-label={`Select ${section.label}`}
                    className="min-h-11 text-sm underline underline-offset-4"
                  >
                    Select
                  </button>
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        onClick={() => onRenameSection(section.id)}
                        aria-label={`Rename ${section.label}`}
                        className="min-h-11 text-sm underline underline-offset-4"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSection(section.id)}
                        aria-label={`Delete ${section.label}`}
                        className="min-h-11 text-sm text-danger underline underline-offset-4"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby={`${id}-stage`} className="flex flex-col gap-3">
        <h2 id={`${id}-stage`} className="font-heading text-lg">
          Stage and focus point
        </h2>
        {stage ? (
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Stage X" value={stage.x} min={0} disabled={readOnly} onChange={(v) => onStage({ ...stage, x: v })} />
            <NumberField label="Stage Y" value={stage.y} min={0} disabled={readOnly} onChange={(v) => onStage({ ...stage, y: v })} />
            <NumberField label="Stage W" value={stage.width} min={1} disabled={readOnly} onChange={(v) => onStage({ ...stage, width: v })} />
            <NumberField label="Stage H" value={stage.height} min={1} disabled={readOnly} onChange={(v) => onStage({ ...stage, height: v })} />
          </div>
        ) : (
          !readOnly && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 w-fit"
              onClick={() => onStage({ label: "Stage", x: template.focus.x - 100, y: Math.max(0, template.focus.y - 40), width: 200, height: 80 })}
            >
              Add a stage
            </Button>
          )
        )}
        <p className="text-xs text-muted">The focus point is where &ldquo;Find seats&rdquo; looks for the best seats. Buyers never see it.</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Focus X" value={template.focus.x} min={0} disabled={readOnly} onChange={(v) => onFocusPoint({ ...template.focus, x: v })} />
          <NumberField label="Focus Y" value={template.focus.y} min={0} disabled={readOnly} onChange={(v) => onFocusPoint({ ...template.focus, y: v })} />
        </div>
        {stage && !readOnly && (
          <button
            type="button"
            onClick={() => onFocusPoint({ x: Math.round(stage.x + stage.width / 2), y: Math.round(stage.y + stage.height / 2) })}
            className="min-h-11 w-fit text-sm underline underline-offset-4"
          >
            Reset to stage centre
          </button>
        )}
      </section>
    </div>
  );
}
