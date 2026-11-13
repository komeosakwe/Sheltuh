// Scenario 3: door check-in burst. The organiser's scanners at the door of the
// seeded door event: the doors open (a ramp to DOOR_PEAK_RATE scans a second,
// default 5), a rush, then a steady stream. Each scan is
// POST /api/organisers/me/events/{id}/check-ins {code, requestId} with the
// organiser's token, as components/check-in does; about half are followed by
// the scanner's counters refresh (GET …/check-ins), and every scanner also
// polls them every 15 s (lib/check-in/timing.ts).
//
// Scan mix: mostly fresh seeded codes (admitted), some re-scans of codes
// already in (already_checked_in), some unknown codes (invalid), some retries
// of the same request id (must replay the original answer), QR (SH1:) and
// typed forms both.
//
// The check-in allowance is 600 scans per account per 5 minutes (about 2 a
// second; docs/architecture.md "Accepted limits (check-in)"), shared by every
// scanner on the organiser's login. The default profile goes past it on
// purpose, as a real opening rush would: expect 429s for the last part of the
// rush (counted in rate_limited_429, not failures). DOOR_RESPECT_LIMIT=1 keeps
// to 110 a minute instead.
//
//   k6 run -e BASE_URL=https://<staging-preview> -e ORGANISER_EMAIL=… -e ORGANISER_PASSWORD=… \
//     -e SUPABASE_URL=… -e SUPABASE_PUBLISHABLE_KEY=… tests/load/scenarios/checkin.js
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { Counter } from "k6/metrics";
import { organiserToken } from "../lib/auth.js";
import { createClient, jsonBody, randomHex, uuidv4 } from "../lib/http.js";
import { buildThresholds, cloudOptions, envNumber, loadScale, scaled, SUMMARY_TREND_STATS } from "../lib/profile.js";
import { SEED_TITLE_PREFIX } from "../lib/seeded.js";
import { resolveTarget } from "../lib/target.js";

const target = resolveTarget(__ENV, { scenario: "checkin", readOnlyCapable: false });
if (target.readOnly) throw new Error("The door scenario writes check-ins: unset READ_ONLY.");

const seedPath = __ENV.SEED_FILE || "../seed/seed-output.local.json";

/** The seed's door event, or DOOR_EVENT_ID + DOOR_CODES_FILE (a JSON array of codes). Paths are relative to this file. */
function readDoor() {
  let seed = null;
  try {
    seed = JSON.parse(open(seedPath));
  } catch {
    seed = null;
  }
  const eventId = __ENV.DOOR_EVENT_ID || (seed && seed.door && seed.door.eventId) || null;
  let codes = [];
  if (__ENV.DOOR_CODES_FILE) codes = JSON.parse(open(__ENV.DOOR_CODES_FILE));
  else if (seed && seed.door && Array.isArray(seed.door.codes)) codes = seed.door.codes;
  return { eventId, codes };
}

const door = readDoor();
// Codes are bearer credentials for the seeded tickets: kept in memory once, never logged.
const codes = new SharedArray("door codes", () => door.codes);

const smoke = __ENV.SMOKE === "1";
const scale = loadScale(__ENV);
// Per minute (arrival rates must be whole numbers per time unit).
const peakPerMin = Math.min(scaled(envNumber(__ENV, "DOOR_PEAK_RATE", 5) * 60, scale), 600);
const basePerMin = Math.min(scaled(envNumber(__ENV, "DOOR_BASE_RATE", 1.5) * 60, scale), peakPerMin);
const scanners = Math.max(1, Math.round(envNumber(__ENV, "SCANNERS", 3)));

const doorStages = smoke
  ? [{ duration: "20s", target: 30 }]
  : __ENV.DOOR_RESPECT_LIMIT === "1"
    ? [
        { duration: "30s", target: 110 },
        { duration: "4m30s", target: 110 },
      ]
    : [
        // Doors open.
        { duration: "30s", target: peakPerMin },
        // The rush.
        { duration: "90s", target: peakPerMin },
        { duration: "30s", target: basePerMin },
        // The steady stream.
        { duration: "150s", target: basePerMin },
      ];

export const options = {
  scenarios: {
    scans: {
      executor: "ramping-arrival-rate",
      exec: "scan",
      timeUnit: "1m",
      startRate: 30,
      stages: doorStages,
      preAllocatedVUs: smoke ? 2 : 10,
      maxVUs: smoke ? 5 : 40,
    },
    summary_poll: {
      executor: "constant-arrival-rate",
      exec: "summary",
      // Each scanner's 15-second poll.
      timeUnit: "15s",
      rate: scanners,
      duration: smoke ? "20s" : "5m",
      preAllocatedVUs: scanners,
      maxVUs: scanners * 3,
    },
  },
  thresholds: buildThresholds("checkin", __ENV, {
    // A retry with the same request id must give the original answer.
    checkin_replay_mismatch: ["count<1"],
  }),
  summaryTrendStats: SUMMARY_TREND_STATS,
  cloud: cloudOptions("Sheltuh: door check-in", __ENV),
};

