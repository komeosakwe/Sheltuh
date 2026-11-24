"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { dashButtonClass } from "./DashButton";
import { CheckIcon } from "./icons";

export interface DashMenuItem {
  key: string;
  label: string;
  /** A second line (Body/S, text/secondary): "Refunds everyone", "Shown in Sheltüh discovery…". */
  description?: string;
  /** "danger": a destructive action (Cancel event), its label in the danger colour. */
  tone?: "default" | "danger";
  /** A row that goes somewhere: a link. Otherwise a button calling `onSelect`. */
  href?: string;
  onSelect?: () => void;
  /** In a `radio` menu: the chosen option (cream fill and a check, aria-checked). */
  checked?: boolean;
  disabled?: boolean;
}

/**
 * "Dash / Menu" (Latte's dashboard frames: the Manage panel's More ··· menu 499:21194 and "Who can
 * find this event?" 499:20969): a button that opens a list of actions, or (`radio`) of options to
 * choose one from. The card is white with the 1.5px foreground stroke, radius 16, 8px inside;
 * each row is at least 44px, Body/S Strong, 16px in, with an optional line under it; the chosen
 * option sits on cream with a check. No hover is drawn: hover and keyboard focus fill a row cream.
 *
 * The ARIA menu-button pattern: the button says aria-haspopup="menu" and aria-expanded; Enter,
 * Space or ↓ opens it on the first row (the chosen one in a radio menu), ↑ on the last; inside, ↑ ↓
 * move round, Home / End jump, a letter moves to the next row starting with it, Enter or Space
 * picks, Escape closes back to the button, Tab closes and moves on. A press outside closes it.
 *
 * The list never runs off the screen: it's at most the screen less 16px a side, and slides back in
 * when its edge would pass that margin (a 336px list on a 320px phone). Under the pointer and
 * keyboard focus a row fills surface/muted; the chosen option keeps the drawn cream.
 */
export default function DashMenu({
  label,
  triggerLabel,
  triggerLabelledBy,
  triggerClassName,
  items,
  menuLabel,
  radio = false,
  align = "end",
  width = "md",
  className = "",
}: {
  /** What the button shows ("More ···", "Public"). */
  label: ReactNode;
  /** The button's name when `label` isn't words (an icon). */
  triggerLabel?: string;
  /**
   * The id of what the button answers ("Who can find this event?"): it's named by that and then its
   * own visible label ("Who can find this event? Public"), so a spoken label still matches (2.5.3).
   */
  triggerLabelledBy?: string;
  /** Replaces the button's look (default: the Outline Dash button). */
  triggerClassName?: string;
  items: DashMenuItem[];
  /** The list's name; defaults to the button's. */
  menuLabel?: string;
  radio?: boolean;
  /** Which edge of the button the list lines up with. */
  align?: "start" | "end";
  /** The list's width: 280 (More ···) or 336 (Who can find this event?), as drawn. */
  width?: "md" | "lg";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const triggerId = `${id}-button`;
  const menuId = `${id}-menu`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);

  // Focus follows the active row while it's open.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  // Kept on screen: slid back in when an edge would pass 16px from the window's.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    menu.style.translate = "";
    const margin = 16;
    const rect = menu.getBoundingClientRect();
    let shift = 0;
    if (rect.right > window.innerWidth - margin) shift = window.innerWidth - margin - rect.right;
    if (rect.left + shift < margin) shift = margin - rect.left;
    if (shift !== 0) menu.style.translate = `${shift}px 0`;
  }, [open]);

  // A press anywhere outside closes it (focus stays where the press put it).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function openAt(where: "first" | "last") {
    if (enabled.length === 0) return;
    const chosen = radio ? items.findIndex((item) => item.checked && !item.disabled) : -1;
    setActive(chosen >= 0 ? chosen : where === "first" ? enabled[0] : enabled[enabled.length - 1]);
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAt("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt("last");
    }
  }

  function move(step: 1 | -1) {
    const at = enabled.indexOf(active);
    setActive(enabled[(at + step + enabled.length) % enabled.length]);
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "Home":
        event.preventDefault();
        setActive(enabled[0]);
        return;
      case "End":
        event.preventDefault();
        setActive(enabled[enabled.length - 1]);
        return;
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        setOpen(false);
        return;
      case " ":
        // A link row is an <a>, which the browser activates on Enter only; Space would scroll the page instead.
        // Buttons already activate on Space, so only links are handled here.
        if (event.target instanceof HTMLAnchorElement) {
          event.preventDefault();
          event.target.click();
        }
        return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLocaleLowerCase("en-AU");
      const at = enabled.indexOf(active);
      const order = [...enabled.slice(at + 1), ...enabled.slice(0, at + 1)];
      const next = order.find((index) => items[index].label.toLocaleLowerCase("en-AU").startsWith(letter));
      if (next !== undefined) setActive(next);
    }
  }

  function pick(item: DashMenuItem) {
    close(true);
    item.onSelect?.();
  }

  return (
    <div ref={rootRef} data-dash-menu="" className={`relative inline-flex ${className}`.trim()}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabelledBy ? undefined : triggerLabel}
        aria-labelledby={triggerLabelledBy ? `${triggerLabelledBy} ${triggerId}` : undefined}
        onClick={() => (open ? close(false) : openAt("first"))}
        onKeyDown={onTriggerKeyDown}
        className={triggerClassName ?? dashButtonClass("outline")}
      >
        {label}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          aria-labelledby={menuLabel ? undefined : triggerId}
          onKeyDown={onMenuKeyDown}
          className={`absolute top-full z-30 mt-2 flex ${width === "lg" ? "w-84" : "w-70"} max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-card border-control border-foreground bg-card p-2 text-foreground ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item, index) => {
            const role = radio ? "menuitemradio" : "menuitem";
            const rowClass = `flex w-full min-h-11 items-center gap-3 rounded-control px-4 py-2 text-left hover:bg-surface focus-visible:bg-surface focus-visible:-outline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:text-disabled aria-disabled:hover:bg-transparent ${
              item.checked ? "bg-hover" : ""
            }`;
            const body = (
              <>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`body-s font-semibold break-words ${item.tone === "danger" ? "text-danger" : ""}`.trim()}>
                    {item.label}
                  </span>
                  {item.description && <span className="body-s break-words text-muted">{item.description}</span>}
                </span>
                {radio && item.checked && <CheckIcon className="size-5" />}
              </>
            );
            const common = {
              role,
              tabIndex: -1,
              "aria-checked": radio ? Boolean(item.checked) : undefined,
              "aria-disabled": item.disabled ? true : undefined,
              "data-menu-item": item.key,
              className: rowClass,
              onMouseEnter: () => !item.disabled && setActive(index),
            } as const;
            if (item.href && !item.disabled) {
              return (
                <Link
                  key={item.key}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  href={item.href}
                  onClick={() => close(false)}
                  {...common}
                >
                  {body}
                </Link>
              );
            }
            return (
              <button
                key={item.key}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                onClick={() => !item.disabled && pick(item)}
                {...common}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
