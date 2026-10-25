// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditEventPageContent from "@/components/dashboard/EditEventPageContent";
import NewEventPageContent from "@/components/dashboard/NewEventPageContent";
import PublicProfilePanel from "@/components/dashboard/PublicProfilePanel";
import type { OrganiserRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { useKeptWhileSignedOut } from "@/lib/auth/useKeptWhileSignedOut";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({ useParams: () => ({ eventId: "evt-1" }), useRouter: () => ({ push: vi.fn() }) }));

/** What useOrganiser says right now (set per step). */
let organiserState: { loading: boolean; organiser: Partial<OrganiserRecord> | null; error: string | null } = {
  loading: false,
  organiser: null,
  error: null,
};
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ ...organiserState, refreshing: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/api/events", () => ({
  getMyEvent: vi.fn().mockResolvedValue({ eventId: "evt-1", title: "Night Market", status: "draft", ticketingMode: "external" }),
}));

// Stand-ins for the forms: an uncontrolled field (its value lives in the DOM) and a mount count.
const mounts = { editor: 0, profile: 0 };
function CountMount({ name }: { name: keyof typeof mounts }) {
  useEffect(() => {
    mounts[name] += 1;
  }, [name]);
  return <input aria-label={`${name} draft`} defaultValue="" />;
}
vi.mock("@/components/dashboard/EventEditor", () => ({ default: () => <CountMount name="editor" /> }));
vi.mock("@/components/dashboard/PublicProfileForm", () => ({ default: () => <CountMount name="profile" /> }));
vi.mock("@/components/dashboard/OrganiserLogoField", () => ({ default: () => null }));

const APPROVED = { organiserId: "org-1", status: "approved" } as const;
const SIGNED_IN: Partial<AuthContextValue> = { status: "signed-in", userId: "user-a", email: "a@example.com" };
const SIGNED_OUT: Partial<AuthContextValue> = { status: "signed-out", userId: undefined, email: undefined };

beforeEach(() => {
  mounts.editor = 0;
  mounts.profile = 0;
  organiserState = { loading: false, organiser: APPROVED, error: null };
});
afterEach(cleanup);

function mount(ui: React.ReactNode, initial: Partial<AuthContextValue>) {
  const tree = (auth: Partial<AuthContextValue>) => <FakeAuthProvider value={fakeAuthValue(auth)}>{ui}</FakeAuthProvider>;
  const view = render(tree(initial));
  return async (auth: Partial<AuthContextValue>, organiser: typeof organiserState) => {
    organiserState = organiser;
    await act(async () => view.rerender(tree(auth)));
  };
}

describe("pages keep a form mounted (with its draft) while its session has run out", () => {
  it("/dashboard/<event>: the editor stays through a sign-out and the reload after signing in again", async () => {
    const become = mount(<EditEventPageContent />, SIGNED_IN);
    const field = await screen.findByLabelText("editor draft");
    fireEvent.change(field, { target: { value: "New title" } });

    await become(SIGNED_OUT, { loading: false, organiser: null, error: null });
    expect(screen.queryByText("You need an approved organiser application to manage events.")).toBeNull();
    expect(screen.getByLabelText("editor draft")).toHaveValue("New title");

    await become(SIGNED_IN, { loading: true, organiser: null, error: null });
    expect(screen.getByLabelText("editor draft")).toHaveValue("New title");
    await become(SIGNED_IN, { loading: false, organiser: APPROVED, error: null });
    expect(screen.getByLabelText("editor draft")).toHaveValue("New title");
    expect(mounts.editor).toBe(1);
  });

  it("/dashboard/<event>: arriving signed out shows the message, with no editor", async () => {
    organiserState = { loading: false, organiser: null, error: null };
    mount(<EditEventPageContent />, SIGNED_OUT);
    expect(screen.getByText("You need an approved organiser application to manage events.")).toBeInTheDocument();
    expect(screen.queryByLabelText("editor draft")).toBeNull();
  });

  it("/dashboard/new: the new event's editor stays through a sign-out and loading again", async () => {
    const become = mount(<NewEventPageContent />, SIGNED_IN);
    fireEvent.change(screen.getByLabelText("editor draft"), { target: { value: "Night Market" } });
    await become(SIGNED_OUT, { loading: false, organiser: null, error: null });
    expect(screen.queryByText("You need an approved organiser application to create events.")).toBeNull();
    await become(SIGNED_IN, { loading: true, organiser: null, error: null });
    await become(SIGNED_IN, { loading: false, organiser: APPROVED, error: null });
    expect(screen.getByLabelText("editor draft")).toHaveValue("Night Market");
    expect(mounts.editor).toBe(1);
  });

  it("/dashboard/new: arriving signed out, or as an organiser not yet approved, shows the message", async () => {
    organiserState = { loading: false, organiser: null, error: null };
    mount(<NewEventPageContent />, SIGNED_OUT);
    expect(screen.getByText("You need an approved organiser application to create events.")).toBeInTheDocument();
    cleanup();
    organiserState = { loading: false, organiser: { organiserId: "org-1", status: "pending" }, error: null };
    mount(<NewEventPageContent />, SIGNED_IN);
    expect(screen.getByText("You need an approved organiser application to create events.")).toBeInTheDocument();
    expect(screen.queryByLabelText("editor draft")).toBeNull();
  });

  it("/dashboard/profile: the profile form stays through a sign-out and loading again", async () => {
    const become = mount(<PublicProfilePanel />, SIGNED_IN);
    const field = screen.getByLabelText("profile draft");
    fireEvent.change(field, { target: { value: "New bio" } });

    await become(SIGNED_OUT, { loading: false, organiser: null, error: null });
    expect(screen.queryByText("Sign in to edit your organiser profile.")).toBeNull();
    await become(SIGNED_IN, { loading: true, organiser: null, error: null });
    await become(SIGNED_IN, { loading: false, organiser: APPROVED, error: null });
    expect(screen.getByLabelText("profile draft")).toHaveValue("New bio");
    expect(mounts.profile).toBe(1);
  });
});

describe("useKeptWhileSignedOut", () => {
  it("is the value while settled, the last settled value while not, and undefined before it ever settled", () => {
    const { result, rerender } = renderHook(({ value, settled }) => useKeptWhileSignedOut(value, settled), {
      initialProps: { value: "first", settled: false },
    });
    expect(result.current).toBeUndefined();
    rerender({ value: "a", settled: true });
    expect(result.current).toBe("a");
    rerender({ value: "ignored", settled: false });
    expect(result.current).toBe("a");
    rerender({ value: "b", settled: true });
    expect(result.current).toBe("b");
    rerender({ value: "c", settled: false });
    expect(result.current).toBe("b");
  });
});
