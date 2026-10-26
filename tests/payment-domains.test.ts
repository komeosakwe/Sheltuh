import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  describeKey,
  main,
  parseArgs,
  parseHostname,
  redact,
  runPaymentDomains,
  type Action,
  type PaymentMethodDomain,
  type PaymentMethodDomainsClient,
} from "@/scripts/payment-domains";

// Shaped like Stripe keys, never real ones.
const TEST_KEY = "rk_test_" + "51FakeRestrictedKeyValue0000";
const LIVE_KEY = "rk_live_" + "51FakeRestrictedKeyValue1111";
const SECRET_KEY = "sk_test_" + "51FakeSecretKeyValue2222";

type Status = "active" | "inactive";
const method = (status: Status, error?: string) =>
  error ? { status, status_details: { error_message: error } } : { status };

function domain(name: string, overrides: Partial<PaymentMethodDomain> = {}): PaymentMethodDomain {
  return {
    id: `pmd_${name.replace(/\W/g, "_")}`,
    domain_name: name,
    enabled: true,
    livemode: false,
    apple_pay: method("active"),
    google_pay: method("active"),
    link: method("active"),
    ...overrides,
  };
}

/** A fake stripe.paymentMethodDomains holding domains in memory; `validated` is what validate() turns a domain into. */
function fakeStripe(initial: PaymentMethodDomain[] = [], validated: Partial<PaymentMethodDomain> = {}) {
  const domains = new Map(initial.map((d) => [d.id, d]));
  const client = {
    list: vi.fn(async ({ domain_name }: { domain_name: string; limit: number }) => ({
      data: [...domains.values()].filter((d) => d.domain_name === domain_name),
    })),
    create: vi.fn(async ({ domain_name, enabled }: { domain_name: string; enabled: boolean }) => {
      const created = domain(domain_name, { enabled });
      domains.set(created.id, created);
      return created;
    }),
    update: vi.fn(async (id: string, { enabled }: { enabled: boolean }) => {
      const updated = { ...domains.get(id)!, enabled };
      domains.set(id, updated);
      return updated;
    }),
    validate: vi.fn(async (id: string) => {
      const after = { ...domains.get(id)!, ...validated };
      domains.set(id, after);
      return after;
    }),
  } satisfies PaymentMethodDomainsClient;
  return { client, domains };
}

async function run(client: PaymentMethodDomainsClient, action: Action, hostnames: string[], key = TEST_KEY) {
  const lines: string[] = [];
  const code = await runPaymentDomains({ client, action, hostnames, key, print: (line) => lines.push(line) });
  return { code, output: lines.join("\n") };
}

