// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApplicationForm from "@/components/organisers/ApplicationForm";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const applyAsOrganiser = vi.fn();
const resubmitOrganiser = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  applyAsOrganiser: (...args: unknown[]) => applyAsOrganiser(...args),
  resubmitOrganiser: (...args: unknown[]) => resubmitOrganiser(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  applyAsOrganiser.mockReset();
  resubmitOrganiser.mockReset();
});

const APPROVED_RECORD: OrganiserRecord = {
  ownerUserId: "user-1",
  organiserId: "org-1",
  displayName: "My Org",
  contactEmail: "org@example.com",
  description: "d",
  categories: ["live-music"],
  status: "approved",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Organiser name"), { target: { value: "My New Org" } });
  fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "contact@example.com" } });
  fireEvent.change(screen.getByLabelText("Short description"), { target: { value: "We run events." } });
  fireEvent.click(screen.getByLabelText("Live music"));
}

describe("ApplicationForm — session-expiry recovery preserves the form (organiser applications)", () => {
  it("keeps every typed field after an expired-session submit, and only accepts sign-in as the same account", async () => {
    const sessionError = new SessionExpiredError();
    applyAsOrganiser.mockRejectedValueOnce(sessionError).mockResolvedValueOnce(APPROVED_RECORD);
    const signIn = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn();
    const onSuccess = vi.fn();

    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com", signIn, signOut })}>
        <ApplicationForm mode="apply" getToken={vi.fn().mockResolvedValue("token")} onSuccess={onSuccess} />
      </FakeAuthProvider>,
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(sessionError.message));
    expect(screen.getByLabelText("Organiser name")).toHaveValue("My New Org");

    // A different account signing in during recovery must not be allowed to
    // submit this applicant's typed details under itself.
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("owner@example.com", "hunter2"));
    expect(signOut).not.toHaveBeenCalled(); // same account — accepted

    // Fields are still exactly as typed; nothing navigated away.
    expect(screen.getByLabelText("Organiser name")).toHaveValue("My New Org");
    expect(screen.getByLabelText("Contact email")).toHaveValue("contact@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(applyAsOrganiser).toHaveBeenCalledTimes(2);
  });
});

const PUBLIC_NOTE = "Shown publicly on your organiser profile once approved.";

function describedBy(element: HTMLElement): string {
  const ids = element.getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" | ");
}

describe("ApplicationForm — validation errors are announced and focused", () => {
  function renderForm() {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <ApplicationForm mode="apply" getToken={vi.fn().mockResolvedValue("token")} onSuccess={vi.fn()} />
      </FakeAuthProvider>,
    );
  }

  it("flags every missing field, says so in an alert and focuses the first, without submitting", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Website (optional)"), { target: { value: "not a url" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    const name = screen.getByLabelText("Organiser name");
    await waitFor(() => expect(name).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    // The error first, then (for the public fields) the note that they're public.
    const expected: [string, string][] = [
      ["Organiser name", "Enter an organiser name."],
      ["Contact email", "Enter a contact email."],
      ["Short description", `Enter a short description. ${PUBLIC_NOTE}`],
      ["Website (optional)", `Enter a valid URL, including https:// ${PUBLIC_NOTE}`],
    ];
    for (const [label, message] of expected) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(message);
    }
    // Categories: the group is described by the error; each box is invalid.
    const group = screen.getByRole("group", { name: "Event categories" });
    expect(group).toHaveAccessibleDescription("Choose at least one category.");
    expect(screen.getByLabelText("Live music")).toHaveAttribute("aria-invalid", "true");
    expect(applyAsOrganiser).not.toHaveBeenCalled();
  });

  it("moves focus to the first field still wrong (a bad email), then to the categories", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Organiser name"), { target: { value: "My Org" } });
    fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Short description"), { target: { value: "We run events." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    const email = screen.getByLabelText("Contact email");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    expect(screen.getByLabelText("Organiser name")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Organiser name")).not.toHaveAttribute("aria-describedby");

    fireEvent.change(email, { target: { value: "contact@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));
    // The first category box: the group's error is read as focus enters it.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Live music" })).toHaveFocus());
    expect(screen.getAllByRole("checkbox")[0]).toBe(screen.getByRole("checkbox", { name: "Live music" }));
  });

  it("focuses the first field the server refused, with the server's message as the alert", async () => {
    applyAsOrganiser.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", {
        contactEmail: "Enter a valid email address.",
        description: "Keep your description under 2,000 characters.",
      }),
    );
    renderForm();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    const email = screen.getByLabelText("Contact email");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    expect(screen.getByLabelText("Short description")).toHaveAccessibleDescription(
      `Keep your description under 2,000 characters. ${PUBLIC_NOTE}`,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    // What was typed stays.
    expect(email).toHaveValue("contact@example.com");
  });
});

