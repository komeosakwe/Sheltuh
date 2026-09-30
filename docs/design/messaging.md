# Messages: as built

Status: built (Sept 2026). Consent and `/privacy` copy still need product/legal sign-off.
Contract: `lib/api/messages.ts`, `lib/api/admin.ts`, `docs/architecture.md` ("Messages").
Tokens, type and shapes are the existing ones (`docs/design-system.md`); nothing new was added.

## Where it lives

| Surface | Code |
| --- | --- |
| "Message" on Who's Going names | `components/messages/ComposeRequest.tsx` (`AttendeeMessageAction`, `ComposeRequestForm`), wired in `components/WhosGoing.tsx` via `NameList`'s `renderAction` |
| `/messages` inbox | `components/messages/Inbox.tsx` |
| `/messages/[conversationId]` thread | `Thread.tsx`, `MessageList.tsx`, `Composer.tsx`, `ReportDialog.tsx` |
| `/messages/blocked` | `BlockedList.tsx` (also linked from `/account` → Messages) |
| Nav badge | `UnreadProvider.tsx` (mounted in `app/layout.tsx`), shown by `AuthNavLinks.tsx` |
| `/admin/reports` | `components/admin/ReportQueue.tsx` (behind `AdminGate`) |
| Shared | `MessagesGate.tsx` (demo / auth / sign-in), `MessageField.tsx`, `shared.ts` (error mapping, copy), `lib/message-text.ts`, `lib/use-visible-interval.ts`, `lib/format.ts` `formatMessageTime` |

## Behaviour

- **Who can start one.** Only a member who is on the list themselves (live mode, signed in,
  going, not suspended) sees "Message" beside the other names; the "You" row has none. With
  the button the list goes to one column: two columns leave no room for a 44px button beside a
  name at 320px. One compose form is open at a time, under its row (a disclosure, not a modal),
  with focus in the box. It explains: it's a request with your display name and this event; if
  they reply you can keep chatting; until then you can't send another and they might not reply;
  no links. Sent → "Request sent to {name}. View conversation" (focused).
- **Errors (request).** 400 field error on the box; other 400/403 use the API's sentence (verify
  email, not going to the same event, suspended, messaging yourself); 404 is always "This person
  can't be messaged." (blocked, declined, suspended and gone are never told apart); 409 "You
  already have a conversation with {name}. Go to your messages"; 429 "You've sent a lot of
  message requests today. Try again tomorrow."; 413 and anything else are the generic "Couldn't
  send that. Try again."; session expiry adds Sign in (back to
  `#whos-going`). Non-field errors are focused; the draft is kept.
- **Inbox.** One list, newest activity first (the API pages by activity, so requests aren't
  split out). Each row links to the thread: initials, name (bold with an "Unread:" prefix for
  screen readers and a square marker when unread), time, a "Message request" / "Waiting for a
  reply" tag, the event, and a two-line preview ("You: …" for your own). Loading, empty ("No
  messages yet" + how it works), error with Try again, Load more (focus to the first new row,
  announced). Loading the inbox refreshes the nav badge.
- **Thread.** Header: "← All messages", name (h1), "Going to {event}" (44px link), Report and
  Block. Messages oldest first; "Load earlier messages" at the top (focus to the first loaded,
  announced). Bodies are React text in `whitespace-pre-wrap break-words`: no HTML, no
  auto-linking. Yours: ink on the right; theirs: paper on the left; time under each. The
  composer is sticky at the foot (safe-area padding, 16px text on phones,
  `interactiveWidget: "resizes-content"` in `app/messages/layout.tsx` so Android keeps it above
  the keyboard). Ctrl/Cmd+Enter sends; Enter is a new line. After sending, focus returns to the
  box and "Message sent." is announced.
  - `request_received`: under the messages, "{name} wants to message you. Reply below to accept…
    Decline: they won't be told, and they can't send you another request." Box label "Reply to
    {name} to accept". Decline has an inline confirm (focus on Cancel). Replying switches to an
    ordinary conversation.
  - `request_sent`: box and Send disabled, described by "Waiting for {name} to reply. You can
    send more once they do. People don't always reply, and we won't tell you either way."
  - Send errors: field error on the box; 409 → "Wait for {name} to reply…" and the waiting state;
    429 "You've sent a lot of messages in the last hour…"; 403/network use the API's sentence;
    404 → "This conversation isn't available" (heading focused). Non-field errors are focused.
  - Block: inline confirm explaining it's silent and two-way; then "You blocked {name}" with
    Unblock (reloads the thread). A 404 (already blocked, a double submit, or gone) is shown the
    same way, without Unblock (no block id; the Blocked members link is there). 429: "You've
    blocked a lot of people today…" with the support address. Report: native `<dialog>` (bottom sheet on phones), reason
    radio group (required, error tied to the fieldset), optional details, "we won't tell
    {name}", "call 000" line; success closes it and focuses a thank-you notice. 429 is shown in
    the dialog; 404 closes it and shows the unavailable state.
