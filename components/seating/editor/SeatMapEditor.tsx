"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import type { SeatMapRecord } from "@/lib/api/types";
import {
  addSection,
  alignSeats,
  deleteSeats,
  emptyTemplate,
  fitCanvas,
  generateSection,
  issuesFor,
  moveSeats,
  nextOrigin,
  relabelSeats,
  removeSection,
  renameSection,
  sectionSeatIds,
  templateStats,
  updateSeats,
  usedIds,
  type MapIssue,
  type SeatNumbering,
  type SeatPatch,
} from "@/lib/seating/editing";
import { seatedTierIds, seatedTiers, tierTreatments } from "@/lib/seating/selection";
import { flattenSeats, MAX_SEATED_TIERS, type SeatMapStage, type SeatMapTemplate } from "@/lib/seating/template";
import type { SheltuhEvent } from "@/lib/types";
import SeatDialog from "../SeatDialog";
import { patternIdsFor, SeatPatternDefs } from "../SeatGlyph";
import SeatPicker from "../SeatPicker";
import EditorCanvas, { type SelectMode } from "./EditorCanvas";
import GeneratorPanel, { type GeneratorDraft } from "./GeneratorPanel";
import ImportDialog, { exportSeatMap } from "./ImportExport";
import InspectorPanel from "./InspectorPanel";
import SelectionToolbar, { type Tri } from "./SelectionToolbar";

export type SeatMapStatus = "Draft" | "In review" | "Approved · locked";

const HISTORY_LIMIT = 50;

function tri(values: boolean[]): Tri {
  if (values.length === 0) return false;
  if (values.every(Boolean)) return true;
  return values.some(Boolean) ? "mixed" : false;
}

/**
 * The organiser's seat-map editor (docs/design/seating.md §5.13), for
 * screens 1024px and wider: generators on the left, the canvas in the
 * centre, the inspector on the right, with undo and redo, import and
 * export, and a buyer's preview. Below 1024px it shows the status, counts
 * and a notice, with Import, Export and Preview only. `locked` (approved):
 * read-only, Export and Preview remain.
 */
