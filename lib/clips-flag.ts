/**
 * Event clips' uploads are behind NEXT_PUBLIC_EVENT_CLIPS (.env.example):
 * "1" shows the clip field in the event editor (organiser and admin) and the
 * clip row in the admin queue. Anything else hides both, and nothing can be
 * uploaded. Playing a clip needs no flag: a clip can only exist once uploads
 * are on, so the Play buttons show wherever an event has one.
 *
 * A literal `process.env.NEXT_PUBLIC_…` reference, read when called: Next
 * inlines it at build time (redeploy after changing it), and tests can stub it.
 */
export function eventClipsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_EVENT_CLIPS === "1";
}
