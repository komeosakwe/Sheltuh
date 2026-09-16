import type { SheltuhEvent } from "./types";

/**
 * Fictional demo events. `startsAt` / `endsAt` are real UTC instants (the
 * same shape the live API returns) computed from each event's intended
 * Australia/Melbourne wall-clock time, accounting for AEST/AEDT — see
 * lib/format.ts for how they're rendered back to Melbourne local time.
 */
export const sampleEvents: SheltuhEvent[] = [
  {
    id: "evt-neon-static",
    slug: "neon-static",
    title: "Neon Static",
    description:
      "A night of fuzzed-out guitars and analog synths from three of Melbourne's loudest emerging acts. Warehouse 9 turns its loading dock into a makeshift stage for one night only, with local artists projecting live visuals behind the bands.",
    category: "live-music",
    suburb: "Collingwood",
    venueName: "Warehouse 9",
    venueAddress: "9 Rupert Street, Collingwood VIC 3066",
    startsAt: "2026-09-25T10:00:00.000Z",
    endsAt: "2026-09-25T14:00:00.000Z",
    organiserName: "Static Collective",
    poster: { pattern: "burst", background: "#0a0a12", primary: "#1e3fe0", secondary: "#ff2f6e" },
    ticketTypes: [
      {
        id: "neon-static-ga",
        name: "General admission",
        priceCents: 3000,
        feePolicy: "buyer-pays",
        quantityAvailable: 150,
      },
      {
        id: "neon-static-vip",
        name: "VIP (side-of-stage viewing)",
        description: "Includes one drink token and a signed poster.",
        priceCents: 5500,
        feePolicy: "organiser-absorbs",
        quantityAvailable: 20,
      },
    ],
  },
  {
    id: "evt-paper-moon-ceramics",
    slug: "paper-moon-ceramics-lab",
    title: "Paper Moon Ceramics Lab",
    description:
      "A relaxed, beginner-friendly hand-building workshop. Walk out with two greenware pieces (glazing and firing included, ready for pickup two weeks later). All materials, aprons and tea provided.",
    category: "workshop",
    suburb: "Northcote",
    venueName: "The Kiln Room",
    venueAddress: "212 High Street, Northcote VIC 3070",
    startsAt: "2026-10-03T00:00:00.000Z",
    endsAt: "2026-10-03T03:00:00.000Z",
    organiserName: "Paper Moon Studio",
    poster: { pattern: "rings", background: "#141414", primary: "#d98a3d", secondary: "#2f5bf6" },
    ticketTypes: [
      {
        id: "paper-moon-seat",
        name: "Workshop seat",
        description: "Includes all clay, glazing and firing.",
        priceCents: 6500,
        feePolicy: "organiser-absorbs",
        quantityAvailable: 12,
      },
    ],
  },
  {
    id: "evt-southbank-sketch-salon",
    slug: "southbank-sketch-salon",
    title: "Southbank Sketch Salon",
    description:
      "A drop-in life drawing salon for all skill levels. Bring your own materials or borrow a set at the door. Professional models, moody lighting and quiet company — no instruction, just time to draw.",
    category: "art",
    suburb: "Southbank",
    venueName: "The Boyd Annex",
    venueAddress: "207 City Road, Southbank VIC 3006",
    startsAt: "2026-09-30T08:30:00.000Z",
    endsAt: "2026-09-30T11:00:00.000Z",
    organiserName: "Southbank Drawing Group",
    poster: { pattern: "grid", background: "#050507", primary: "#2451f5", secondary: "#f5f4f0" },
    ticketTypes: [
      {
        id: "sketch-salon-entry",
        name: "Entry (donation welcome at the door)",
        priceCents: 0,
        feePolicy: "buyer-pays",
        quantityAvailable: 40,
      },
    ],
  },
  {
    id: "evt-laneway-projections",
    slug: "laneway-projections-after-dark",
    title: "Laneway Projections: After Dark",
    description:
      "A free outdoor projection trail through a CBD laneway, featuring six looped works from Melbourne digital artists. Wander through any time across the evening — no ticket scanning, just show up.",
    category: "pop-up",
    suburb: "Melbourne CBD",
    venueName: "Hosier Lane Annex",
    venueAddress: "Hosier Lane, Melbourne VIC 3000",
    startsAt: "2026-10-08T08:00:00.000Z",
    endsAt: "2026-10-08T12:00:00.000Z",
    organiserName: "Afterimage Projects",
    poster: { pattern: "stripes", background: "#000000", primary: "#1633a8", secondary: "#34e2c4" },
    ticketTypes: [
      {
        id: "laneway-projections-entry",
        name: "Free entry",
        priceCents: 0,
        feePolicy: "buyer-pays",
        quantityAvailable: 500,
      },
    ],
  },
  {
    id: "evt-fitzroy-poetry-noise",
    slug: "fitzroy-poetry-and-noise",
    title: "Fitzroy Poetry & Noise",
    description:
      "Spoken word sets traded off with short noise and ambient performances in a tin-walled backroom bar. Open mic slots available on the night — put your name down at the door.",
    category: "live-music",
    suburb: "Fitzroy",
    venueName: "The Tin Shed",
    venueAddress: "88 Brunswick Street, Fitzroy VIC 3065",
    startsAt: "2026-10-16T08:30:00.000Z",
    endsAt: "2026-10-16T11:30:00.000Z",
    organiserName: "Loose Tongue Collective",
    poster: { pattern: "waves", background: "#0b0b0f", primary: "#3b5bff", secondary: "#ffcf4d" },
    ticketTypes: [
      {
        id: "fitzroy-poetry-entry",
        name: "Entry",
        priceCents: 2000,
        feePolicy: "buyer-pays",
        quantityAvailable: 60,
      },
    ],
  },
  {
    id: "evt-brunswick-zine-fair",
    slug: "brunswick-zine-fair",
    title: "Brunswick Zine Fair",
    description:
      "Sixty-odd tables of self-published zines, risograph prints, comics and small-press books from across Victoria. Free entry, all ages, cash and card both welcome at stalls.",
    category: "pop-up",
    suburb: "Brunswick",
    venueName: "Brunswick Mechanics Hall",
    venueAddress: "270 Sydney Road, Brunswick VIC 3056",
    startsAt: "2026-09-27T01:00:00.000Z",
    endsAt: "2026-09-27T06:00:00.000Z",
    organiserName: "Small Press Melbourne",
    poster: { pattern: "confetti", background: "#111116", primary: "#274bdb", secondary: "#ff6b3d" },
    ticketTypes: [
      {
        id: "zine-fair-entry",
        name: "Free entry",
        priceCents: 0,
        feePolicy: "buyer-pays",
        quantityAvailable: 1000,
      },
    ],
  },
  {
    id: "evt-off-kilter",
    slug: "off-kilter-a-new-play",
    title: "Off-Kilter: A New Play",
    description:
      "A new 75-minute two-hander about two former housemates renegotiating a friendship, staged in the round in an intimate studio space. Written and directed by emerging Melbourne playwright R. Okafor-Lane.",
    category: "theatre",
    suburb: "St Kilda",
    venueName: "The Esplanade Studio",
    venueAddress: "14 Fitzroy Street, St Kilda VIC 3182",
    startsAt: "2026-11-14T08:00:00.000Z",
    endsAt: "2026-11-14T09:30:00.000Z",
    organiserName: "Off-Kilter Theatre Co.",
    poster: { pattern: "curtain", background: "#08080c", primary: "#152e8a", secondary: "#c81d4f" },
    ticketTypes: [
      {
        id: "off-kilter-full",
        name: "Full price",
        priceCents: 3500,
        feePolicy: "buyer-pays",
        quantityAvailable: 45,
      },
      {
        id: "off-kilter-concession",
        name: "Concession",
        description: "Student, health care card and pensioner concession.",
        priceCents: 2500,
        feePolicy: "buyer-pays",
        quantityAvailable: 15,
      },
    ],
  },
  {
    id: "evt-analog-print-weekend",
    slug: "analog-print-weekend",
    title: "Analog Print Weekend",
    description:
      "A two-day screen printing intensive covering exposure, registration and multi-colour printing. Leave with a finished run of prints on paper and tote bags. Small class size, all skill levels welcome.",
    category: "workshop",
    suburb: "Abbotsford",
    venueName: "Convent Print Studio",
    venueAddress: "1 St Heliers Street, Abbotsford VIC 3067",
    startsAt: "2026-11-20T23:00:00.000Z",
    endsAt: "2026-11-22T05:00:00.000Z",
    organiserName: "Convent Print Studio",
    poster: { pattern: "halftone", background: "#101014", primary: "#0c2fb0", secondary: "#2fd0c8" },
    ticketTypes: [
      {
        id: "print-weekend-seat",
        name: "Two-day pass",
        description: "Includes all materials and two finished tote bags.",
        priceCents: 12000,
        feePolicy: "organiser-absorbs",
        quantityAvailable: 10,
      },
    ],
  },
];