describe("parseHostname", () => {
  it("accepts bare hostnames, lowercased and trimmed", () => {
    expect(parseHostname("app.sheltuh.com.au")).toEqual({ ok: true, hostname: "app.sheltuh.com.au" });
    expect(parseHostname("  Preview.Sheltuh.COM.au ")).toEqual({ ok: true, hostname: "preview.sheltuh.com.au" });
    expect(parseHostname("sheltuh.com.au")).toEqual({ ok: true, hostname: "sheltuh.com.au" });
    expect(parseHostname("my-branch-sheltuh.vercel.app")).toEqual({ ok: true, hostname: "my-branch-sheltuh.vercel.app" });
    expect(parseHostname("xn--sheltuh-m2a.com.au")).toEqual({ ok: true, hostname: "xn--sheltuh-m2a.com.au" });
  });

  it.each([
    ["https://app.sheltuh.com.au", /scheme/],
    ["http://app.sheltuh.com.au", /scheme/],
    ["app.sheltuh.com.au/checkout/pay", /path/],
    ["app.sheltuh.com.au?x=1", /path or query/],
    ["//app.sheltuh.com.au", /path/],
    ["user@app.sheltuh.com.au", /user info/],
    ["app.sheltuh.com.au:443", /port/],
    ["*.sheltuh.com.au", /wildcard/],
    ["127.0.0.1", /IP address/],
    ["203.0.113.7", /IP address/],
    ["[::1]", /IP address/],
    ["::1", /IP address/],
    ["2001:db8::1", /IP address/],
    ["localhost", /localhost/],
    ["app.localhost", /localhost/],
    ["app.sheltuh.com.au.", /dot/],
    ["sheltüh.com.au", /punycode/],
    ["app sheltuh.com.au", /punycode/],
    ["sheltuh", /full hostname/],
    ["-app.sheltuh.com.au", /valid hostname/],
    ["app..sheltuh.com.au", /valid hostname/],
    ["app_1.sheltuh.com.au", /valid hostname/],
    [`${"a".repeat(64)}.com.au`, /valid hostname/],
  ])("refuses %s", (input, why) => {
    const result = parseHostname(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(why);
  });

  it("refuses an empty hostname", () => {
    expect(parseHostname("   ").ok).toBe(false);
  });
});

describe("parseArgs", () => {
  it("defaults to --check, de-duplicates hostnames and takes --register", () => {
    expect(parseArgs(["app.sheltuh.com.au", "APP.sheltuh.com.au"])).toEqual({
      ok: true,
      action: "check",
      hostnames: ["app.sheltuh.com.au"],
    });
    expect(parseArgs(["--register", "app.sheltuh.com.au", "preview.sheltuh.com.au"])).toEqual({
      ok: true,
      action: "register",
      hostnames: ["app.sheltuh.com.au", "preview.sheltuh.com.au"],
    });
    expect(parseArgs(["--help"])).toEqual({ ok: true, action: "help" });
  });

  it("refuses no hostnames, both actions, unknown options and any bad hostname (registering none)", () => {
    expect(parseArgs([])).toEqual({ ok: false, errors: ["Give at least one hostname."] });
    expect(parseArgs(["--register"])).toEqual({ ok: false, errors: ["Give at least one hostname."] });
    expect(parseArgs(["--check", "--register", "app.sheltuh.com.au"])).toEqual({
      ok: false,
      errors: ["Give --check or --register, not both."],
    });
    expect(parseArgs(["--force", "app.sheltuh.com.au"])).toEqual({ ok: false, errors: ["Unknown option --force."] });
    const mixed = parseArgs(["--register", "app.sheltuh.com.au", "https://preview.sheltuh.com.au"]);
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.errors).toEqual([expect.stringMatching(/scheme/)]);
  });
});

describe("describeKey and redact", () => {
  it("reads the mode and kind from the prefix only", () => {
    expect(describeKey(TEST_KEY)).toEqual({ mode: "test", restricted: true });
    expect(describeKey(LIVE_KEY)).toEqual({ mode: "live", restricted: true });
    expect(describeKey(SECRET_KEY)).toEqual({ mode: "test", restricted: false });
    expect(describeKey("sk_live_x")).toEqual({ mode: "live", restricted: false });
    expect(describeKey("pk_test_x")).toBeUndefined(); // publishable keys can't manage domains
    expect(describeKey("whsec_x")).toBeUndefined();
    expect(describeKey("")).toBeUndefined();
  });

  it("removes the key and anything key-shaped, masked ones included", () => {
    expect(redact(`Invalid API Key provided: ${TEST_KEY}`, TEST_KEY)).toBe("Invalid API Key provided: [redacted]");
    expect(redact("Invalid API Key provided: rk_test_****0000", TEST_KEY)).toBe("Invalid API Key provided: [redacted]");
    expect(redact("Domain not verified", TEST_KEY)).toBe("Domain not verified");
  });
});

