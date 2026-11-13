import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildThresholds, LATENCY_TARGETS, SCENARIO_GROUPS, scaleStages } from "./lib/profile.js";
import { assertRequestAllowed, isProductionHost, parseBaseUrl, resolveTarget } from "./lib/target.js";

// The k6 load tests (tests/load/README.md) can't run here (k6 is a separate
// binary): this checks what can be checked without it. The rules that keep a
// run off production and away from Stripe's webhook and the cron routes, the
// thresholds, that every script parses, and that every request goes through
// the guarded client.

const LOAD_DIR = import.meta.dirname;
const scenarioFiles = readdirSync(path.join(LOAD_DIR, "scenarios")).filter((f) => f.endsWith(".js"));
const libFiles = readdirSync(path.join(LOAD_DIR, "lib")).filter((f) => f.endsWith(".js"));
const read = (dir: string, f: string) => readFileSync(path.join(LOAD_DIR, dir, f), "utf8");

describe("target guard", () => {
  const browse = { scenario: "browse", readOnlyCapable: true };
  const onsale = { scenario: "onsale", readOnlyCapable: false };

  it("defaults to a local server, never production", () => {
    expect(resolveTarget({}, onsale)).toMatchObject({ baseUrl: "http://localhost:3000", production: false, readOnly: false });
  });

  it("refuses production hosts and their subdomains, whatever the case", () => {
    for (const url of [
      "https://sheltuh.com.au",
      "https://www.sheltuh.com.au/",
      "https://preview.sheltuh.com.au",
      "https://SHELTUH.COM.AU.",
      "https://findyoursheltuh.com.au",
      "https://www.findyoursheltuh.com.au:443",
    ]) {
      expect(() => resolveTarget({ BASE_URL: url }, browse), url).toThrow(/production/);
      expect(() => resolveTarget({ BASE_URL: url }, onsale), url).toThrow(/production/);
    }
  });

  it("allows production only read-only, and only when asked", () => {
    expect(resolveTarget({ BASE_URL: "https://sheltuh.com.au", ALLOW_PRODUCTION: "1" }, browse)).toMatchObject({
      production: true,
      readOnly: true,
    });
    expect(() => resolveTarget({ BASE_URL: "https://sheltuh.com.au", ALLOW_PRODUCTION: "1" }, onsale)).toThrow(/writes data/);
    expect(() => resolveTarget({ BASE_URL: "https://sheltuh.com.au", ALLOW_PRODUCTION: "true" }, browse)).toThrow(/production/);
  });

  it("treats PRODUCTION_HOSTS as production too, and nothing that merely looks alike", () => {
    expect(isProductionHost("sheltuh-prod.vercel.app", "sheltuh-prod.vercel.app, other.example")).toBe(true);
    expect(isProductionHost("x.other.example", "sheltuh-prod.vercel.app,other.example")).toBe(true);
    expect(isProductionHost("notsheltuh.com.au")).toBe(false);
    expect(isProductionHost("sheltuh-git-loadtest-kome.vercel.app")).toBe(false);
  });

  it("refuses URLs that could hide the host, and plain http to a remote host", () => {
    expect(() => parseBaseUrl("https://staging@sheltuh.com.au")).toThrow(/origin/);
    expect(() => parseBaseUrl("https://staging.vercel.app/events")).toThrow(/origin/);
    expect(() => parseBaseUrl("ftp://staging.vercel.app")).toThrow(/origin/);
    expect(() => resolveTarget({ BASE_URL: "http://staging.vercel.app" }, browse)).toThrow(/https/);
    expect(resolveTarget({ BASE_URL: "http://127.0.0.1:3177" }, onsale).baseUrl).toBe("http://127.0.0.1:3177");
  });

  it("never lets a request reach Stripe's webhook or the cron routes, and keeps read-only runs to GET", () => {
    for (const p of ["/api/stripe/webhook", "/API/Stripe/Webhook?x=1", "/api/cron/email-outbox", "/api/cron/payouts", "/api/cron"]) {
      expect(() => assertRequestAllowed("GET", p, { readOnly: false }), p).toThrow(/never request/);
      expect(() => assertRequestAllowed("POST", p, { readOnly: false }), p).toThrow(/never request/);
    }
    expect(() => assertRequestAllowed("POST", "/api/events/x/view", { readOnly: true })).toThrow(/Read-only/);
    expect(() => assertRequestAllowed("GET", "/api/events?upcoming=1", { readOnly: true })).not.toThrow();
    expect(() => assertRequestAllowed("GET", "/api/cronjobs-are-not-a-route", { readOnly: false })).not.toThrow();
  });
});

describe("thresholds", () => {
  it("has latency targets for every route group a scenario uses", () => {
    for (const [scenario, groups] of Object.entries(SCENARIO_GROUPS)) {
      for (const group of groups) expect(LATENCY_TARGETS, `${scenario}: ${group}`).toHaveProperty(group);
      const thresholds = buildThresholds(scenario, {});
      expect(thresholds.http_req_failed[0]).toStrictEqual({ threshold: "rate<0.01" });
      expect(thresholds.checks).toStrictEqual(["rate>0.99"]);
      for (const group of groups) expect(thresholds).toHaveProperty([`http_req_duration{rg:${group},expected_response:true}`]);
    }
  });

  it("scales latency targets with LATENCY_SLACK and stage targets with LOAD_SCALE", () => {
    expect(buildThresholds("checkin", { LATENCY_SLACK: "1.5" })["http_req_duration{rg:checkin,expected_response:true}"]).toStrictEqual([
      "p(95)<1200",
      "p(99)<3000",
    ]);
    expect(
      scaleStages(
        [
          { duration: "1m", target: 200 },
          { duration: "1m", target: 0 },
        ],
        0.1,
      ),
    ).toStrictEqual([
      { duration: "1m", target: 20 },
      { duration: "1m", target: 0 },
    ]);
  });
});

describe("k6 scripts", () => {
  const all = [...scenarioFiles.map((f) => ["scenarios", f]), ...libFiles.map((f) => ["lib", f])] as const;

  it.each(all)("%s/%s parses as an ES module", (dir, f) => {
    const out = ts.transpileModule(read(dir, f), {
      fileName: f,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, allowJs: true },
    });
    expect(out.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")) ?? []).toStrictEqual([]);
  });

  it.each(scenarioFiles)("scenarios/%s checks its target before anything else and exports options", (f) => {
    const src = read("scenarios", f);
    const guard = src.indexOf("resolveTarget(__ENV");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(src.indexOf("export const options"));
  });

  it("sends every app request through the guarded client (lib/http.js); only sign-in talks to Supabase directly", () => {
    for (const [dir, f] of all) {
      if (dir === "lib" && (f === "http.js" || f === "auth.js")) continue;
      expect(read(dir, f), `${dir}/${f}`).not.toMatch(/\bhttp\.(get|post|put|patch|del|request|batch|asyncRequest)\(/);
      expect(read(dir, f), `${dir}/${f}`).not.toMatch(/from "k6\/http"/);
    }
    expect(read("lib", "auth.js")).toMatch(/auth\/v1\/token\?grant_type=password/);
  });

  it("never names the webhook or cron paths outside the guard", () => {
    for (const [dir, f] of all) {
      if (dir === "lib" && f === "target.js") continue;
      expect(read(dir, f), `${dir}/${f}`).not.toMatch(/\/api\/(stripe\/webhook|cron\/)/);
    }
  });
});
