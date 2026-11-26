/**
 * The account pages' title blocks (AccountPageHead), shared by each page and its loading.tsx, so the
 * title is already in place while the page loads and doesn't move when it arrives.
 */
export const SETTINGS_HEAD = { title: "Settings", intro: "Your profile, privacy and sign-in.", tall: true } as const;
export const MY_TICKETS_HEAD = { title: "My tickets", intro: "Tickets you’ve bought or been sent." } as const;
export const SAVED_HEAD = { title: "Saved", intro: "Events you’ve saved for later." } as const;