export default function SeatMapEditor({
  event,
  initial,
  status,
  locked,
  lockedMessage = "This seat map is locked because the event is approved. To change it, contact Sheltüh.",
  onSave,
  onRemove,
}: {
  event: SheltuhEvent;
  initial: SeatMapRecord | null;
  status: SeatMapStatus;
  locked: boolean;
  lockedMessage?: string;
  onSave: (template: SeatMapTemplate) => Promise<SeatMapRecord>;
  onRemove?: () => Promise<void>;
}) {
  const id = useId();
  const patterns = useMemo(() => patternIdsFor(`editor${id}`), [id]);
  const [saved, setSaved] = useState<SeatMapRecord | null>(initial);
  const [template, setTemplate] = useState<SeatMapTemplate>(() => initial?.template ?? emptyTemplate());
  const [past, setPast] = useState<SeatMapTemplate[]>([]);
  const [future, setFuture] = useState<SeatMapTemplate[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [status_, setStatusText] = useState("");
  const [saveError, setSaveError] = useState<{ text: string; lines: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [relabelOpen, setRelabelOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const sectionButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusSection = useRef<string | null>(null);

  const tiers = event.ticketTypes;
  const tierIds = useMemo(() => tiers.map((t) => t.id), [tiers]);
  const sortedTiers = useMemo(() => seatedTiers(tiers, template), [tiers, template]);
  const treatments = useMemo(() => tierTreatments(sortedTiers), [sortedTiers]);
  const usedTiers = useMemo(() => new Set(seatedTierIds(template)), [template]);
  // At most five tiers on a map: once five are used, only those stay choosable (the first five otherwise).
  const usableTierIds = useMemo(
    () => (usedTiers.size >= MAX_SEATED_TIERS ? usedTiers : new Set([...tierIds.slice(0, MAX_SEATED_TIERS), ...usedTiers])),
    [usedTiers, tierIds],
  );
  const seats = useMemo(() => flattenSeats(template), [template]);
  const selection = useMemo(() => seats.filter((seat) => selectedIds.has(seat.id)), [seats, selectedIds]);
  const stats = useMemo(() => templateStats(template), [template]);
  const issues = useMemo(() => issuesFor(template, tierIds), [template, tierIds]);
  const invalid = useMemo(() => new Set(issues.flatMap((issue) => issue.seatIds)), [issues]);
  const dirty = saved ? saved.template !== template : template.sections.length > 0;
  const readOnly = locked;

  const [draft, setDraft] = useState<GeneratorDraft>(() => ({
    shape: "rect",
    name: "",
    rows: 5,
    seatsPerRow: 10,
    rowLabels: "alpha",
    rowOrder: "front-to-back",
    seatNumbering: "ltr",
    firstSeat: 1,
    ticketTypeId: tiers[0]?.id ?? "",
    arcDegrees: 60,
    radius: 160,
  }));
  const ghost = useMemo(() => {
    if (readOnly || !draft.name.trim() || !draft.ticketTypeId || !(draft.rows >= 1 && draft.seatsPerRow >= 1)) return null;
    if (draft.rows > 50 || draft.seatsPerRow > 80) return null;
    return generateSection({ ...draft, origin: nextOrigin(template, draft) }, usedIds(template));
  }, [draft, template, readOnly]);

  function say(text: string) {
    setStatusText((prev) => (prev === text ? `${text} ` : text));
  }

  function commit(next: SeatMapTemplate, message?: string) {
    if (readOnly || next === template) return;
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), template]);
    setFuture([]);
    setTemplate(next);
    setSaveError(null);
    if (message) say(message);
  }

  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [template, ...f]);
    setTemplate(previous);
    say("Undone.");
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, template]);
    setTemplate(next);
    say("Redone.");
  }

  function select(ids: string[], mode: SelectMode) {
    setSelectedIds((prev) => {
      if (mode === "replace") return new Set(ids);
      const next = new Set(prev);
      for (const seatId of ids) {
        if (mode === "toggle" && next.has(seatId)) next.delete(seatId);
        else next.add(seatId);
      }
      return next;
    });
  }

  function patchSelection(patch: SeatPatch, message: string) {
    commit(updateSeats(template, selectedIds, patch), message);
  }

  function add() {
    const result = addSection(template, { ...draft, origin: nextOrigin(template, draft) });
    commit(result.template, `Added ${draft.name.trim()}.`);
    setDraft((d) => ({ ...d, name: "" }));
    focusSection.current = result.sectionId;
    // Focus moves to the new section in the Sections list once it's rendered.
    requestAnimationFrame(() => {
      const target = focusSection.current ? sectionButtons.current.get(focusSection.current) : undefined;
      focusSection.current = null;
      target?.focus();
    });
  }

  async function save() {
    if (readOnly) return;
    if (issues.length > 0) {
      setSaveError({ text: "Fix the issues listed under Map totals, then save again.", lines: [] });
      setSelectedIds(new Set());
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const record = await onSave(template);
      setSaved(record);
      setTemplate(record.template);
      say(`Seat map saved: ${record.seatCount} seats.`);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        setSaveError({ text: err.message, lines: Object.entries(err.fieldErrors).map(([k, v]) => `${k}: ${v}`).slice(0, 10) });
      } else {
        setSaveError({ text: err instanceof Error ? err.message : "Couldn’t save the seat map.", lines: [] });
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!onRemove) return;
    try {
      await onRemove();
      setSaved(null);
      setTemplate(emptyTemplate());
      setPast([]);
      setFuture([]);
      setSelectedIds(new Set());
      setRemoveOpen(false);
      say("Seat map removed. The event is general admission again.");
    } catch (err) {
      setRemoveOpen(false);
      setSaveError({ text: err instanceof Error ? err.message : "Couldn’t remove the seat map.", lines: [] });
    }
  }

  const tierLabel = `${usedTiers.size} ${usedTiers.size === 1 ? "tier" : "tiers"}`;
  const counts = `${stats.total.seats} seats · ${tierLabel}`;
  const selectionTier = selection.length && selection.every((s) => s.ticketTypeId === selection[0].ticketTypeId) ? selection[0].ticketTypeId : "";
  const blockedPositions = seats.filter((seat) => seat.blocked).map((seat) => seat.position);
  const previewEvent: SheltuhEvent = useMemo(
    () => ({ ...event, ticketTypes: event.ticketTypes.map((t) => (usedTiers.has(t.id) ? { ...t, seated: true as const } : t)) }),
    [event, usedTiers],
  );

  const toolbarButton = "btn btn-outline btn-sm min-h-10";
  return (
    <div className="flex flex-col">
      <SeatPatternDefs ids={patterns} />
      <div className="flex flex-wrap items-center gap-2 border-b border-foreground px-4 py-2">
        <h1 className="font-heading mr-2 text-xl">Seat map</h1>
        <span
          className={`eyebrow rounded-badge border border-foreground px-2 py-0.5 ${status === "Approved · locked" ? "bg-foreground text-background" : ""}`}
        >
          {status}
        </span>
        <span className="meta text-muted">{counts}</span>
        {dirty && !readOnly && <span className="meta text-muted">· Unsaved changes</span>}
        <span className="flex-1" />
        {!readOnly && (
          <>
            <button type="button" onClick={undo} aria-disabled={past.length === 0 || undefined} className={`${toolbarButton} hidden lg:inline-flex`}>
              Undo
            </button>
            <button type="button" onClick={redo} aria-disabled={future.length === 0 || undefined} className={`${toolbarButton} hidden lg:inline-flex`}>
              Redo
            </button>
            <button type="button" onClick={() => setImportOpen(true)} className={toolbarButton}>
              Import
            </button>
          </>
        )}
        <button type="button" onClick={() => exportSeatMap(template, event.slug)} className={toolbarButton}>
          Export
        </button>
        <button type="button" aria-pressed={preview} onClick={() => setPreview((v) => !v)} className={toolbarButton}>
          {preview ? "Back to editing" : "Preview as buyer"}
        </button>
        {!readOnly && saved && onRemove && (
          <button type="button" onClick={() => setRemoveOpen(true)} className="btn btn-danger btn-sm min-h-10">
            Remove map
          </button>
        )}
        {!readOnly && (
          <Button variant="solid" size="sm" busy={saving} onClick={save} className="min-h-10">
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>

      <p role="status" className="sr-only">
        {status_}
      </p>
      {readOnly && (
        <div className="px-4 py-3">
          <Notice>{lockedMessage}</Notice>
        </div>
      )}
      {saveError && (
        <div className="px-4 py-3">
          <Notice tone="danger" role="alert">
            <p>{saveError.text}</p>
            {saveError.lines.length > 0 && (
              <ul className="mt-1">
                {saveError.lines.map((line) => (
                  <li key={line} className="meta break-words">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </Notice>
        </div>
      )}

      {preview ? (
        <SeatPicker
          event={previewEvent}
          map={{ version: saved?.version ?? 0, seatCount: seats.length, template }}
          mode="preview"
          initialUnavailable={blockedPositions}
          backHref={`/events/${event.slug}`}
        />
      ) : (
        <>
          <div className="px-4 py-6 lg:hidden">
            <Notice>The seat map editor needs a screen at least 1024px wide.</Notice>
          </div>
          <div className="hidden h-[calc(100dvh-var(--header-h)-3.5rem)] min-h-[36rem] grid-cols-[20rem_minmax(0,1fr)_20rem] lg:grid">
            <div className="overflow-y-auto border-r border-foreground p-4">
              <GeneratorPanel
                template={template}
                tiers={tiers}
                usableTierIds={usableTierIds}
                draft={draft}
                onDraft={setDraft}
                onAdd={add}
                onSelectSection={(sectionId) => {
                  const ids = sectionSeatIds(template, sectionId);
                  select(ids, "replace");
                  say(`${ids.length} seats selected.`);
                }}
                onRenameSection={setRenaming}
                onDeleteSection={setDeleting}
                onStage={(stage: SeatMapStage | undefined) => {
                  if (stage && ![stage.x, stage.y, stage.width, stage.height].every(Number.isFinite)) return;
                  commit(fitCanvas({ ...template, ...(stage ? { stage } : {}) }));
                }}
                onFocusPoint={(point) => {
                  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
                  commit(fitCanvas({ ...template, focus: point }), "Focus point moved.");
                }}
                sectionButtonRef={(sectionId, node) => {
                  if (node) sectionButtons.current.set(sectionId, node);
                  else sectionButtons.current.delete(sectionId);
                }}
                readOnly={readOnly}
              />
            </div>
            <div className="relative min-w-0">
              <EditorCanvas
                template={template}
                selected={selectedIds}
                invalid={invalid}
                ghost={ghost}
                treatments={treatments}
                patterns={patterns}
                readOnly={readOnly}
                onSelect={(ids, mode) => {
                  select(ids, mode);
                }}
                onMove={(dx, dy) => commit(moveSeats(template, selectedIds, dx, dy), "Seats moved.")}
                onFocusPoint={(point) => commit(fitCanvas({ ...template, focus: point }), "Focus point moved.")}
              />
              {!readOnly && selection.length > 0 && (
                <SelectionToolbar
                  count={selection.length}
                  tiers={tiers}
                  usableTierIds={usableTierIds}
                  tier={selectionTier}
                  wheelchair={tri(selection.map((s) => s.kind === "wheelchair"))}
                  companion={tri(selection.map((s) => s.kind === "companion"))}
                  blocked={tri(selection.map((s) => s.blocked))}
                  onTier={(tierId) => patchSelection({ ticketTypeId: tierId }, "Tier changed.")}
                  onKind={(kind) => patchSelection({ kind }, kind === "standard" ? "Set to standard." : `Set to ${kind}.`)}
                  onBlocked={(blocked) => patchSelection({ blocked }, blocked ? "Blocked." : "Unblocked.")}
                  onRelabel={() => setRelabelOpen(true)}
                  onAlign={() => commit(alignSeats(template, selectedIds), "Aligned.")}
                  onNudge={(dx, dy) => commit(moveSeats(template, selectedIds, dx, dy), "Moved.")}
                  onClear={() => setSelectedIds(new Set())}
                  onDelete={() => {
                    const n = selectedIds.size;
                    commit(deleteSeats(template, selectedIds), `Deleted ${n} ${n === 1 ? "seat" : "seats"}.`);
                    setSelectedIds(new Set());
                  }}
                />
              )}
            </div>
            <div className="overflow-y-auto border-l border-foreground p-4">
              <InspectorPanel
                selection={selection}
                tiers={tiers}
                usableTierIds={usableTierIds}
                stats={stats}
                issues={issues}
                readOnly={readOnly}
                onPatch={(patch) => patchSelection(patch, "Seat updated.")}
                onSelectIssue={(issue: MapIssue) => select(issue.seatIds, "replace")}
              />
            </div>
          </div>
        </>
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        ticketTypeIds={tierIds}
        onReplace={(next) => {
          commit(next, "Seat map imported. Save to keep it.");
          setSelectedIds(new Set());
          return null;
        }}
      />

      <RelabelDialog
        open={relabelOpen}
        onClose={() => setRelabelOpen(false)}
        onApply={(rowLabel, firstSeat, direction) => {
          const next = relabelSeats(template, selectedIds, { rowLabel, firstSeat, direction });
          if (!next) return "Select seats in one row to relabel them.";
          commit(next, "Relabelled.");
          return null;
        }}
      />

      <SeatDialog open={renaming !== null} title="Rename section" onClose={() => setRenaming(null)}>
        {renaming && (
          <RenameForm
            initial={template.sections.find((s) => s.id === renaming)?.label ?? ""}
            onCancel={() => setRenaming(null)}
            onRename={(label) => {
              commit(renameSection(template, renaming, label), `Renamed to ${label}.`);
              setRenaming(null);
            }}
          />
        )}
      </SeatDialog>

      <SeatDialog open={deleting !== null} title="Delete section?" onClose={() => setDeleting(null)}>
        <p className="text-base">
          {template.sections.find((s) => s.id === deleting)?.label} and all its seats will be removed. You can undo this before saving.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
          <Button
            variant="danger"
            onClick={() => {
              if (deleting) {
                const label = template.sections.find((s) => s.id === deleting)?.label ?? "Section";
                commit(removeSection(template, deleting), `${label} deleted.`);
                setSelectedIds(new Set());
              }
              setDeleting(null);
            }}
          >
            Delete section
          </Button>
          <Button variant="outline" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
        </div>
      </SeatDialog>

      <SeatDialog open={removeOpen} title="Remove the seat map?" onClose={() => setRemoveOpen(false)}>
        <p className="text-base">The event goes back to general admission. Its tiers keep their names and prices.</p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
          <Button variant="danger" onClick={remove}>
            Remove map
          </Button>
          <Button variant="outline" onClick={() => setRemoveOpen(false)}>
            Cancel
          </Button>
        </div>
      </SeatDialog>
    </div>
  );
}

function RenameForm({ initial, onCancel, onRename }: { initial: string; onCancel: () => void; onRename: (label: string) => void }) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return setError("Give the section a name.");
        onRename(value);
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor={id} className="eyebrow text-muted">
        Section name
      </label>
      <input
        id={id}
        value={value}
        maxLength={40}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="min-h-11 px-3 text-base sm:text-sm"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" variant="solid">
          Rename
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RelabelDialog({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (rowLabel: string, firstSeat: number, direction: SeatNumbering) => string | null;
}) {
  const id = useId();
  const [rowLabel, setRowLabel] = useState("");
  const [firstSeat, setFirstSeat] = useState(1);
  const [direction, setDirection] = useState<SeatNumbering>("ltr");
  const [error, setError] = useState<string | null>(null);
  return (
    <SeatDialog open={open} title="Relabel seats" onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const message = onApply(rowLabel, Number.isFinite(firstSeat) ? firstSeat : 1, direction);
          if (message) setError(message);
          else {
            setError(null);
            onClose();
          }
        }}
        className="flex flex-col gap-3"
      >
        <label htmlFor={`${id}-row`} className="eyebrow text-muted">
          Row label (leave empty to keep it)
        </label>
        <input id={`${id}-row`} value={rowLabel} maxLength={10} onChange={(e) => setRowLabel(e.target.value)} className="min-h-11 px-3 text-base sm:text-sm" />
        <label htmlFor={`${id}-first`} className="eyebrow text-muted">
          First seat number
        </label>
        <input
          id={`${id}-first`}
          type="number"
          min={0}
          value={firstSeat}
          onChange={(e) => setFirstSeat(e.target.valueAsNumber)}
          className="min-h-11 px-3 text-base sm:text-sm"
        />
        <label htmlFor={`${id}-dir`} className="eyebrow text-muted">
          Direction
        </label>
        <select id={`${id}-dir`} value={direction} onChange={(e) => setDirection(e.target.value as SeatNumbering)} className="min-h-11 px-3 text-base sm:text-sm">
          <option value="ltr">Left to right</option>
          <option value="rtl">Right to left</option>
          <option value="odd-even">Odd left, even right</option>
        </select>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
          <Button type="submit" variant="solid">
            Relabel
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </SeatDialog>
  );
}
