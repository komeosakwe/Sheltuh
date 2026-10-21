// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AdminHomePage from "@/app/admin/page";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

afterEach(cleanup);

describe("Admin home", () => {
  it("links an admin to every admin tool, including ticket emails", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
        <AdminHomePage />
      </FakeAuthProvider>,
    );
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toEqual(["/admin/organisers", "/admin/events", "/admin/reports", "/admin/emails"]);
    expect(screen.getByRole("link", { name: /Ticket emails/ })).toHaveAttribute("href", "/admin/emails");
  });

  it("shows no admin links to a member without admin access", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ isAdmin: false })}>
        <AdminHomePage />
      </FakeAuthProvider>,
    );
    expect(screen.queryByRole("link", { name: /Ticket emails/ })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Your account doesn’t have admin access.");
  });
});
