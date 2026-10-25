// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminSessionExpired, { AdminOwnerProvider } from "@/components/admin/AdminSessionExpired";
import Composer, { type SendOutcome } from "@/components/messages/Composer";
import SessionExpiredNotice from "@/components/messages/SessionExpiredNotice";
import { sameAccount } from "@/lib/auth/account";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { useAccountOwner } from "@/lib/auth/useAccountOwner";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({ usePathname: () => "/messages/c1", useRouter: () => ({ push: vi.fn() }) }));

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
    expect(result.current).toEqual({ owner: { userId: "user-a", email: "a@example.com" }, otherAccount: false });
    become(SIGNED_OUT);
    expect(result.current).toEqual({ owner: { userId: "user-a", email: "a@example.com" }, otherAccount: false });
    become(B);
    expect(result.current).toEqual({ owner: { userId: "user-a", email: "a@example.com" }, otherAccount: true });
    become(A);
    expect(result.current.otherAccount).toBe(false);
  });

  it("mounted while loading, it's the first account to be signed in", () => {
    const { result, become } = hook({ status: "loading", userId: undefined, email: undefined });
    expect(result.current.owner).toBeUndefined();
    become(B);
    expect(result.current).toEqual({ owner: { userId: "user-b", email: "b@example.com" }, otherAccount: false });
    become(A);
    expect(result.current.otherAccount).toBe(true);
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
