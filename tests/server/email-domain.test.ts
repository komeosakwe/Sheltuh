import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkEmailDomain,
  isSpecialUseDomain,
  EMAIL_DOMAIN_LOOKUP_LIMIT,
  EMAIL_NO_MAIL_MESSAGE,
  refuseUndeliverableEmail,
} from "@/lib/server/email-domain";
import { HttpError } from "@/lib/server/http";
import { createMailDomainLookup, MAIL_DOMAIN_LOOKUP, type MailResolver } from "@/lib/server/mail-domain";
import { SITE_URL, TestApi } from "./helpers/api";
import { createTestDb } from "./helpers/test-db";

/** An error as node:dns/promises rejects with. */
function dnsError(code: string): Error {
  return Object.assign(new Error(`query failed: ${code}`), { code });
}

type Answer<T> = T | Error | "hang";

/** A stub resolver: each query answers what it's given (an Error rejects, "hang" never settles). */
function stubResolver(answers: { mx?: Answer<{ exchange: string; priority: number }[]>; a?: Answer<string[]>; aaaa?: Answer<string[]> }) {
  const calls: string[] = [];
  let cancelled = false;
  const answer = <T>(query: string, value: Answer<T> | undefined, fallback: Answer<T>): Promise<T> => {
    calls.push(query);
    const v = value ?? fallback;
    if (v === "hang") return new Promise<T>(() => {});
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  };
  const resolver: MailResolver = {
    resolveMx: (d) => answer(`mx:${d}`, answers.mx, dnsError("ENODATA")),
    resolve4: (d) => answer(`a:${d}`, answers.a, dnsError("ENODATA")),
    resolve6: (d) => answer(`aaaa:${d}`, answers.aaaa, dnsError("ENODATA")),
    cancel: () => {
      cancelled = true;
    },
  };
  return { resolver, calls, wasCancelled: () => cancelled };
}

describe("createMailDomainLookup (Deps.mailDomain)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a domain with a mail server, and never asks for addresses then", async () => {
    const stub = stubResolver({ mx: [{ exchange: "mx.example.net", priority: 10 }] });
    expect(await createMailDomainLookup(() => stub.resolver)("Example.NET")).toBe("accepts");
    expect(stub.calls).toEqual(["mx:example.net"]);
  });

  it("no_mail for NXDOMAIN, a null MX, and no MX with no address", async () => {
    expect(await createMailDomainLookup(() => stubResolver({ mx: dnsError("ENOTFOUND") }).resolver)("nope.test")).toBe("no_mail");
    expect(await createMailDomainLookup(() => stubResolver({ mx: [{ exchange: "", priority: 0 }] }).resolver)("null.test")).toBe("no_mail");
    expect(
      await createMailDomainLookup(() => stubResolver({ a: dnsError("ENODATA"), aaaa: dnsError("ENOTFOUND") }).resolver)("bare.test"),
    ).toBe("no_mail");
  });

  it("no MX but an A or AAAA record: mail goes to the address, so it accepts", async () => {
    expect(await createMailDomainLookup(() => stubResolver({ a: ["192.0.2.1"] }).resolver)("a-only.test")).toBe("accepts");
    expect(await createMailDomainLookup(() => stubResolver({ aaaa: ["2001:db8::1"] }).resolver)("aaaa-only.test")).toBe("accepts");
  });

  it("unknown (accepted) for a DNS failure, and for a lookup that runs out of time, whose queries are cancelled", async () => {
    expect(await createMailDomainLookup(() => stubResolver({ mx: dnsError("ESERVFAIL") }).resolver)("broken.test")).toBe("unknown");
    expect(
      await createMailDomainLookup(() => stubResolver({ a: dnsError("ETIMEOUT"), aaaa: dnsError("ENODATA") }).resolver)("half.test"),
    ).toBe("unknown");

    vi.useFakeTimers();
    const stub = stubResolver({ mx: "hang" });
    const pending = createMailDomainLookup(() => stub.resolver)("slow.test");
    await vi.advanceTimersByTimeAsync(MAIL_DOMAIN_LOOKUP.totalTimeoutMs);
    expect(await pending).toBe("unknown");
    expect(stub.wasCancelled()).toBe(true);
  });

  it("reuses a definite answer per domain until it expires, but never an unknown one", async () => {
    let now = 1_000_000;
    let made = 0;
    let mx: Answer<{ exchange: string; priority: number }[]> = dnsError("ENOTFOUND");
    const lookup = createMailDomainLookup(
      () => {
        made += 1;
        return stubResolver({ mx }).resolver;
      },
      () => now,
    );
    expect(await lookup("gone.test")).toBe("no_mail");
    expect(await lookup("GONE.test")).toBe("no_mail");
    expect(made).toBe(1);
    now += MAIL_DOMAIN_LOOKUP.cacheTtlMs + 1;
    mx = [{ exchange: "mx.gone.test", priority: 1 }];
    expect(await lookup("gone.test")).toBe("accepts");
    expect(made).toBe(2);

    mx = dnsError("ESERVFAIL");
    expect(await lookup("flaky.test")).toBe("unknown");
    expect(await lookup("flaky.test")).toBe("unknown");
    expect(made).toBe(4);
  });
});

