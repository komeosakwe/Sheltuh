// Scenario 4: soak. The browse journeys at a moderate, steady load
// (SOAK_VUS, default 50) for SOAK_DURATION (default 30m), to find what only
// shows over time: database connections piling up at Supabase's pooler,
// function memory, slow drift in latency, rate-limit or analytics rows growing.
//
//   k6 run -e BASE_URL=https://<staging-preview> tests/load/scenarios/soak.js
//
// Read-only capable, as browse. See tests/load/README.md.
import { createClient } from "../lib/http.js";
import { browseVisit, discoverEvents, journeyOptions } from "../lib/journeys.js";
import { buildThresholds, cloudOptions, envNumber, loadScale, scaled, SUMMARY_TREND_STATS } from "../lib/profile.js";
import { resolveTarget } from "../lib/target.js";

const target = resolveTarget(__ENV, { scenario: "soak", readOnlyCapable: true });
const vus = scaled(envNumber(__ENV, "SOAK_VUS", 50), loadScale(__ENV));
const hold = __ENV.SMOKE === "1" ? "30s" : __ENV.SOAK_DURATION || "30m";

export const options = {
  scenarios: {
    soak: {
      executor: "ramping-vus",
      exec: "soak",
      startVUs: 0,
      stages: [
        { duration: __ENV.SMOKE === "1" ? "10s" : "2m", target: __ENV.SMOKE === "1" ? 2 : vus },
        { duration: hold, target: __ENV.SMOKE === "1" ? 2 : vus },
        { duration: __ENV.SMOKE === "1" ? "10s" : "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: buildThresholds("soak", __ENV),
  summaryTrendStats: SUMMARY_TREND_STATS,
  cloud: cloudOptions("Sheltuh: soak", __ENV),
};

export function setup() {
  const client = createClient(target, __ENV);
  const events = discoverEvents(client, envNumber(__ENV, "DISCOVER_PAGES", 4));
  if (events.length === 0) {
    throw new Error("The feed has no upcoming events: seed the staging database first (tests/load/README.md).");
  }
  console.log(`soak: ${target.baseUrl}, ${vus} VUs for ${hold}, ${events.length} events, read-only ${target.readOnly}`);
  return { events };
}

const client = createClient(target, __ENV);
const journey = journeyOptions(__ENV, target);

export function soak(data) {
  browseVisit(client, data.events, journey);
}
