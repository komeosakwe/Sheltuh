import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { buildInviteEmail, inviteLink, privacyLink } from "@/lib/server/invite-email";

// The account invite email (lib/server/invite-email.ts; docs/architecture.md,
// "Account invites"). Brand and subject cleaning are covered with every other
// email in email-brand.test.ts and email-subjects.test.ts.

const site = "https://sheltuh.test";
const token = "A".repeat(43);
const link = inviteLink(site, token);

const organiser = () =>
  buildInviteEmail({
    to: "invitee@example.com",
    kind: "organiser",
    organiserName: `Cellar <script>alert("x")</script> & Co`,
    link,
    daysValid: 14,
    siteUrl: site,
  });
const member = () => buildInviteEmail({ to: "invitee@example.com", kind: "member", link, daysValid: 14, siteUrl: site });

describe("buildInviteEmail", () => {
  it("links to the invite page with the token in the fragment only", () => {
    expect(link).toBe(`${site}/invite#token=${token}`);
    for (const email of [organiser(), member()]) {
      expect(email.to).toBe("invitee@example.com");
      expect(email.text).toContain(`Accept the invite: ${link}`);
      expect(email.html).toContain(`href="${link}"`);
      // The token appears nowhere but in that fragment (no query string, no tracking).
      expect(email.html.split(token)).toHaveLength(2);
      expect(email.text.split(token)).toHaveLength(2);
      expect(email.html).not.toContain("?token=");
    }
  });

  it("says why, how long it works, that ignoring it sets nothing up, and where help and the Privacy Policy are", () => {
    for (const email of [organiser(), member()]) {
      for (const part of [email.text, email.html]) {
        expect(part).toContain("14 days");
        expect(part).toMatch(/asked us to set this up/);
        expect(part).toMatch(/Ignore this email: nothing is set up unless you open the link and accept/);
        expect(part).toContain(SUPPORT_EMAIL);
      }
      expect(email.text).toContain(`How we handle your details: ${privacyLink(site)}`);
      expect(email.html).toContain(`href="${site}/privacy"`);
    }
  });

  it("names the organiser (escaped) for an organiser invite, and nothing of the kind for a member", () => {
    const o = organiser();
    expect(o.html).toContain("Cellar &#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62; &#38; Co");
    expect(o.html).not.toContain("<script>");
    expect(o.text).toContain(`Cellar <script>alert("x")</script> & Co`);
    expect(o.html).toContain("You&#39;re invited to Sheltüh as an organiser");

    const m = member();
    expect(m.html).toContain("You&#39;re invited to join Sheltüh");
    expect(m.text).not.toMatch(/organiser/i);
  });

  it("ignores an organiser name on a member invite", () => {
    const m = buildInviteEmail({
      to: "invitee@example.com",
      kind: "member",
      organiserName: "Should Not Show",
      link,
      daysValid: 14,
      siteUrl: site,
    });
    expect(m.html).not.toContain("Should Not Show");
    expect(m.subject).toBe("You're invited to Sheltüh");
  });
});
