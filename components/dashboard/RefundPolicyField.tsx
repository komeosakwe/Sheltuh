import type { Ref } from "react";
import { fieldClass } from "@/components/ui/Field";
import {
  isValidRefundDays,
  MAX_REFUND_DAYS,
  MIN_REFUND_DAYS,
  REFUND_ACL_STATEMENT,
  refundPolicySummary,
  refundTermsLine,
  type RefundPolicy,
  type RefundTerms,
} from "@/lib/refund-policy";

interface Props {
  policy: RefundPolicy;
  onPolicyChange: (policy: RefundPolicy) => void;
  /** The days input as typed (validated on save), kept while the other option is chosen. */
  days: string;
  onDaysChange: (days: string) => void;
  /** fieldErrors.refundPolicy (a 400, or the 409 refusing a less generous policy). */
  policyError?: string;
  /** fieldErrors.refundDays. */
  daysError?: string;
  /**
   * The policy as last saved, to say what a refused tightening (409) can be
   * changed to: "It's currently 7 days: choose 7 or fewer, or keep it."
   */
  savedTerms?: Partial<RefundTerms>;
  /** The event's start as typed (an ISO instant), once it's a real one: the preview's date. */
  startsAt?: string;
  /** The zone the event's times are in, for the preview's date (Melbourne by default). */
  timeZone?: string;
  /** Admin authoring: "the organiser" rather than "you". */
  admin: boolean;
  /** The chosen option's radio, to focus when a save is refused because of the policy. */
  checkedRef?: Ref<HTMLInputElement>;
  /** The days input, focused instead when a refused save was from one number of days to another. */
  daysRef?: Ref<HTMLInputElement>;
  /** The section title's style (the editor's). */
  legendClassName: string;
}

const NONE_ID = "refund-policy-none";
const DAYS_ID = "refund-policy-days";
const POLICY_ERROR_ID = "refundPolicy-error";

/** "It's currently 7 days: choose 7 or fewer, or keep it." for a saved `days_before`; null otherwise. */
export function savedRefundTermsHint(saved: Partial<RefundTerms> | undefined): string | null {
  if (saved?.refundPolicy !== "days_before" || !isValidRefundDays(saved.refundDays)) return null;
  const days = saved.refundDays;
  return `It’s currently ${days} ${days === 1 ? "day" : "days"}: choose ${days} or fewer, or keep it.`;
}

/**
 * The event editor's "Refund policy" section (Sheltüh-ticketed events only:
 * an external event's ticketing site has its own terms; docs/architecture.md,
 * "Refund policy"). A radio group of two cards, each with a line on what it
 * means (as Seating's are): no refunds for change of mind (the default), or
 * refunds up to a number of days before the event. The days input (1–30) is
 * always usable: focusing or typing in it chooses its option, as does a click
 * anywhere on its card. Once the days are valid, a preview says what buyers
 * will see. The help says the Australian Consumer Law line that always goes
 * with it, and that once tickets are sold the policy can only become more
 * generous; a refused tightening says what it is now.
 */
