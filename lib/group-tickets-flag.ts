/**
 * Group tickets (one ticket that admits several people; docs/architecture.md,
 * "Group tickets") are dark-launched behind NEXT_PUBLIC_GROUP_TICKETS
 * (.env.example): "1" lets organisers and admins author them (the editor's
 * "Add a group ticket" and "People per ticket", and the API accepts
 * `admits` above 1). Anything else hides the authoring, and the API refuses
 * `admits` above 1 (400 fieldErrors "ticketTypes[i].admits").
 *
 * Authoring only. A group ticket that exists keeps selling, showing, scanning
 * and refunding whatever the flag says, so switching it off never strands a
 * buyer or a tier with sales.
 *
 * A literal `process.env.NEXT_PUBLIC_…` reference, read when called: Next
 * inlines it at build time (redeploy after changing it), and tests can stub it.
 */
export function groupTicketsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GROUP_TICKETS === "1";
}
