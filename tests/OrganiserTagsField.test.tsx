// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserTagsField, { ownWordError } from "@/components/dashboard/OrganiserTagsField";
import { ApiError } from "@/lib/api/client";
import { ORGANISER_TAGS, parseCustomTag, TAG_SET_ERRORS } from "@/lib/api/organiser-tags";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const setOrganiserTags = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  setOrganiserTags: (...args: unknown[]) => setOrganiserTags(...args),
}));

const RECORD: OrganiserRecord = {
  ownerUserId: "user-1",
  organiserId: "org-1",
  displayName: "Northside Noise",
  contactEmail: "org@example.com",
  description: "Loud nights in small rooms.",
  categories: ["live-music", "pop-up"],
  status: "approved",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  profileTags: null,
  customTags: [],
};

beforeEach(() => {
  // A block, not an arrow returning the mock: vitest would call a returned function as teardown.
  setOrganiserTags.mockReset();
});
afterEach(cleanup);

function renderField(record: OrganiserRecord = RECORD) {
  return render(
    <FakeAuthProvider value={fakeAuthValue()}>
      <OrganiserTagsField organiser={record} />
    </FakeAuthProvider>,
  );
}

const chip = (label: string) => screen.getByRole("button", { name: label });
const pressedLabels = () =>
  within(screen.getByRole("group", { name: "From the list" }))
    .getAllByRole("button", { pressed: true })
    .map((b) => b.textContent);
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save categories" }));

