/**
 * Demo-mode member profiles (no API): fictional people with a Who's Going
 * profile they've made visible. Static data only: no photos (initials
 * stand in, as for a member without one), and Instagram handles that are
 * plainly made up for the demo. As on the live site, profiles are opt-in:
 * only these first names on the sample Who's Going lists
 * (lib/sample-going.ts) link to a profile, and everyone else stays plain
 * text. lib/sample-member-profiles.ts builds the profile pages from this
 * and the sample events.
 */

export interface SampleMember {
  /** The id in /members/{profileId}, and of the demo conversation with them (lib/sample-messages.ts). */
  profileId: string;
  /** The first name the sample lists use; whoever has it on a list is this member. */
  firstName: string;
  /** Their display name everywhere ("Priya R."). */
  displayName: string;
  bio?: string;
  instagramHandle?: string;
}

export const SAMPLE_MEMBERS: readonly SampleMember[] = [
  {
    profileId: "priya-r",
    firstName: "Priya",
    displayName: "Priya R.",
    bio: "Gig regular, usually near the merch table. Always up for a pre-show dumpling.",
    instagramHandle: "sheltuh_demo_priya",
  },
  {
    profileId: "ben-b",
    firstName: "Ben",
    displayName: "Ben B.",
    bio: "Printmaker by day. Looking for people to go to zine fairs and life drawing with.",
  },
  {
    profileId: "maeve-d",
    firstName: "Maeve",
    displayName: "Maeve D.",
    bio: "New to Melbourne and saying yes to everything. Theatre, poetry, anything with a bar.",
    instagramHandle: "sheltuh_demo_maeve",
  },
  {
    profileId: "kai-s",
    firstName: "Kai",
    displayName: "Kai S.",
    bio: "Dub, reggae and anything with a big sound system.",
  },
  {
    profileId: "zara-m",
    firstName: "Zara",
    displayName: "Zara M.",
    bio: "Ceramics beginner. Happy to share a wheel.",
  },
  {
    profileId: "theo-w",
    firstName: "Theo",
    displayName: "Theo W.",
  },
  {
    profileId: "ruby-h",
    firstName: "Ruby",
    displayName: "Ruby H.",
    bio: "Photographer. I'll be the one with the film camera.",
    instagramHandle: "sheltuh_demo_ruby",
  },
  {
    profileId: "jonah-p",
    firstName: "Jonah",
    displayName: "Jonah P.",
    bio: "Here for the open mics.",
  },
];

/** The sample member with this first name, if they've a profile. */
export function sampleMemberByFirstName(firstName: string): SampleMember | undefined {
  return SAMPLE_MEMBERS.find((member) => member.firstName === firstName);
}

/** The sample member with this profile id, if there is one. */
export function sampleMemberById(profileId: string): SampleMember | undefined {
  return SAMPLE_MEMBERS.find((member) => member.profileId === profileId);
}

/** Their profile on Instagram, as the API builds it from a handle. */
export function sampleInstagramUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}