const outcomes = new Counter("checkin_outcomes");
const replayMismatch = new Counter("checkin_replay_mismatch");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A well-formed code that isn't a ticket (40 random bits: a clash with a real code is negligible). */
function unknownCode() {
  const hex = randomHex(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 32];
    if (i === 3) code += "-";
  }
  return code;
}

export function setup() {
  if (!door.eventId) throw new Error("No door event: run the seed with --door (tests/load/README.md), or set DOOR_EVENT_ID.");
  if (codes.length === 0) throw new Error("No door codes: run the seed with --door, or set DOOR_CODES_FILE.");
  const client = createClient(target, __ENV);
  const token = organiserToken(__ENV);
  const res = client.get(`/api/organisers/me/events/${door.eventId}/check-ins`, {
    rg: "setup",
    name: "door summary",
    token,
    expect: [200, 401, 403, 404],
  });
  const body = jsonBody(res);
  if (res.status !== 200 || !body || !body.event) {
    throw new Error(`The organiser can't open the door for event ${door.eventId} (HTTP ${res.status}): wrong account, or not the seeded event.`);
  }
  if (String(body.event.title).indexOf(SEED_TITLE_PREFIX) !== 0 && __ENV.ALLOW_UNSEEDED_EVENTS !== "1") {
    throw new Error(`The door event isn't one the load-test seed made (title doesn't start with "${SEED_TITLE_PREFIX}").`);
  }
  console.log(`checkin: ${target.baseUrl}, ${codes.length} codes, peak ${peakPerMin}/min, ${scanners} scanners`);
  return { token };
}

const client = createClient(target, __ENV);
const scanPath = () => `/api/organisers/me/events/${door.eventId}/check-ins`;

function postScan(token, code, requestId) {
  return client.post(scanPath(), {
    rg: "checkin",
    name: "POST check-ins",
    token,
    json: { code, requestId },
    // Every ticket outcome is a 200. 429: over the account's allowance (nothing marked).
    expect: [200, 429],
    // The scanner's own timeout (DOOR_TIMING.requestTimeoutMs).
    timeout: "8s",
  });
}

/** One scan at the door. */
export function scan(data) {
  const i = exec.scenario.iterationInTest;
  const roll = Math.random();
  let code;
  let kind;
  if (roll < 0.03) {
    code = unknownCode();
    kind = "unknown";
  } else if (roll < 0.08 && i > 10) {
    // Someone shows the same ticket again (or a screenshot of it).
    code = codes[(i - 1 - Math.floor(Math.random() * 10)) % codes.length];
    kind = "rescan";
  } else {
    code = codes[i % codes.length];
    kind = "fresh";
  }
  // Most scans come through the camera (the QR's SH1: form); some are typed.
  const sent = Math.random() < 0.7 ? `SH1:${code}` : code.toLowerCase();
  const requestId = uuidv4();
  const res = postScan(data.token, sent, requestId);
  if (res.status !== 200) return;

  const body = jsonBody(res) || {};
  outcomes.add(1, { outcome: String(body.outcome), kind });
  const allowed =
    kind === "unknown" ? ["invalid"] : kind === "rescan" ? ["already_checked_in", "admitted"] : ["admitted", "already_checked_in"];
  const okOutcome = {};
  okOutcome[`checkin: ${kind} code gets an expected outcome`] = () => allowed.indexOf(body.outcome) !== -1;
  check(res, okOutcome);
  check(res, {
    "checkin: no buyer details in the answer": (r) => !/@|"buyer|"email|"orderId/i.test(String(r.body)),
    "checkin: admitted carries a checkInId": () => body.outcome !== "admitted" || typeof body.checkInId === "string",
  });

  if (Math.random() < 0.02) {
    // A retry after a lost response: same request id and code, same answer (no second log row).
    const again = postScan(data.token, sent, requestId);
    if (again.status === 200) {
      const replay = jsonBody(again) || {};
      if (replay.outcome !== body.outcome) replayMismatch.add(1);
      check(again, { "checkin: a retry replays the original outcome": () => replay.outcome === body.outcome });
    }
  }
  if (Math.random() < 0.5) {
    // The scanner's debounced refresh after a result.
    sleep(1);
    summary(data);
  }
}

/** The door's counters and recent scans. */
export function summary(data) {
  const res = client.get(scanPath(), { rg: "checkin_summary", name: "GET check-ins", token: data.token });
  const body = jsonBody(res);
  check(res, { "summary: has the event and recent scans": () => res.status !== 200 || (!!body && !!body.event) });
}
