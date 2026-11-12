/**
 * KEEP THIS OFF until both (1) reports keep a copy of member photos and
 * admins can remove a single photo (the follow-up "PR 2": not built yet;
 * without it a reported photo can't be kept as evidence or taken down) has
 * merged, and (2) the Terms and Privacy wording is approved.
 *
 * Member photos (up to MAX_MEMBER_PHOTOS on a member profile, beside the
 * profile photo; docs/architecture.md, "Member photos") are dark-launched
 * behind NEXT_PUBLIC_MEMBER_PHOTOS (.env.example): "1" lets members upload
 * them. Anything else (the default) and the API refuses new uploads (503
 * from POST /api/profiles/me/photos), so nothing can be added until the
 * owner turns it on (after the Terms and Privacy wording is approved).
 *
 * Uploads only. Photos that exist can still be described, deleted and seen
 * by whoever may see the profile, so switching it off never strands one.
 *
 * A literal `process.env.NEXT_PUBLIC_…` reference, read when called: Next
 * inlines it at build time (redeploy after changing it), and tests can stub it.
 */
export function memberPhotosEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MEMBER_PHOTOS === "1";
}