- **Polling.** The thread checks `?after=` every 10s only while the tab is visible and the
  window focused; returning checks straight away if a full interval has passed. New messages
  from the other person are announced in the page's one polite live region ("New message from
  {name}." / "3 new messages from…") and marked read (up to the newest shown), which refreshes
  the badge. A conversation opened in a background tab isn't marked read until looked at. A
  failed check shows a quiet line and retries; a 404 swaps in the unavailable state without
  moving focus unless focus was in the thread.
- **Badge.** "Messages" is in the desktop row and the phone menu for signed-in members. The
  count (99+ cap) is part of the link's name ("Messages, 2 unread"), never a live region. It
  polls every 60s while visible; a 403 (unverified) hides it and stops polling; other failures
  keep the last count.
- **Blocked members** (page h1 "Blocked members"). List with "Unblock {name}", using the name kept at block time
  ("Member without a name" if they had none);
  focus moves to the next row, or the heading after the last; announced.
- **Admin reports.** Open / Suspended / Dismissed toggles (`aria-pressed`). Each report: reason
  and name (h3), date, event, account-deleted / suspended flags, reporter's details, the
  reported message and the context transcript (in a `<details>`), all plain text. Optional admin
  note; Dismiss, or Suspend member with an inline confirm. A 409 (resolved elsewhere) removes it
  and says so.
- **Demo mode.** No API calls anywhere: `/messages` and threads show a DemoNotice and a fixed
  sample conversation with a disabled composer; `/messages/blocked` a DemoNotice; no Message
  buttons on sample names; no nav link (no accounts).
- **Copy changes.** Who's Going consent now says others on the list can send one message
  request and nothing more unless you reply, and that you can decline, block or report.
  `/privacy` has a draft "Messages" section (`#messages`): who can message, silence of
  decline/block, what a report keeps, retention (12 months after the last message; reports 2
  years after resolution; deleting the profile erases conversations for both). `/account`'s
  delete-profile copy says conversations go too, and has a Messages section.

- **Text rules (client hint only; the API decides).** `lib/message-text.ts` mirrors the API: raw
  input over 4,000 UTF-16 units is refused before any regex runs; cleaning is linear (trailing
  spaces stripped per line with a loop); control characters, every invisible format character
  except ZWJ/ZWNJ (and emoji flag tag sequences), and line/paragraph separators are refused.
  Links are left to the API's field error.

## Not done

- No per-message "Report this message" (reports cover the conversation; `messageId` unused).
- No block/report from the Who's Going list itself (the API supports `attendeeId`); the list
  keeps "Report a name (by email)".
- Unverified members still see the Messages link; the page explains the 403.

## Review round (Oct 2026)

- **Ordering.** Block, decline, unblock and "gone" start a new generation in the thread: a
  check for new or earlier messages that began before it is dropped when it lands (no view
  swap, no "New message" announcement). A status the member changed locally (accepting by
  replying, or a 409 correcting it) isn't undone by a check that started earlier.
- **Block 404** shows the generic "This conversation isn't available" / "This person can't be
  messaged any more…" state. It never claims a block exists (a 404 also covers being blocked,
  suspension and deletion).
- **After declining or blocking,** Report stays available, and Block too after declining.
- **Expired sessions** (SessionExpiredError or any 401) in the composer, the first-message
  form and the report dialog sign in again inline (`InlineReauth`, locked to the account) and
  keep the draft. Load errors still offer the Sign in link.
- **Announcements.** A field error is an alert only when focus is already in the box
  (Ctrl/Cmd+Enter); otherwise focus moves to the box and the error is read as its
  description. Errors that take focus aren't alerts as well. The counter is only part of the
  description from 90% of the limit.
- **Headings and framing.** Every thread state has an h1 (sr-only "Conversation" while loading
  or on error; `EmptyState headingLevel={1}` for declined, blocked and signed out; "Messages" in
  demo), and the gate's states sit in the usual page padding. The page title becomes
  "{name} — Messages — Sheltüh".
- **Phones.** Composer label "Message" / "Reply to accept" with the name for screen readers
  only; one row that grows to 10rem, then scrolls. The site header isn't sticky below `lg` on
  a conversation. The Menu button shows the unread count ("Menu, 3 unread messages").
- **Copy.** Blocking everywhere: "We won't notify them, but they'll no longer see your
  conversation or be able to message you." Declining: "we won't notify them, but they won't be
  able to message you again." Report dialog and first-message form link to
  `/privacy#messages` ("How messages and reports are handled").
- **Dates** carry the year when it isn't the current one (`formatDayWithYear`,
  `formatMessageTime`), in threads, the inbox, blocked members and the admin queue.
- **Admin.** No Suspend for an already-suspended member or a deleted account (with a line
  saying why); the transcript `<summary>` has a visible marker.
- **Deferred:** per-attendee "you already have a conversation" state on the Who's Going list
  (needs a backend change), and a Playwright messaging journey in `e2e/`.
