import type { Ref } from "react";
import { fieldClass } from "@/components/ui/Field";
import { MAX_REFUND_DAYS, MIN_REFUND_DAYS, REFUND_ACL_STATEMENT, type RefundPolicy } from "@/lib/refund-policy";

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
  /** Admin authoring: "the organiser" rather than "you". */
  admin: boolean;
  /** The chosen option's radio, to focus when a save is refused because of the policy. */
  checkedRef?: Ref<HTMLInputElement>;
  /** The section title's style (the editor's). */
  legendClassName: string;
}

const NONE_ID = "refund-policy-none";
const DAYS_ID = "refund-policy-days";

/**
 * The event editor's "Refund policy" section (Sheltüh-ticketed events only:
 * an external event's ticketing site has its own terms; docs/architecture.md,
 * "Refund policy"). A radio group: no refunds for change of mind (the
 * default), or refunds up to a number of days before the event, whose days
 * input (1–30) is enabled only while that option is chosen. The help says
 * what buyers see, the Australian Consumer Law line that always goes with it,
 * and that once tickets are sold the policy can only become more generous.
 */
export default function RefundPolicyField({
  policy,
  onPolicyChange,
  days,
  onDaysChange,
  policyError,
  daysError,
  admin,
  checkedRef,
  legendClassName,
}: Props) {
  const daysChosen = policy === "days_before";
  const describedBy = ["refund-policy-help", policyError ? "refundPolicy-error" : null].filter(Boolean).join(" ");
  // Each choice is a card; its label (the target) is at least 44px tall and the card's full width.
  const card = "flex min-w-0 rounded-control border border-foreground bg-card text-sm text-foreground has-[:checked]:bg-surface";
  const choice = "flex min-h-11 min-w-0 cursor-pointer items-start gap-3 p-3";

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={describedBy}>
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className={`${card} ${choice}`}>
          <input
            ref={policy === "no_change_of_mind" ? checkedRef : undefined}
            id={NONE_ID}
            type="radio"
            name="refundPolicy"
            value="no_change_of_mind"
            checked={policy === "no_change_of_mind"}
            onChange={() => onPolicyChange("no_change_of_mind")}
            className="mt-0.5 size-5 shrink-0"
          />
          <span className="font-semibold">No refunds for change of mind</span>
        </label>

        <div className={`${card} flex-col pb-3`}>
          <label className={choice}>
            <input
              ref={daysChosen ? checkedRef : undefined}
              id={DAYS_ID}
              type="radio"
              name="refundPolicy"
              value="days_before"
              checked={daysChosen}
              onChange={() => onPolicyChange("days_before")}
              className="mt-0.5 size-5 shrink-0"
            />
            <span className="font-semibold">Refunds up to a number of days before the event</span>
          </label>
          {/* Under the choice's words (12px padding + the 20px radio + a 12px gap). */}
          <div className="flex flex-col gap-1 pr-3 pl-11">
            <label htmlFor="refundDays" className="eyebrow text-muted">
              Days before the event
            </label>
            <input
              id="refundDays"
              type="number"
              inputMode="numeric"
              min={MIN_REFUND_DAYS}
              max={MAX_REFUND_DAYS}
              step={1}
              value={days}
              onChange={(e) => onDaysChange(e.target.value)}
              disabled={!daysChosen}
              aria-invalid={daysError ? true : undefined}
              aria-describedby={daysError ? "refundDays-hint refundDays-error" : "refundDays-hint"}
              className={`${fieldClass} max-w-32`}
            />
            <p id="refundDays-hint" className="text-xs text-muted">
              A whole number from {MIN_REFUND_DAYS} to {MAX_REFUND_DAYS}.
            </p>
            {daysError && (
              <p id="refundDays-error" className="text-sm text-danger">
                {daysError}
              </p>
            )}
          </div>
        </div>
      </div>

      {policyError && (
        <p id="refundPolicy-error" className="text-sm text-danger">
          {policyError}
        </p>
      )}
    </fieldset>
  );
}
