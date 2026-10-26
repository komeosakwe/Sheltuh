// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import AdminSessionExpired, { AdminOwnerProvider } from "@/components/admin/AdminSessionExpired";
import AdminShell from "@/components/admin/AdminShell";
import Composer, { type SendOutcome } from "@/components/messages/Composer";
import MessagesGate from "@/components/messages/MessagesGate";
import ReportDialog, { type ReportOutcome } from "@/components/messages/ReportDialog";
import SessionExpiredNotice from "@/components/messages/SessionExpiredNotice";
import type { GetToken } from "@/lib/api/client";
import type { ReportReason } from "@/lib/api/types";
import { sameAccount } from "@/lib/auth/account";
import { SessionExpiredError, type AuthContextValue } from "@/lib/auth/AuthContext";
import { useAccountOwner } from "@/lib/auth/useAccountOwner";
import { fakeAuthValue, FakeAuthProvider, switchableSession } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({ usePathname: () => "/messages/c1", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
// The admin sub-nav's counts: not what's tested here.
vi.mock("@/components/admin/AdminSubNav", () => ({ default: () => null }));

// jsdom has no modal dialogs: give <dialog> what a browser would.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(cleanup);

const A: Partial<AuthContextValue> = { status: "signed-in", userId: "user-a", email: "a@example.com", accessToken: "a" };
const B: Partial<AuthContextValue> = { status: "signed-in", userId: "user-b", email: "b@example.com", accessToken: "b" };
const SIGNED_OUT: Partial<AuthContextValue> = { status: "signed-out", userId: undefined, email: undefined, accessToken: undefined };

/** `ui` under an auth state that can change underneath it (another tab, an expiry). */
function mount(ui: ReactNode, initial: Partial<AuthContextValue>) {
  const tree = (auth: Partial<AuthContextValue>) => <FakeAuthProvider value={fakeAuthValue(auth)}>{ui}</FakeAuthProvider>;
  const view = render(tree(initial));
  return (auth: Partial<AuthContextValue>) => act(() => view.rerender(tree(auth)));
}

describe("sameAccount", () => {
  it("compares user ids when both have one, otherwise emails (any case); nothing known is never a match", () => {
    expect(sameAccount({ userId: "u1", email: "a@x.com" }, { userId: "u1", email: "new@x.com" })).toBe(true);
    expect(sameAccount({ userId: "u1", email: "a@x.com" }, { userId: "u2", email: "a@x.com" })).toBe(false);
    expect(sameAccount({ email: " A@X.com " }, { userId: "u1", email: "a@x.com" })).toBe(true);
    expect(sameAccount({ email: "a@x.com" }, { email: "b@x.com" })).toBe(false);
    expect(sameAccount({}, {})).toBe(false);
    expect(sameAccount(undefined, { email: "a@x.com" })).toBe(false);
  });
});

describe("useAccountOwner", () => {
  function hook(initial: Partial<AuthContextValue>) {
    let auth = initial;
    const result = renderHook(() => useAccountOwner(), {
      wrapper: ({ children }) => <FakeAuthProvider value={fakeAuthValue(auth)}>{children}</FakeAuthProvider>,
    });
    return {
      result: result.result,
      become: (next: Partial<AuthContextValue>) => {
        auth = next;
        result.rerender();
      },
    };
  }

  it("keeps the account signed in when it mounted, through a sign-out and someone else signing in", () => {
    const { result, become } = hook(A);
    expect(result.current).toMatchObject({ owner: { userId: "user-a", email: "a@example.com" }, otherAccount: false });
    become(SIGNED_OUT);
    expect(result.current).toMatchObject({ owner: { userId: "user-a", email: "a@example.com" }, otherAccount: false });
    become(B);
    expect(result.current).toMatchObject({ owner: { userId: "user-a", email: "a@example.com" }, otherAccount: true });
    become(A);
    expect(result.current.otherAccount).toBe(false);
  });

  it("mounted while loading, it's the first account to be signed in", () => {
    const { result, become } = hook({ status: "loading", userId: undefined, email: undefined });
    expect(result.current.owner).toBeUndefined();
    become(B);
    expect(result.current).toMatchObject({ owner: { userId: "user-b", email: "b@example.com" }, otherAccount: false });
    become(A);
    expect(result.current.otherAccount).toBe(true);
  });
});

describe("useAccountOwner: getOwnerToken", () => {
  it("asks for the owner's token, read at call time: another account's session (or none) is refused", async () => {
    const session = switchableSession({ userId: "user-a", email: "a@example.com" });
    const { result } = renderHook(() => useAccountOwner(), {
      wrapper: ({ children }) => <FakeAuthProvider value={fakeAuthValue({ ...A, ...session.auth })}>{children}</FakeAuthProvider>,
    });
    await expect(result.current.getOwnerToken()).resolves.toBe("user-a-token");
    // Nothing re-rendered: React still says A, but the stored session is B's now.
    session.become({ userId: "user-b", email: "b@example.com" });
    expect(result.current.otherAccount).toBe(false);
    await expect(result.current.getOwnerToken()).rejects.toBeInstanceOf(SessionExpiredError);
    session.become(undefined);
    await expect(result.current.getOwnerToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(session.auth.getAccessTokenFor).toHaveBeenCalledWith({ userId: "user-a", email: "a@example.com" });
  });

  it("with no owner yet (nobody has been signed in), it's an expired session", async () => {
    const { result } = renderHook(() => useAccountOwner(), {
      wrapper: ({ children }) => <FakeAuthProvider value={fakeAuthValue(SIGNED_OUT)}>{children}</FakeAuthProvider>,
    });
    await expect(result.current.getOwnerToken()).rejects.toBeInstanceOf(SessionExpiredError);
  });
});

describe("the messaging recovery is locked to whoever wrote the draft, not to the live session", () => {
  it("Composer: once someone else is signed in, it never sends as them, and asks for the writer's sign-in", async () => {
    const onSend = vi.fn<(body: string) => Promise<SendOutcome>>().mockResolvedValue({ ok: true });
    const become = mount(<Composer otherName="Sam" mode="reply" onSend={onSend} returnTo="/messages/c1" />, A);
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: "See you there" } });

    await become(B);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText(/Your session has expired/)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("a@example.com");
    expect(screen.getByText(/^You're signed in as a different account/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Message/)).toHaveValue("See you there");
  });

  it("Composer: an expiry reported by the thread shows the writer's account even though the session has gone", async () => {
    const onSend = vi.fn<(body: string) => Promise<SendOutcome>>().mockResolvedValue({ ok: false, session: true });
    const become = mount(<Composer otherName="Sam" mode="reply" onSend={onSend} returnTo="/messages/c1" />, A);
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: "See you there" } });
    await become(SIGNED_OUT);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Email")).toHaveValue("a@example.com");
    expect(screen.getByLabelText("Email")).toHaveProperty("readOnly", true);
  });

  it("Composer: sends with a token getter bound to the writer, so a change after its check is refused", async () => {
    const session = switchableSession({ userId: "user-a", email: "a@example.com" });
    const onSend = vi.fn(async (_body: string, getToken: GetToken): Promise<SendOutcome> => {
      session.become({ userId: "user-b", email: "b@example.com" }); // After the check, before the request.
      await expect(getToken()).rejects.toBeInstanceOf(SessionExpiredError);
      return { ok: false, session: true };
    });
    mount(<Composer otherName="Sam" mode="reply" onSend={onSend} returnTo="/messages/c1" />, { ...A, ...session.auth });
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: "See you there" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Email")).toHaveValue("a@example.com");
    expect(screen.getByLabelText(/Message/)).toHaveValue("See you there");
  });

  it("ReportDialog: once someone else is signed in, the report isn't sent, and the sign-in is the writer's", async () => {
    const onSubmit = vi.fn<(reason: ReportReason, details: string | undefined, getToken: GetToken) => Promise<ReportOutcome>>();
    const become = mount(
      <ReportDialog open otherName="Sam" onClose={vi.fn()} onSubmit={onSubmit} returnTo="/messages/c1" />,
      A,
    );
    const dialog = screen.getByRole("dialog", { name: "Report Sam" });
    fireEvent.click(within(dialog).getAllByRole("radio")[0]);
    await become(B);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(await within(dialog).findByText(/Your session has expired/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("Email")).toHaveValue("a@example.com");
  });

  it("ReportDialog: sends with a token getter bound to the writer, so a change after its check is refused", async () => {
    const session = switchableSession({ userId: "user-a", email: "a@example.com" });
    const onSubmit = vi.fn(async (_r: ReportReason, _d: string | undefined, getToken: GetToken): Promise<ReportOutcome> => {
      session.become({ userId: "user-b", email: "b@example.com" });
      await expect(getToken()).rejects.toBeInstanceOf(SessionExpiredError);
      return { ok: false, session: true };
    });
    mount(<ReportDialog open otherName="Sam" onClose={vi.fn()} onSubmit={onSubmit} returnTo="/messages/c1" />, {
      ...A,
      ...session.auth,
    });
    const dialog = screen.getByRole("dialog", { name: "Report Sam" });
    fireEvent.click(within(dialog).getAllByRole("radio")[0]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(await within(dialog).findByText(/Your session has expired/)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByLabelText("Email")).toHaveValue("a@example.com");
  });

  it("SessionExpiredNotice takes the owner it's given, whatever the live session says", () => {
    mount(<SessionExpiredNotice what="message" owner={{ userId: "user-a", email: "a@example.com" }} onSignedIn={vi.fn()} />, B);
    expect(screen.getByLabelText("Email")).toHaveValue("a@example.com");
  });

  it("AdminSessionExpired is locked to the admin the pages were opened as (AdminOwnerProvider)", async () => {
    const admin = { ...A, isAdmin: true };
    const become = mount(
      <AdminOwnerProvider>
        <AdminSessionExpired then="try again" onSignedIn={vi.fn()} />
      </AdminOwnerProvider>,
      admin,
    );
    await become({ ...B, isAdmin: true });
    expect(screen.getByLabelText("Email")).toHaveValue("a@example.com");
  });
});

/** Something with state of its own, to tell a remount (it's back to empty) from a re-render. */
function Draft() {
  const [text, setText] = useState("");
  return <input aria-label="Draft" value={text} onChange={(e) => setText(e.target.value)} />;
}

describe("account-keyed trees: another account never gets the last one's page", () => {
  it("AdminShell: another admin signing in remounts every admin page; the same admin signing in again keeps it", async () => {
    const become = mount(
      <AdminShell>
        <Draft />
      </AdminShell>,
      { ...A, isAdmin: true },
    );
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Rejection reason" } });
    await become({ ...A, isAdmin: true, accessToken: "a-refreshed", lastSignInAt: "2026-10-25T11:00:00Z" });
    expect(screen.getByLabelText("Draft")).toHaveValue("Rejection reason");
    await become({ ...B, isAdmin: true });
    expect(screen.getByLabelText("Draft")).toHaveValue("");
  });

  it("MessagesGate: a direct switch to another account remounts the page (no last account's thread)", async () => {
    const become = mount(<MessagesGate returnTo="/messages" demo={null}>{() => <Draft />}</MessagesGate>, A);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "See you there" } });
    await become({ ...A, accessToken: "a-refreshed" });
    expect(screen.getByLabelText("Draft")).toHaveValue("See you there");
    await become(B);
    await waitFor(() => expect(screen.getByLabelText("Draft")).toHaveValue(""));
  });
});
