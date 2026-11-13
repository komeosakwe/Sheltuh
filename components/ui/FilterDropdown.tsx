import { Children, isValidElement, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDownIcon } from "@/components/checkout/icons";

/** The words a node renders (an option's label), for the sizer below. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/**
 * A filter dropdown (the rules' Tags & chips board, "Filters"): a native
 * select dressed as a filter, so the keyboard, screen readers and the phone's
 * own picker all work unchanged. 48px tall, radius 8, Label/Button. Default:
 * the page colour with the 1.5px foreground stroke; hover: cream; `active`
 * (a value other than "any" is chosen): foreground-filled with the page
 * colour's label, black in Light and white in Dark. The state is the
 * select's own value, so it's announced as such, never by colour alone.
 *
 * `label` names it for screen readers ("Price"): the select shows the
 * chosen option ("Any price", "Free"), so the name stays even when an option
 * is picked. The label wraps the select, so no id is needed.
 *
 * As wide as its widest option, as a native select is: an invisible sizer
 * holds every option's words, because the rounded list (globals.css, "Dropdown
 * lists": `appearance: base-select`) would size the select to the chosen one,
 * and the row would shift each time a filter changes.
 */
export default function FilterDropdown({
  label,
  active,
  children,
  className = "",
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  const look = active
    ? "border-foreground bg-foreground text-background"
    : "border-foreground bg-background text-foreground hover:bg-hover";
  const optionLabels = Children.toArray(children)
    .filter((child) => isValidElement(child) && child.type === "option")
    .map(textOf);
  return (
    <label data-filter-dropdown="" className={`relative inline-grid max-w-full shrink-0 ${className}`.trim()}>
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        data-filter-sizer=""
        className="label-button invisible col-start-1 row-start-1 flex h-0 flex-col overflow-hidden border-control border-transparent pr-10 pl-4 whitespace-nowrap"
      >
        {optionLabels.map((text, index) => (
          <span key={index}>{text}</span>
        ))}
      </span>
      <select
        data-active={active ? "" : undefined}
        className={`label-button col-start-1 row-start-1 h-12 w-full max-w-full cursor-pointer appearance-none truncate rounded-control border-control pr-10 pl-4 motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${look}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        className={`pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 ${active ? "text-background" : "text-foreground"}`}
      />
    </label>
  );
}