describe("ApplicationForm — optional social profiles", () => {
  function renderForm(mode: "apply" | "resubmit", initial?: OrganiserRecord) {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <ApplicationForm
          mode={mode}
          getToken={vi.fn().mockResolvedValue("token")}
          initial={initial}
          onSuccess={vi.fn()}
        />
      </FakeAuthProvider>,
    );
  }

  it("groups the four handles under 'Social profiles (optional)', noting they'll be public", () => {
    renderForm("apply");
    const group = screen.getByRole("group", { name: "Social profiles (optional)" });
    expect(group).toHaveAccessibleDescription("Shown publicly on your organiser profile once approved.");
    for (const label of ["Instagram username", "TikTok username", "Facebook page", "X username"]) {
      expect(group).toContainElement(screen.getByLabelText(label));
    }
  });

  it("sends handles trimmed, and blank ones as null", async () => {
    applyAsOrganiser.mockResolvedValue(APPROVED_RECORD);
    renderForm("apply");
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Instagram username"), { target: { value: " @my.org " } });
    fireEvent.change(screen.getByLabelText("Facebook page"), { target: { value: "myorgpage" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    await waitFor(() => expect(applyAsOrganiser).toHaveBeenCalledTimes(1));
    expect(applyAsOrganiser.mock.calls[0][0]).toMatchObject({
      instagramHandle: "@my.org",
      tiktokHandle: null,
      facebookPage: "myorgpage",
      xHandle: null,
    });
  });

  it("shows a server error on its handle field", async () => {
    applyAsOrganiser.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", {
        xHandle: "Enter just your X username: up to 15 letters, numbers or underscores.",
      }),
    );
    renderForm("apply");
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("X username"), { target: { value: "way_too_long_for_x_handles" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    const x = screen.getByLabelText("X username");
    await waitFor(() => expect(x).toHaveFocus());
    expect(x).toHaveAttribute("aria-invalid", "true");
    expect(x).toHaveAccessibleDescription(expect.stringContaining("Enter just your X username"));
    expect(describedBy(x)).toContain("up to 15");
  });

  it("cuts a pasted profile URL down to the handle, and leaves other pastes alone", () => {
    renderForm("apply");
    const instagram = screen.getByLabelText("Instagram username");
    fireEvent.paste(instagram, { clipboardData: { getData: () => "https://www.instagram.com/northside.noise/" } });
    expect(instagram).toHaveValue("northside.noise");

    // A post link isn't a profile: the paste goes ahead as normal (the
    // browser inserts it; nothing here changes the value).
    const tiktok = screen.getByLabelText("TikTok username");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { getData: () => "https://www.tiktok.com/@a/video/123" } });
    tiktok.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(tiktok).toHaveValue("");
  });

  it("cuts a typed profile URL down to the handle when leaving the field", () => {
    renderForm("apply");
    const x = screen.getByLabelText("X username");
    fireEvent.change(x, { target: { value: "twitter.com/nsnoise" } });
    expect(x).toHaveValue("twitter.com/nsnoise");
    fireEvent.blur(x);
    expect(x).toHaveValue("nsnoise");

    const facebook = screen.getByLabelText("Facebook page");
    fireEvent.change(facebook, { target: { value: "https://www.facebook.com/groups/abc" } });
    fireEvent.blur(facebook);
    expect(facebook).toHaveValue("https://www.facebook.com/groups/abc");
  });

  it("prefills a resubmission's handles, and clearing one sends null", async () => {
    resubmitOrganiser.mockResolvedValue(APPROVED_RECORD);
    renderForm("resubmit", {
      ...APPROVED_RECORD,
      status: "rejected",
      instagramHandle: "my.org",
      tiktokHandle: "my_org",
    });
    expect(screen.getByLabelText("Instagram username")).toHaveValue("my.org");
    fireEvent.change(screen.getByLabelText("TikTok username"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Resubmit application" }));

    await waitFor(() => expect(resubmitOrganiser).toHaveBeenCalledTimes(1));
    expect(resubmitOrganiser.mock.calls[0][0]).toMatchObject({ instagramHandle: "my.org", tiktokHandle: null });
  });
});

describe("ApplicationForm — website rule and public-profile notes", () => {
  function renderForm(mode: "apply" | "resubmit" = "apply", initial?: OrganiserRecord) {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <ApplicationForm mode={mode} getToken={vi.fn().mockResolvedValue("token")} initial={initial} onSuccess={vi.fn()} />
      </FakeAuthProvider>,
    );
  }

  function submit(mode: "apply" | "resubmit" = "apply") {
    fireEvent.click(screen.getByRole("button", { name: mode === "apply" ? "Submit application" : "Resubmit application" }));
  }

  it("says the description and website are shown publicly once approved", () => {
    renderForm();
    expect(screen.getByLabelText("Short description")).toHaveAccessibleDescription(PUBLIC_NOTE);
    expect(screen.getByLabelText("Website (optional)")).toHaveAccessibleDescription(PUBLIC_NOTE);
    expect(screen.getByRole("group", { name: "Social profiles (optional)" })).toHaveAccessibleDescription(PUBLIC_NOTE);
  });

  it.each([
    ["http://my.example", "Use your site's secure address, starting with https://"],
    ["HTTP://my.example", "Use your site's secure address, starting with https://"],
    ["my.example", "Enter a valid URL, including https://"],
    ["https://bank.example@evil.example", "Enter the address without a username or password."],
    ["https://user:pw@my.example/path", "Enter the address without a username or password."],
  ])("refuses %s before sending, focusing the field", async (value, message) => {
    renderForm();
    fillRequiredFields();
    const website = screen.getByLabelText("Website (optional)");
    fireEvent.change(website, { target: { value } });
    submit();
    await waitFor(() => expect(website).toHaveFocus());
    expect(website).toHaveAttribute("aria-invalid", "true");
    expect(website).toHaveAccessibleDescription(`${message} ${PUBLIC_NOTE}`);
    expect(applyAsOrganiser).not.toHaveBeenCalled();
  });

  it("sends an https:// website (with an @ only in the path)", async () => {
    applyAsOrganiser.mockResolvedValue(APPROVED_RECORD);
    renderForm();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Website (optional)"), {
      target: { value: " https://my.example/@me " },
    });
    submit();
    await waitFor(() => expect(applyAsOrganiser).toHaveBeenCalledTimes(1));
    expect(applyAsOrganiser.mock.calls[0][0]).toMatchObject({ websiteUrl: "https://my.example/@me" });
  });

  it("on a resubmit, keeps an http:// website already on the application if it's left as it is", async () => {
    resubmitOrganiser.mockResolvedValue(APPROVED_RECORD);
    renderForm("resubmit", { ...APPROVED_RECORD, status: "rejected", websiteUrl: "http://old.example" });
    submit("resubmit");
    await waitFor(() => expect(resubmitOrganiser).toHaveBeenCalledTimes(1));
    expect(resubmitOrganiser.mock.calls[0][0]).toMatchObject({ websiteUrl: "http://old.example" });
  });

  it("on a resubmit, refuses a changed http:// website", async () => {
    renderForm("resubmit", { ...APPROVED_RECORD, status: "rejected", websiteUrl: "http://old.example" });
    const website = screen.getByLabelText("Website (optional)");
    fireEvent.change(website, { target: { value: "http://new.example" } });
    submit("resubmit");
    await waitFor(() => expect(website).toHaveFocus());
    expect(website).toHaveAccessibleDescription(
      `Use your site's secure address, starting with https:// ${PUBLIC_NOTE}`,
    );
    expect(resubmitOrganiser).not.toHaveBeenCalled();
  });

  it("shows the server's website error on the field", async () => {
    applyAsOrganiser.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", {
        websiteUrl: "Use your site's secure address, starting with https://",
      }),
    );
    renderForm();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Website (optional)"), { target: { value: "https://ok.example" } });
    submit();
    const website = screen.getByLabelText("Website (optional)");
    await waitFor(() => expect(website).toHaveFocus());
    expect(website).toHaveAttribute("aria-invalid", "true");
    expect(website).toHaveAccessibleDescription(
      `Use your site's secure address, starting with https:// ${PUBLIC_NOTE}`,
    );
  });
});

