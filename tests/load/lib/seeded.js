// The write scenarios only touch events the load-test seed made: their titles
// start with SEED_TITLE_PREFIX (tests/load/seed/seed.ts). A real event, or a
// deployment wired to the wrong database, stops the run in setup().
import { jsonBody } from "./http.js";

export const SEED_TITLE_PREFIX = "[Load test]";

/** The published event by slug (setup), refused unless it's a seeded one (or ALLOW_UNSEEDED_EVENTS=1). */
export function seededEvent(client, env, slug, what) {
  if (!slug) throw new Error(`No ${what} event: run the seed (tests/load/README.md) or set its slug.`);
  const res = client.get(`/api/events/slug/${encodeURIComponent(slug)}?_lt=setup`, { rg: "setup", name: "seeded event", expect: [200, 404] });
  const body = jsonBody(res);
  if (res.status !== 200 || !body) {
    throw new Error(`The ${what} event "${slug}" isn't published on ${client.target.baseUrl} (HTTP ${res.status}). Seed the staging database it uses.`);
  }
  if (String(body.title).indexOf(SEED_TITLE_PREFIX) !== 0 && env.ALLOW_UNSEEDED_EVENTS !== "1") {
    throw new Error(
      `The ${what} event "${slug}" wasn't made by the load-test seed (its title doesn't start with "${SEED_TITLE_PREFIX}"). ` +
        "Is this deployment wired to production's database? Set ALLOW_UNSEEDED_EVENTS=1 only for a staging event you made yourself.",
    );
  }
  return body;
}