export default function RefundPolicyField({
  policy,
  onPolicyChange,
  days,
  onDaysChange,
  policyError,
  daysError,
  savedTerms,
  startsAt,
  timeZone,
  admin,
  checkedRef,
  daysRef,
  legendClassName,
}: Props) {
  const daysChosen = policy === "days_before";
  const daysNumber = days.trim() === "" ? Number.NaN : Number(days);
  // What buyers will see: dated against the start once there is one, else the plain summary.
  const preview =
    daysChosen && isValidRefundDays(daysNumber)
      ? (refundTermsLine(policy, daysNumber, startsAt, { timeZone }) ?? refundPolicySummary(policy, daysNumber))
      : null;
  const savedHint = policyError ? savedRefundTermsHint(savedTerms) : null;
  const errorRef = policyError ? POLICY_ERROR_ID : null;
  const ids = (...list: (string | null)[]) => list.filter(Boolean).join(" ");
  const chooseDays = () => {
    if (!daysChosen) onPolicyChange("days_before");
  };

  // Each choice is a card; its label (the target) is at least 44px tall and the card's full width.
  const card = "flex min-w-0 rounded-control border border-foreground bg-card text-sm text-foreground has-[:checked]:bg-surface";
  const choice = "flex min-h-11 min-w-0 cursor-pointer items-start gap-3 p-3";

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby="refund-policy-help">
      <legend className={`${legendClassName} mb-3`}>Refund policy</legend>
      <div id="refund-policy-help" className="flex flex-col gap-1 text-xs text-muted">
        <p>
          Buyers see this on the event page and before they pay, always with: &ldquo;{REFUND_ACL_STATEMENT}&rdquo;
        </p>
        <p>
          {admin
            ? "Once tickets have been ordered, it can only become more generous: people keep the refunds they were offered."
            : "After you submit, only Sheltüh can change it, and once tickets have been ordered only to something more generous."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-start">
        <label className={`${card} ${choice}`}>
          <input
            ref={policy === "no_change_of_mind" ? checkedRef : undefined}
            id={NONE_ID}
            type="radio"
            name="refundPolicy"
            value="no_change_of_mind"
            checked={policy === "no_change_of_mind"}
            onChange={() => onPolicyChange("no_change_of_mind")}
            aria-labelledby={`${NONE_ID}-title`}
            aria-describedby={ids(`${NONE_ID}-help`, errorRef)}
            className="mt-0.5 size-5 shrink-0"
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span id={`${NONE_ID}-title`} className="font-semibold">
              No refunds for change of mind
            </span>
            <span id={`${NONE_ID}-help`} className="text-muted">
              Buyers can&rsquo;t get their money back for changing their mind.
            </span>
          </span>
        </label>

        {/* A click anywhere on the card chooses it (its radio and days input are the keyboard's way). */}
        <div className={`${card} cursor-pointer flex-col pb-3`} onClick={chooseDays}>
          <label className={choice}>
            <input
              ref={daysChosen ? checkedRef : undefined}
              id={DAYS_ID}
              type="radio"
              name="refundPolicy"
              value="days_before"
              checked={daysChosen}
              onChange={() => onPolicyChange("days_before")}
              aria-describedby={errorRef ?? undefined}
              className="mt-0.5 size-5 shrink-0"
            />
            <span className="font-semibold">Refunds up to a number of days before the event</span>
          </label>
          {/* Under the choice's words (12px padding + the 20px radio + a 12px gap). */}
          <div className="flex flex-col gap-1 pr-3 pl-11">
            <label htmlFor="refundDays" className="eyebrow cursor-pointer text-muted">
              Days before the event
            </label>
            <input
              ref={daysRef}
              id="refundDays"
              type="number"
              inputMode="numeric"
              min={MIN_REFUND_DAYS}
              max={MAX_REFUND_DAYS}
              step={1}
              value={days}
              onFocus={chooseDays}
              onChange={(e) => {
                chooseDays();
                onDaysChange(e.target.value);
              }}
              aria-invalid={daysError ? true : undefined}
              aria-describedby={ids(
                "refundDays-hint",
                preview ? "refundDays-preview" : null,
                daysError ? "refundDays-error" : null,
              )}
              className={`${fieldClass} max-w-32`}
            />
            <p id="refundDays-hint" className="text-xs text-muted">
              A whole number from {MIN_REFUND_DAYS} to {MAX_REFUND_DAYS}. A bigger number closes refunds earlier.
            </p>
            {preview && (
              <p id="refundDays-preview" data-refund-preview="" className="text-xs text-pretty text-foreground">
                <span className="font-semibold">Buyers will see:</span> {preview}
              </p>
            )}
            {daysError && (
              <p id="refundDays-error" className="text-sm text-danger">
                {daysError}
              </p>
            )}
          </div>
        </div>
      </div>

      {policyError && (
        <div id={POLICY_ERROR_ID} className="flex flex-col gap-1 text-sm text-danger">
          <p>{policyError}</p>
          {savedHint && <p className="font-semibold">{savedHint}</p>}
        </div>
      )}
    </fieldset>
  );
}
