import { describe, expect, it } from "vitest";
import {
  EMAIL_TYPO_DOMAINS,
  emailDomainOf,
  isKnownMailDomain,
  KNOWN_MAIL_DOMAINS,
  suggestEmail,
  typoCorrection,
} from "@/lib/email-typos";
import { isPlainEmailAddress } from "@/lib/server/email-address";

describe("lib/email-typos", () => {
  it("corrects a listed typo domain, keeping the part before the @ exactly as typed", () => {
    expect(suggestEmail("Mia.Chen+gigs@gmial.com")).toBe("Mia.Chen+gigs@gmail.com");
    expect(suggestEmail("fan@GMAIL.CON")).toBe("fan@gmail.com");
    expect(suggestEmail("fan@hotmial.com")).toBe("fan@hotmail.com");
    expect(suggestEmail("fan@gmail.com.au")).toBe("fan@gmail.com");
    expect(suggestEmail("fan@bigpond.con")).toBe("fan@bigpond.com");
    expect(suggestEmail("fan@optusnet.con.au")).toBe("fan@optusnet.com.au");
    expect(typoCorrection("Yahoo.Con")).toBe("yahoo.com");
  });

  it("hints (without listing) a domain one edit from a popular provider", () => {
    expect(typoCorrection("gmaik.com")).toBeUndefined();
    expect(suggestEmail("fan@gmaik.com")).toBe("fan@gmail.com");
    expect(suggestEmail("fan@outlokk.com")).toBe("fan@outlook.com");
    // A swap of neighbours.
    expect(suggestEmail("fan@yhaoo.com")).toBe("fan@yahoo.com");
    expect(suggestEmail("fan@bigpond.net.a")).toBe("fan@bigpond.net.au");
  });

  it("suggests nothing for right domains, short ones and unrelated ones", () => {
    for (const email of [
      "fan@gmail.com",
      "fan@bigpond.com",
      "fan@bigpond.net.au",
      "fan@example.com",
      "fan@b.co",
      "fan@mail.com",
      "fan@email.com",
      "fan@ymail.com",
      "fan@me.com",
      "fan@sheltuh.com.au",
      "fan@unimelb.edu.au",
    ]) {
      expect(suggestEmail(email), email).toBeNull();
    }
    expect(suggestEmail("no-at-sign")).toBeNull();
    expect(suggestEmail("@gmial.com")).toBeNull();
    expect(suggestEmail("fan@")).toBeNull();
  });

  it("the typo list and the known-good list don't overlap, and every entry is lower-case and well formed", () => {
    for (const [typo, meant] of Object.entries(EMAIL_TYPO_DOMAINS)) {
      expect(KNOWN_MAIL_DOMAINS.has(typo), typo).toBe(false);
      expect(typo).toBe(typo.toLowerCase());
      expect(isPlainEmailAddress(`fan@${typo}`), typo).toBe(true);
      // What it corrects to is never itself a typo.
      expect(EMAIL_TYPO_DOMAINS[meant], meant).toBeUndefined();
      expect(isPlainEmailAddress(`fan@${meant}`), meant).toBe(true);
    }
    for (const domain of KNOWN_MAIL_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
      expect(suggestEmail(`fan@${domain}`), domain).toBeNull();
    }
  });

  it("emailDomainOf and isKnownMailDomain ignore case", () => {
    expect(emailDomainOf("A@B@Example.COM")).toBe("example.com");
    expect(emailDomainOf("nobody")).toBeNull();
    expect(isKnownMailDomain("GMail.com")).toBe(true);
    expect(isKnownMailDomain("example.com")).toBe(false);
  });
});