describe("--check", () => {
  it("reports each domain's mode, enabled flag and wallet statuses, exiting 0 when all are active, writing nothing", async () => {
    const { client } = fakeStripe([domain("app.sheltuh.com.au"), domain("preview.sheltuh.com.au")]);
    const { code, output } = await run(client, "check", ["app.sheltuh.com.au", "preview.sheltuh.com.au"]);
    expect(code).toBe(0);
    expect(client.list).toHaveBeenCalledWith({ domain_name: "app.sheltuh.com.au", limit: 10 });
    expect(client.list).toHaveBeenCalledWith({ domain_name: "preview.sheltuh.com.au", limit: 10 });
    expect(output).toContain("app.sheltuh.com.au (pmd_app_sheltuh_com_au, test mode)");
    expect(output).toContain("  enabled: yes");
    expect(output).toContain("  Apple Pay: active");
    expect(output).toContain("  Google Pay: active");
    expect(output).toContain("  Link: active");
    expect(output).toMatch(/All 2 domain\(s\) ready in test mode/);
    expect(client.create).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
    expect(client.validate).not.toHaveBeenCalled();
  });

  it("exits 1 for a missing domain, a disabled one, or any of the three wallets inactive (with Stripe's reason)", async () => {
    const { client } = fakeStripe([
      domain("off.sheltuh.com.au", { enabled: false }),
      domain("apple.sheltuh.com.au", { apple_pay: method("inactive", "Domain verification file not found") }),
      domain("link.sheltuh.com.au", { link: method("inactive") }),
    ]);
    for (const hostname of ["missing.sheltuh.com.au", "off.sheltuh.com.au", "apple.sheltuh.com.au", "link.sheltuh.com.au"]) {
      const { code, output } = await run(client, "check", [hostname]);
      expect(code, hostname).toBe(1);
      expect(output).toContain(`Not ready in test mode: ${hostname}.`);
      expect(output).toMatch(/--register/);
    }
    const missing = await run(client, "check", ["missing.sheltuh.com.au"]);
    expect(missing.output).toContain("missing.sheltuh.com.au: not registered in test mode");
    expect((await run(client, "check", ["off.sheltuh.com.au"])).output).toContain("  enabled: no");
    expect((await run(client, "check", ["apple.sheltuh.com.au"])).output).toContain(
      "  Apple Pay: inactive (Domain verification file not found)",
    );
    expect(client.create).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
    expect(client.validate).not.toHaveBeenCalled();
  });

  it("ignores other methods (PayPal, Klarna) and only exact domain matches", async () => {
    const { client } = fakeStripe([domain("app.sheltuh.com.au")]);
    client.list.mockResolvedValueOnce({ data: [domain("other.sheltuh.com.au")] });
    const { code, output } = await run(client, "check", ["app.sheltuh.com.au"]);
    expect(code).toBe(1);
    expect(output).toContain("app.sheltuh.com.au: not registered");
  });

  it("labels live mode, and warns if Stripe's livemode disagrees with the key", async () => {
    const live = fakeStripe([domain("app.sheltuh.com.au", { livemode: true })]);
    const ok = await run(live.client, "check", ["app.sheltuh.com.au"], LIVE_KEY);
    expect(ok.code).toBe(0);
    expect(ok.output).toContain("(pmd_app_sheltuh_com_au, live mode)");
    expect(ok.output).toMatch(/ready in live mode/);
    expect(ok.output).not.toMatch(/warning/);

    const odd = await run(live.client, "check", ["app.sheltuh.com.au"], TEST_KEY);
    expect(odd.output).toContain("warning: the key is a test key but Stripe says this domain is live");
  });
});

