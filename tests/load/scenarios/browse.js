// Scenario 1: browse. Visitors land on the home page, an event page, /events,
// search or the map, then look at a few more pages with think time in
// between: ramping to PEAK_VUS (default 200) concurrent visitors.
//
//   k6 run -e BASE_URL=https://<staging-preview> tests/load/scenarios/browse.js
//
// Read-only capable: with READ_ONLY=1 (or against production with
// ALLOW_PRODUCTION=1, which forces it) no view beacons are sent.
// See tests/load/README.md for every variable.
import { createClient } from "../lib/http.js";
import { browseVisit, discoverEvents, journeyOptions } from "../lib/journeys.js";
import { buildThresholds, cloudOptions, envNumber, loadScale, scaleStages, SUMMARY_TREND_STATS } from "../lib/profile.js";
import { resolveTarget } from "../lib/target.js";

// Checked before anything runs: a production host stops the run here (lib/target.js).
const target = resolveTarget(__ENV, { scenario: "browse", readOnlyCapable: true });
const scale = loadScale(__ENV);
const peak = envNumber(__ENV, "PEAK_VUS", 200);

const stages =
  __ENV.SMOKE === "1"
    ? [
        { duration: "20s", target: 2 },
        { duration: "20s", target: 0 },
      ]
    : scaleStages(
        [
          { duration: "2m", target: Math.round(peak / 4) },
          { duration: "3m", target: peak },
          { duration: "5m", target: peak },
          { duration: "2m", target: 0 },
        ],
        scale,
      );

export const options = {
  scenarios: {
    browse: { executor: "ramping-vus", exec: "browse", startVUs: 0, stages, gracefulRampDown: "30s" },
  },
  thresholds: buildThresholds("browse", __ENV),
  summaryTrendStats: SUMMARY_TREND_STATS,
  cloud: cloudOptions("Sheltuh: browse", __ENV),
};

export function setup() {
  const client = createClient(target, __ENV);
  const events = discoverEvents(client, envNumber(__ENV, "DISCOVER_PAGES", 4));
  if (events.length === 0) {
    throw new Error("The feed has no upcoming events: seed the staging database first (tests/load/README.md).");
  }
  console.log(`browse: ${target.baseUrl}, ${events.length} events, read-only ${target.readOnly}, cache bust ${__ENV.CACHE_BUST === "1"}`);
  return { events };
}

const client = createClient(target, __ENV);
const journey = journeyOptions(__ENV, target);

export function browse(data) {
  browseVisit(client, data.events, journey);
}