describe("ApplicationForm — featured video", () => {
  function renderApply(mode: "apply" | "resubmit" = "apply", initial?: OrganiserRecord) {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <ApplicationForm mode={mode} getToken={vi.fn()} initial={initial} onSuccess={vi.fn()} />
      </FakeAuthProvider>,
    );
  }

  it("sends a valid link, and refuses another site's (focused, on the field)", async () => {
    applyAsOrganiser.mockResolvedValue(APPROVED_RECORD);
    renderApply();
    fillRequiredFields();
    const field = screen.getByLabelText("Featured video (optional)");
    fireEvent.change(field, { target: { value: "https://dailymotion.com/video/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));
    await waitFor(() => expect(field).toHaveFocus());
    expect(applyAsOrganiser).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "vimeo.com/76979871" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));
    await waitFor(() =>
      expect(applyAsOrganiser).toHaveBeenCalledWith(expect.objectContaining({ featuredVideoUrl: "vimeo.com/76979871" }), expect.any(Function)),
    );
  });

  it("a resubmission with the field cleared removes the video (null)", async () => {
    resubmitOrganiser.mockResolvedValue(APPROVED_RECORD);
    renderApply("resubmit", { ...APPROVED_RECORD, status: "rejected", featuredVideo: { provider: "vimeo", id: "1" } });
    const field = screen.getByLabelText("Featured video (optional)");
    expect(field).toHaveValue("https://vimeo.com/1");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Resubmit application" }));
    await waitFor(() =>
      expect(resubmitOrganiser).toHaveBeenCalledWith(expect.objectContaining({ featuredVideoUrl: null }), expect.any(Function)),
    );
  });
});