describe("--register", () => {
  it("creates a missing domain enabled, and a re-run creates nothing", async () => {
    const { client, domains } = fakeStripe();
    const first = await run(client, "register", ["app.sheltuh.com.au"]);
    expect(first.code).toBe(0);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.create).toHaveBeenCalledWith({ domain_name: "app.sheltuh.com.au", enabled: true });
    expect(first.output).toContain("app.sheltuh.com.au: registered");
    expect(domains.size).toBe(1);

    const again = await run(client, "register", ["app.sheltuh.com.au"]);
    expect(again.code).toBe(0);
    expect(again.output).not.toContain("registered");
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.update).not.toHaveBeenCalled();
    expect(client.validate).not.toHaveBeenCalled();
  });

  it("re-enables a disabled domain with update, never creating a second", async () => {
    const { client } = fakeStripe([domain("app.sheltuh.com.au", { enabled: false })]);
    const { code, output } = await run(client, "register", ["app.sheltuh.com.au"]);
    expect(code).toBe(0);
    expect(client.update).toHaveBeenCalledExactlyOnceWith("pmd_app_sheltuh_com_au", { enabled: true });
    expect(client.create).not.toHaveBeenCalled();
    expect(output).toContain("app.sheltuh.com.au: re-enabled");
    expect(output).toContain("  enabled: yes");
  });

  it("validates once when a wallet is inactive, reporting the result", async () => {
    const { client } = fakeStripe([domain("app.sheltuh.com.au", { google_pay: method("inactive"), link: method("inactive") })], {
      google_pay: method("active"),
      link: method("active"),
    });
    const { code, output } = await run(client, "register", ["app.sheltuh.com.au"]);
    expect(code).toBe(0); // validate() turned them active
    expect(client.validate).toHaveBeenCalledExactlyOnceWith("pmd_app_sheltuh_com_au");
    expect(output).toContain("app.sheltuh.com.au: validating (Google Pay, Link not active)");
    expect(output).toContain("  Google Pay: active");
  });

  it("exits 1 when a wallet is still inactive after validating", async () => {
    const stillInactive = { apple_pay: method("inactive", "Apple Pay domain association file not found") };
    const { client } = fakeStripe([domain("app.sheltuh.com.au", stillInactive)], stillInactive);
    const { code, output } = await run(client, "register", ["app.sheltuh.com.au"]);
    expect(code).toBe(1);
    expect(client.validate).toHaveBeenCalledTimes(1);
    expect(output).toContain("  Apple Pay: inactive (Apple Pay domain association file not found)");
    expect(output).toContain("Not ready in test mode: app.sheltuh.com.au.");
  });

  it("carries on past a Stripe error, redacting the key, and exits 1", async () => {
    const { client } = fakeStripe();
    client.create.mockRejectedValueOnce(new Error(`Invalid API Key provided: ${TEST_KEY.slice(0, 8)}****0000 (${TEST_KEY})`));
    const { code, output } = await run(client, "register", ["app.sheltuh.com.au", "preview.sheltuh.com.au"]);
    expect(code).toBe(1);
    expect(output).toContain("app.sheltuh.com.au: Stripe refused the request: Invalid API Key provided: [redacted]");
    expect(output).toContain("preview.sheltuh.com.au: registered");
    expect(output).toContain("Not ready in test mode: app.sheltuh.com.au.");
    expect(output).not.toContain(TEST_KEY);
    expect(output).not.toMatch(/rk_test_/);
  });
});