describe("OrganiserTagsField", () => {
  it("lists all 18 as toggle chips in list order, inside a Categories fieldset that describes the rules and count", () => {
    renderField({ ...RECORD, profileTags: [], customTags: [] });
    const group = screen.getByRole("group", { name: "From the list" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(ORGANISER_TAGS.map((t) => t.label));
    for (const button of within(group).getAllByRole("button")) expect(button).toHaveAttribute("aria-pressed", "false");
    const fieldset = screen.getByRole("group", { name: "Categories" });
    expect(fieldset).toHaveAccessibleDescription(/Up to 5, shown on your profile under your name\..*0 of 5 chosen/);
    expect(screen.queryByText(/We’ve started you with your event categories/)).toBeNull();
  });

  it("before they've chosen, starts from their event categories mapped to the list, and says so", () => {
    renderField();
    expect(pressedLabels()).toEqual(["Live music", "Pop-ups & markets"]);
    expect(screen.getByText("2 of 5 chosen")).toBeInTheDocument();
    expect(screen.getByText(/We’ve started you with your event categories\. Save to keep them, or change them\./)).toBeInTheDocument();
  });

  it("at 5, the rest are unavailable but focusable, and pressing one says why", async () => {
    renderField({ ...RECORD, profileTags: ["live-music", "art", "film", "dance"], customTags: ["Late-night"] });
    expect(screen.getByText("5 of 5 chosen")).toBeInTheDocument();
    const comedy = chip("Comedy");
    expect(comedy).toHaveAttribute("aria-disabled", "true");
    expect(comedy).toHaveClass("text-disabled", "cursor-not-allowed");
    fireEvent.click(comedy);
    expect(comedy).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("That’s 5. Unselect one to choose another."));
    // Adding an own word is unavailable too, and says what to do.
    const add = screen.getByRole("button", { name: "Add your own word" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAccessibleDescription("Unselect one from the list to add your own word.");
    // Unselecting one frees the rest.
    fireEvent.click(chip("Art"));
    expect(chip("Comedy")).not.toHaveAttribute("aria-disabled");
  });

  it("adds an own-word row and focuses it; at most 2; Remove sends focus to Add", async () => {
    renderField({ ...RECORD, profileTags: [], customTags: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add your own word" }));
    await waitFor(() => expect(screen.getByLabelText("Own word 1")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Add your own word" }));
    await waitFor(() => expect(screen.getByLabelText("Own word 2")).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Add your own word" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove own word 2" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add your own word" })).toHaveFocus());
    expect(screen.queryByLabelText("Own word 2")).toBeNull();
  });

  it("checks own words as they're typed with the API's own messages; too short waits for the field to be left", () => {
    renderField({ ...RECORD, profileTags: [], customTags: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add your own word" }));
    const input = screen.getByLabelText("Own word 1");
    const type = (value: string) => fireEvent.change(input, { target: { value } });
    const errorText = () => document.getElementById("tag-own-0-error")?.textContent ?? null;

    type("a");
    expect(errorText()).toBeNull();
    fireEvent.blur(input);
    expect(errorText()).toBe("Use at least 2 characters.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Use at least 2 characters\./);

    for (const value of ["Official", "@north", "visit.com", "🔥 nights", "x".repeat(25)]) {
      type(value);
      const result = parseCustomTag(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(errorText()).toBe(result.error);
    }
    type("Live music");
    expect(errorText()).toBe(TAG_SET_ERRORS.isLabel);
    type("Late-night");
    expect(errorText()).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("10 / 24")).toBeInTheDocument();
  });

  it("flags an own word repeating an earlier one (case and accents folded)", () => {
    expect(ownWordError([{ value: "Late night", touched: true }, { value: "LATE NIGHT", touched: false }], 1)).toBe(
      TAG_SET_ERRORS.duplicate,
    );
    expect(ownWordError([{ value: "Late night", touched: true }, { value: "", touched: true }], 1)).toBeNull();
  });

  it("won't send with an invalid own word: focuses it instead", async () => {
    renderField({ ...RECORD, profileTags: [], customTags: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add your own word" }));
    fireEvent.change(screen.getByLabelText("Own word 1"), { target: { value: "x" } });
    save();
    await waitFor(() => expect(screen.getByLabelText("Own word 1")).toHaveFocus());
    expect(document.getElementById("tag-own-0-error")).toHaveTextContent("Use at least 2 characters.");
    expect(setOrganiserTags).not.toHaveBeenCalled();
  });

  it("saves the chosen chips and own words (blank rows dropped), then shows what was stored", async () => {
    setOrganiserTags.mockResolvedValue({ ...RECORD, profileTags: ["live-music", "art"], customTags: ["Late night"] });
    renderField();
    fireEvent.click(chip("Pop-ups & markets"));
    fireEvent.click(chip("Art"));
    fireEvent.click(screen.getByRole("button", { name: "Add your own word" }));
    fireEvent.change(screen.getByLabelText("Own word 1"), { target: { value: "  Late   night " } });
    fireEvent.click(screen.getByRole("button", { name: "Add your own word" }));
    save();
    await waitFor(() =>
      expect(setOrganiserTags).toHaveBeenCalledWith(
        { profileTags: ["live-music", "art"], customTags: ["Late night"] },
        expect.any(Function),
      ),
    );
    expect(await screen.findByText("Categories saved. They’re on your public profile now.")).toBeInTheDocument();
    expect(screen.getByLabelText("Own word 1")).toHaveValue("Late night");
    expect(screen.queryByLabelText("Own word 2")).toBeNull();
    expect(screen.queryByText(/We’ve started you with your event categories/)).toBeNull();
    expect(pressedLabels()).toEqual(["Live music", "Art"]);
  });

  it("can't be changed while it saves, so nothing done meanwhile is lost when the stored set replaces it", async () => {
    let resolve: (record: OrganiserRecord) => void = () => {};
    setOrganiserTags.mockReturnValue(new Promise<OrganiserRecord>((r) => (resolve = r)));
    renderField({ ...RECORD, profileTags: ["art"], customTags: ["Late night"] });
    fireEvent.change(screen.getByLabelText("Own word 1"), { target: { value: "Late nights" } });
    save();
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-disabled", "true");

    // Each way of changing the draft is marked unavailable, and does nothing.
    expect(chip("Live music")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(chip("Live music"));
    expect(pressedLabels()).toEqual(["Art"]);
    const word = screen.getByLabelText("Own word 1");
    expect(word).toHaveAttribute("readonly");
    fireEvent.change(word, { target: { value: "Typed while saving" } });
    expect(word).toHaveValue("Late nights");
    const add = screen.getByRole("button", { name: "Add your own word" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(add);
    expect(screen.queryByLabelText("Own word 2")).toBeNull();
    const remove = screen.getByRole("button", { name: "Remove own word 1" });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(remove);
    expect(screen.getByLabelText("Own word 1")).toBeInTheDocument();
    // Submitting again (Enter in a field) doesn't send a second save.
    fireEvent.submit(screen.getByLabelText("Own word 1").closest("form") as HTMLFormElement);
    expect(setOrganiserTags).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ ...RECORD, profileTags: ["art"], customTags: ["Late nights"] }));
    expect(await screen.findByText("Categories saved. They’re on your public profile now.")).toBeInTheDocument();
    expect(pressedLabels()).toEqual(["Art"]);
    expect(screen.getByLabelText("Own word 1")).toHaveValue("Late nights");
    // Editable again once it's saved.
    expect(screen.getByLabelText("Own word 1")).not.toHaveAttribute("readonly");
    expect(chip("Live music")).not.toHaveAttribute("aria-disabled");
    fireEvent.click(chip("Live music"));
    expect(pressedLabels()).toEqual(["Live music", "Art"]);
  });

  it("shows the API's field errors where they belong and focuses the first", async () => {
    setOrganiserTags.mockRejectedValue(
      new ApiError(400, "Check your categories.", { "customTags.0": "One of your own words can't be used. Try another." }),
    );
    renderField({ ...RECORD, profileTags: ["art"], customTags: ["Late night"] });
    save();
    await waitFor(() => expect(screen.getByLabelText("Own word 1")).toHaveFocus());
    expect(screen.getByLabelText("Own word 1")).toHaveAccessibleDescription(/One of your own words can't be used\./);
    expect(screen.getByRole("alert")).toHaveTextContent("Check your categories.");
  });

  it("links the API's list and own-words errors to their groups", async () => {
    setOrganiserTags.mockRejectedValue(
      new ApiError(400, "Check your categories.", {
        profileTags: "Choose from the list.",
        customTags: "Check your own words.",
      }),
    );
    renderField({ ...RECORD, profileTags: ["art"], customTags: ["Late night"] });
    const list = screen.getByRole("group", { name: "From the list" });
    const own = screen.getByRole("group", { name: "In your own words (optional)" });
    expect(list).not.toHaveAttribute("aria-describedby");
    expect(own).toHaveAttribute("aria-describedby", "tags-own-hint");
    save();
    await waitFor(() => expect(list).toHaveAttribute("aria-describedby", "tags-list-error"));
    expect(list).toHaveAccessibleDescription("Choose from the list.");
    expect(own).toHaveAttribute("aria-describedby", "tags-own-hint tags-own-error");
    expect(own).toHaveAccessibleDescription(/Check your own words\.$/);
  });

  it("over 5 (typing into a row added earlier): says so as it happens, under the own words, and again on Save", async () => {
    renderField({ ...RECORD, profileTags: ["live-music", "art", "film"], customTags: ["Late night"] });
    fireEvent.click(screen.getByRole("button", { name: "Add your own word" }));
    fireEvent.click(chip("Dance"));
    expect(screen.getByText("5 of 5 chosen")).toBeInTheDocument();
    const own = screen.getByRole("group", { name: "In your own words (optional)" });
    const tooMany = document.getElementById("tags-too-many");
    expect(tooMany).toHaveAttribute("aria-live", "polite");
    expect(tooMany).toBeEmptyDOMElement();
    expect(own).toHaveAttribute("aria-describedby", "tags-own-hint");

    fireEvent.change(screen.getByLabelText("Own word 2"), { target: { value: "Queer joy" } });
    expect(screen.getByText("6 of 5 chosen")).toBeInTheDocument();
    expect(tooMany).toHaveTextContent(TAG_SET_ERRORS.tooMany);
    expect(own).toHaveAttribute("aria-describedby", "tags-own-hint tags-too-many");
    expect(own).toHaveAccessibleDescription(new RegExp(`${TAG_SET_ERRORS.tooMany}$`));

    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(TAG_SET_ERRORS.tooMany);
    await waitFor(() => expect(screen.getByLabelText("Own word 1")).toHaveFocus());
    expect(setOrganiserTags).not.toHaveBeenCalled();

    // Back to 5: the message and the alert go.
    fireEvent.click(chip("Dance"));
    expect(tooMany).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(own).toHaveAttribute("aria-describedby", "tags-own-hint");
  });

  it("lets everything wrap at large text: chips grow taller, Remove goes under its input, and nothing is wider than the fieldset", () => {
    renderField({ ...RECORD, profileTags: ["live-music", "art", "film", "dance"], customTags: ["Late night"] });
    expect(screen.getByRole("group", { name: "Categories" })).toHaveClass("min-w-0");
    // Pressed, unpressed and (at 5) unavailable chips alike.
    for (const label of ["Live music", "Comedy"]) {
      expect(chip(label)).toHaveClass("h-auto", "min-h-12", "max-w-full", "whitespace-normal");
      expect(chip(label)).not.toHaveClass("h-12", "shrink-0");
    }
    expect(chip("Comedy")).toHaveAttribute("aria-disabled", "true");
    const input = screen.getByLabelText("Own word 1");
    expect(input).toHaveClass("min-w-0", "flex-1", "basis-48", "min-h-12", "sm:min-h-12");
    expect(input.parentElement).toHaveClass("flex", "flex-wrap");
  });

  it("shows a 403 or 409 in the API's words, keeping what was chosen", async () => {
    setOrganiserTags.mockRejectedValue(new ApiError(409, "Your organiser status changed — refresh and try again."));
    renderField({ ...RECORD, profileTags: ["art"], customTags: [] });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your organiser status changed — refresh and try again.");
    expect(pressedLabels()).toEqual(["Art"]);
  });

  it("offers to sign in again in place when the session has expired", async () => {
    setOrganiserTags.mockRejectedValue(new SessionExpiredError());
    renderField({ ...RECORD, profileTags: ["art"], customTags: [] });
    save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(new SessionExpiredError().message);
    await act(async () => {});
    expect(pressedLabels()).toEqual(["Art"]);
  });
});