describe("checkEmailDomain / refuseUndeliverableEmail", () => {
  let api: TestApi;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    const testDb = await createTestDb();
    reset = testDb.reset;
    api = new TestApi(testDb.db);
  });

  beforeEach(async () => {
    await reset();
    api = new TestApi(api.db);
  });

  const request = (ip?: string) => new Request(`${SITE_URL}/api/test`, { headers: ip ? { "x-forwarded-for": ip } : {} });

  it("refuses a listed typo with the correction, without asking DNS, whatever DNS would say", async () => {
    api.mailDomainAnswers.set("gmial.com", "accepts");
    expect(await checkEmailDomain(request(), api.deps, "Mia@gmial.com")).toEqual({ code: "email_typo", suggestion: "Mia@gmail.com" });
    expect(api.mailDomainLookups).toEqual([]);
  });

  it("accepts a known provider without a lookup, and looks up anything else", async () => {
    expect(await checkEmailDomain(request(), api.deps, "fan@bigpond.com")).toBeNull();
    expect(api.mailDomainLookups).toEqual([]);
    expect(await checkEmailDomain(request(), api.deps, "fan@Example.com")).toBeNull();
    expect(api.mailDomainLookups).toEqual(["example.com"]);
  });

  it("refuses a domain that can't receive email (with a suggestion when one is near), and accepts an unknown answer", async () => {
    api.mailDomainAnswers.set("gmaik.com", "no_mail");
    api.mailDomainAnswers.set("nomail.example.net", "no_mail");
    api.mailDomainAnswers.set("slow.example.net", "unknown");
    expect(await checkEmailDomain(request(), api.deps, "fan@gmaik.com")).toEqual({ code: "email_no_mail", suggestion: "fan@gmail.com" });
    expect(await checkEmailDomain(request(), api.deps, "fan@nomail.example.net")).toEqual({ code: "email_no_mail" });
    expect(await checkEmailDomain(request(), api.deps, "fan@slow.example.net")).toBeNull();

    const refused = await refuseUndeliverableEmail(request(), api.deps, "fan@nomail.example.net", "email").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).statusCode).toBe(400);
    expect((refused as HttpError).fieldErrors).toEqual({ email: EMAIL_NO_MAIL_MESSAGE });
    expect((refused as HttpError).details).toEqual({ code: "email_no_mail" });
    // The message never repeats the address.
    expect((refused as HttpError).message).not.toContain("nomail");
  });

  it("refuses special-use names as email_no_mail before any lookup or allowance; real domains that merely look alike are looked up", async () => {
    for (const domain of [
      "shop.internal",
      "printer.local",
      "localhost",
      "app.localhost",
      "journey.test",
      "x.invalid",
      "mail.example",
      "router.home.arpa",
      "hidden1234.onion",
      "MAIL.TEST",
    ]) {
      expect(await checkEmailDomain(request("203.0.113.30"), api.deps, `fan@${domain}`), domain).toEqual({ code: "email_no_mail" });
      expect(isSpecialUseDomain(domain.toLowerCase()), domain).toBe(true);
    }
    expect(api.mailDomainLookups).toEqual([]);
    expect(await api.db.query(`select 1 from private.client_rate_limits where bucket = $1`, [EMAIL_DOMAIN_LOOKUP_LIMIT.bucket])).toEqual([]);
    // Only the label matters, not a look-alike: example.com, a .test-ish name and an .arpa that isn't home.arpa are real names.
    for (const domain of ["example.com", "test.com", "mytest.com.au", "local.org", "examples.net", "in-addr.arpa"]) {
      expect(isSpecialUseDomain(domain), domain).toBe(false);
    }
    // Support's change is refused the same way.
    expect(await checkEmailDomain(request(), api.deps, "fan@inbox.test", { typoList: false })).toEqual({ code: "email_no_mail" });
  });

  it("admins skip the typo list but not DNS", async () => {
    api.mailDomainAnswers.set("gmial.com", "no_mail");
    expect(await checkEmailDomain(request(), api.deps, "fan@gmial.com", { typoList: false })).toEqual({
      code: "email_no_mail",
      suggestion: "fan@gmail.com",
    });
    expect(api.mailDomainLookups).toEqual(["gmial.com"]);
  });

  it("EMAIL_DOMAIN_CHECKS=off: the format is the only check", async () => {
    api.emailDomainChecks = false;
    api.mailDomainAnswers.set("nomail.example.net", "no_mail");
    expect(await checkEmailDomain(request(), api.deps, "fan@gmial.com")).toBeNull();
    // The journey harness's buyers (journey/harness: @journey.test, with the switch off) still check out.
    expect(await checkEmailDomain(request(), api.deps, "buyer-1@journey.test")).toBeNull();
    expect(await checkEmailDomain(request(), api.deps, "fan@nomail.example.net")).toBeNull();
    expect(api.mailDomainLookups).toEqual([]);
  });

  it("over the client's lookup allowance the lookup is skipped and the address accepted (fail open); other clients still look up", async () => {
    api.mailDomainAnswers.set("nomail.example.net", "no_mail");
    for (let i = 0; i < EMAIL_DOMAIN_LOOKUP_LIMIT.hits; i += 1) {
      expect(await checkEmailDomain(request("203.0.113.9"), api.deps, `fan${i}@nomail.example.net`)).toEqual({ code: "email_no_mail" });
    }
    expect(await checkEmailDomain(request("203.0.113.9"), api.deps, "late@nomail.example.net")).toBeNull();
    expect(api.mailDomainLookups).toHaveLength(EMAIL_DOMAIN_LOOKUP_LIMIT.hits);
    expect(await checkEmailDomain(request("198.51.100.4"), api.deps, "other@nomail.example.net")).toEqual({ code: "email_no_mail" });
    // Known providers and typos never use the allowance.
    expect(await checkEmailDomain(request("203.0.113.9"), api.deps, "fan@gmial.com")).toEqual({ code: "email_typo", suggestion: "fan@gmail.com" });
    const [row] = await api.db.query<{ hits: number }>(
      `select hits from private.client_rate_limits where bucket = $1 order by hits desc limit 1`,
      [EMAIL_DOMAIN_LOOKUP_LIMIT.bucket],
    );
    expect(row.hits).toBe(EMAIL_DOMAIN_LOOKUP_LIMIT.hits + 1);
  });
});