describe("main (the command)", () => {
  function start(argv: string[], env: Record<string, string | undefined>, client = fakeStripe([domain("app.sheltuh.com.au")]).client) {
    const out: string[] = [];
    const err: string[] = [];
    const makeClient = vi.fn(() => client);
    const done = main({ argv, env, makeClient, print: (l) => out.push(l), printError: (l) => err.push(l) });
    return { done, makeClient, all: () => [...out, ...err].join("\n"), out, err };
  }

  it("prefers STRIPE_DOMAINS_KEY over STRIPE_SECRET_KEY, naming the variable and the key's kind, never its value", async () => {
    const run = start(["app.sheltuh.com.au"], { STRIPE_DOMAINS_KEY: TEST_KEY, STRIPE_SECRET_KEY: SECRET_KEY });
    expect(await run.done).toBe(0);
    expect(run.makeClient).toHaveBeenCalledExactlyOnceWith(TEST_KEY);
    expect(run.out[0]).toBe("Using STRIPE_DOMAINS_KEY: a restricted test-mode key.");
    expect(run.all()).not.toContain(TEST_KEY);
    expect(run.all()).not.toContain(SECRET_KEY);
    expect(run.all()).not.toMatch(/(?:rk|sk)_test_/);
  });

  it("falls back to STRIPE_SECRET_KEY, recommending a restricted key", async () => {
    const run = start(["app.sheltuh.com.au"], { STRIPE_SECRET_KEY: SECRET_KEY });
    expect(await run.done).toBe(0);
    expect(run.makeClient).toHaveBeenCalledExactlyOnceWith(SECRET_KEY);
    expect(run.out[0]).toBe("Using STRIPE_SECRET_KEY: a secret test-mode key.");
    expect(run.out[1]).toMatch(/restricted key \(rk_…\)/);
    expect(run.all()).not.toContain(SECRET_KEY);
  });

  it("refuses a missing or non-secret key, and bad arguments, before making a client", async () => {
    const missing = start(["app.sheltuh.com.au"], {});
    expect(await missing.done).toBe(1);
    expect(missing.err[0]).toMatch(/Missing STRIPE_DOMAINS_KEY \(or STRIPE_SECRET_KEY\)/);

    const publishable = start(["app.sheltuh.com.au"], { STRIPE_DOMAINS_KEY: "pk_test_" + "51FakePublishable" });
    expect(await publishable.done).toBe(1);
    expect(publishable.err[0]).toBe("STRIPE_DOMAINS_KEY isn't a Stripe secret (sk_…) or restricted (rk_…) key.");
    expect(publishable.all()).not.toContain("pk_test_" + "51FakePublishable");

    const badHost = start(["https://app.sheltuh.com.au"], { STRIPE_DOMAINS_KEY: TEST_KEY });
    expect(await badHost.done).toBe(1);
    expect(badHost.err[0]).toMatch(/scheme/);
    expect(badHost.err.at(-1)).toMatch(/^Usage:/);

    for (const run of [missing, publishable, badHost]) expect(run.makeClient).not.toHaveBeenCalled();
  });

  it("prints usage for --help and exits 0", async () => {
    const run = start(["--help"], {});
    expect(await run.done).toBe(0);
    expect(run.out[0]).toMatch(/^Usage:/);
    expect(run.makeClient).not.toHaveBeenCalled();
  });

  it("never prints a key passed as an argument (positional, as an option or masked): says so and advises rotating", async () => {
    const pasted = [
      "sk_live_" + "51FakeLiveSecretKeyValue9999999999",
      "rk_live_" + "51FakeRestrictedKeyValue8888888888",
      "--key=sk_test_" + "51FakeSecretKeyValue7777777777",
      "whsec_" + "FakeWebhookSigningSecret0123456789abcdef",
      "sk_live_****************9999",
    ];
    for (const key of pasted) {
      for (const argv of [[key], ["app.sheltuh.com.au", key], ["--register", key, "app.sheltuh.com.au"], ["--help", key]]) {
        const run = start(argv, { STRIPE_DOMAINS_KEY: TEST_KEY });
        expect(await run.done, key).toBe(1);
        expect(run.makeClient).not.toHaveBeenCalled();
        expect(run.err[0]).toMatch(/looks like a secret key.*isn't shown.*rotate it/);
        expect(run.all()).not.toContain(key);
        expect(run.all()).not.toMatch(/(?:sk|rk)_(?:test|live)_|whsec_/);
      }
    }
  });

  it("never prints a pasted private key (whole, or one word at a time) given as arguments", async () => {
    const pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const body = pem.trim().split("\n").slice(1, -1);
    for (const argv of [[pem], pem.split(/\s+/).filter(Boolean), [body.join("")]]) {
      const run = start(argv, { STRIPE_DOMAINS_KEY: TEST_KEY });
      expect(await run.done).toBe(1);
      expect(run.makeClient).not.toHaveBeenCalled();
      expect(run.all()).toMatch(/rotate it/);
      expect(run.all()).not.toContain("PRIVATE KEY");
      for (const line of body) expect(run.all()).not.toContain(line);
    }
  });

  it("doesn't echo a long unrecognised argument, describing it by length", () => {
    const longHost = `${"x".repeat(70)}.sheltuh.com.au/checkout`;
    const longOption = `--${"y".repeat(80)}`;
    const parsed = parseArgs([longHost, longOption]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual([
      `An argument of ${longHost.length} characters (not shown) has a path or query: give the hostname only (e.g. app.sheltuh.com.au).`,
      `Unknown option: an argument of ${longOption.length} characters (not shown).`,
    ]);
    expect(parsed.errors.join("\n")).not.toContain("xxxxxxxxxx");
    expect(parsed.errors.join("\n")).not.toContain("yyyyyyyyyy");
    // Short ones are still quoted, as before.
    expect(parseHostname("https://app.sheltuh.com.au")).toMatchObject({ reason: expect.stringMatching(/^"https:\/\/app\.sheltuh\.com\.au" has a scheme/) });
  });

  it("redacts and exits 1 if making the client throws", async () => {
    const out: string[] = [];
    const code = await main({
      argv: ["app.sheltuh.com.au"],
      env: { STRIPE_DOMAINS_KEY: TEST_KEY },
      makeClient: () => {
        throw new Error(`bad key ${TEST_KEY}`);
      },
      print: (l) => out.push(l),
      printError: (l) => out.push(l),
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("bad key [redacted]");
    expect(out.join("\n")).not.toContain(TEST_KEY);
  });
});
