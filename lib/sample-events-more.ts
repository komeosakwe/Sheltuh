import { assignPoster } from "./live/assign-poster";
import type { EventCategory, FeePolicy, SheltuhEvent } from "./types";

/**
 * More fictional demo events, so the Discover carousel has enough to keep
 * streaming across the screen. Compact seeds are expanded into full
 * SheltuhEvents below. Every venue, organiser and act here is made up.
 *
 * All dates fall in Melbourne daylight time (AEDT, UTC+11), which runs from
 * the first Sunday of October, so a single offset converts them to UTC.
 */

type TicketSeed = [name: string, priceCents: number, feePolicy?: FeePolicy, quantity?: number];

interface Seed {
  slug: string;
  title: string;
  category: EventCategory;
  venue: string;
  address: string;
  suburb: string;
  coordinates: [lat: number, lng: number];
  /** Melbourne wall-clock, "YYYY-MM-DD HH:MM" (24h). */
  start: string;
  hours: number;
  organiser: string;
  description: string;
  tickets: TicketSeed[];
}

const AEDT_OFFSET_HOURS = 11;

function toUtcIso(local: string, addHours = 0): string {
  const [date, time] = local.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - AEDT_OFFSET_HOURS + addHours, minute)).toISOString();
}

const SEEDS: Seed[] = [
  {
    slug: "midnight-tape-club",
    title: "Midnight Tape Club",
    category: "live-music",
    venue: "The Cellar Door",
    address: "14 Gertrude Street, Fitzroy VIC 3065",
    suburb: "Fitzroy",
    coordinates: [-37.7985, 144.9786],
    start: "2026-10-06 20:30",
    hours: 4,
    organiser: "Cassette Culture",
    description:
      "Four bands play sets recorded straight to cassette, then sold at the merch table before you leave. Lo-fi, loud and one take only.",
    tickets: [["Entry", 2200]],
  },
  {
    slug: "sunday-linocut-social",
    title: "Sunday Linocut Social",
    category: "workshop",
    venue: "Inkwell Print Room",
    address: "3 Lygon Street, Brunswick East VIC 3057",
    suburb: "Brunswick East",
    coordinates: [-37.7752, 144.9816],
    start: "2026-10-11 13:00",
    hours: 3,
    organiser: "Inkwell Print Room",
    description:
      "Carve your first linocut block and pull a small run on the press. Tools, ink and paper are provided; bring an idea and an apron.",
    tickets: [["Workshop place", 6500, "buyer-pays", 14]],
  },
  {
    slug: "the-long-table-supper",
    title: "The Long Table Supper",
    category: "pop-up",
    venue: "Harvest Lane Hall",
    address: "22 Harvest Lane, Northcote VIC 3070",
    suburb: "Northcote",
    coordinates: [-37.7703, 144.9989],
    start: "2026-10-16 18:30",
    hours: 3,
    organiser: "Table & Tongue",
    description:
      "One long table, a shared menu from three local cooks, and a strangers-become-friends seating plan. Vegetarian-friendly.",
    tickets: [
      ["Seat at the table", 8500, "organiser-absorbs", 40],
      ["Seat + pairing", 11500, "buyer-pays", 20],
    ],
  },
  {
    slug: "glasshouse-sessions",
    title: "Glasshouse Sessions",
    category: "live-music",
    venue: "Botanica Conservatory",
    address: "1 Garden Walk, Carlton VIC 3053",
    suburb: "Carlton",
    coordinates: [-37.8003, 144.9671],
    start: "2026-10-18 16:00",
    hours: 3,
    organiser: "Greenroom Live",
    description:
      "Acoustic sets among the ferns. Three songwriters, no amplification, and the last of the afternoon light through the glass roof.",
    tickets: [["General admission", 3500]],
  },
  {
    slug: "after-hours-life-drawing",
    title: "After Hours Life Drawing",
    category: "art",
    venue: "Studio 44",
    address: "44 Johnston Street, Collingwood VIC 3066",
    suburb: "Collingwood",
    coordinates: [-37.8018, 144.9865],
    start: "2026-10-22 19:00",
    hours: 2,
    organiser: "Studio 44 Collective",
    description:
      "Relaxed evening drawing from a live model with a DJ in the corner. Paper and charcoal provided; bring your own wine.",
    tickets: [["Drop-in", 2500]],
  },
  {
    slug: "dead-letter-office",
    title: "Dead Letter Office",
    category: "theatre",
    venue: "The Depot Theatre",
    address: "8 Sydney Road, Coburg VIC 3058",
    suburb: "Coburg",
    coordinates: [-37.7445, 144.9655],
    start: "2026-10-24 19:30",
    hours: 2,
    organiser: "Small Hours Theatre",
    description:
      "A two-hander about the last clerks in a postal sorting office and the letters nobody came to collect. New Australian writing.",
    tickets: [
      ["Adult", 3800],
      ["Concession", 2800],
    ],
  },
  {
    slug: "wax-and-wick-market",
    title: "Wax & Wick Makers Market",
    category: "pop-up",
    venue: "Yarraville Sheds",
    address: "60 Anderson Street, Yarraville VIC 3013",
    suburb: "Yarraville",
    coordinates: [-37.8156, 144.8893],
    start: "2026-10-25 10:00",
    hours: 6,
    organiser: "Wax & Wick",
    description:
      "Thirty independent makers — candles, ceramics, zines and small-batch skincare — in an old goods shed. Free entry, coffee on site.",
    tickets: [["Free entry", 0]],
  },
  {
    slug: "sub-bass-sunday",
    title: "Sub Bass Sunday",
    category: "live-music",
    venue: "Basement 12",
    address: "12 Flinders Lane, Melbourne VIC 3000",
    suburb: "Melbourne",
    coordinates: [-37.8163, 144.9691],
    start: "2026-11-01 21:00",
    hours: 5,
    organiser: "Low End Theory Collective",
    description:
      "A long, low, unhurried night of dub, jungle and bass music on a properly loud system. Earplugs at the door.",
    tickets: [
      ["Early bird", 1800, "buyer-pays", 60],
      ["General admission", 2500, "buyer-pays", 140],
    ],
  },
  {
    slug: "ceramics-for-beginners",
    title: "Ceramics for Beginners",
    category: "workshop",
    venue: "The Kiln Room",
    address: "5 High Street, Northcote VIC 3070",
    suburb: "Northcote",
    coordinates: [-37.7705, 144.9993],
    start: "2026-11-05 18:00",
    hours: 3,
    organiser: "The Kiln Room",
    description:
      "Learn to centre clay and throw a small bowl on the wheel. Your piece is glazed and fired for pickup two weeks later.",
    tickets: [["Class place", 8000, "buyer-pays", 10]],
  },
  {
    slug: "polaroid-portrait-pop-up",
    title: "Polaroid Portrait Pop-Up",
    category: "pop-up",
    venue: "Flash Gallery",
    address: "19 Smith Street, Fitzroy VIC 3065",
    suburb: "Fitzroy",
    coordinates: [-37.7991, 144.9838],
    start: "2026-11-07 12:00",
    hours: 6,
    organiser: "Flash Collective",
    description:
      "Sit for an analogue instant portrait by one of five local photographers. Every print is yours to keep; a few go on the wall.",
    tickets: [["Portrait sitting", 3000, "organiser-absorbs", 60]],
  },
  {
    slug: "the-quiet-hour-poetry",
    title: "The Quiet Hour: Poetry Night",
    category: "art",
    venue: "Reading Room Bar",
    address: "27 Nicholson Street, Brunswick VIC 3056",
    suburb: "Brunswick",
    coordinates: [-37.7668, 144.9611],
    start: "2026-11-10 19:00",
    hours: 2,
    organiser: "Reading Room Collective",
    description:
      "Twelve five-minute readings, an open mic to close, and no phones. Free, though donations to the readers are welcome.",
    tickets: [["Free entry", 0]],
  },
  {
    slug: "pressure-drop-reggae-night",
    title: "Pressure Drop Reggae Night",
    category: "live-music",
    venue: "The Bowery Room",
    address: "88 Chapel Street, Windsor VIC 3181",
    suburb: "Windsor",
    coordinates: [-37.8563, 144.9928],
    start: "2026-11-14 20:00",
    hours: 5,
    organiser: "Pressure Drop Sound",
    description:
      "A live roots band followed by selectors playing dubplates and rocksteady 45s until late.",
    tickets: [["General admission", 3000]],
  },
  {
    slug: "clay-and-coffee-morning",
    title: "Clay & Coffee Morning",
    category: "workshop",
    venue: "Stovetop Studio",
    address: "6 Victoria Street, Abbotsford VIC 3067",
    suburb: "Abbotsford",
    coordinates: [-37.8035, 145.0006],
    start: "2026-11-15 09:30",
    hours: 3,
    organiser: "Stovetop Studio",
    description:
      "Hand-building ceramics over good coffee: pinch pots, coil mugs and small plates. No experience needed.",
    tickets: [["Morning session", 5500, "buyer-pays", 12]],
  },
  {
    slug: "the-last-tram-cabaret",
    title: "The Last Tram Cabaret",
    category: "theatre",
    venue: "The Velvet Annex",
    address: "101 Acland Street, St Kilda VIC 3182",
    suburb: "St Kilda",
    coordinates: [-37.8679, 144.9803],
    start: "2026-11-28 20:00",
    hours: 3,
    organiser: "Velvet Annex Productions",
    description:
      "Torch songs, tall stories and slightly dangerous comedy from six Melbourne performers, hosted from a tram-shaped stage.",
    tickets: [
      ["Standing", 3200],
      ["Reserved table", 5200, "organiser-absorbs", 24],
    ],
  },
  {
    slug: "summer-solstice-warehouse",
    title: "Summer Solstice Warehouse",
    category: "live-music",
    venue: "Dock 5",
    address: "5 Wurundjeri Way, Docklands VIC 3008",
    suburb: "Docklands",
    coordinates: [-37.8172, 144.9527],
    start: "2026-12-12 21:00",
    hours: 6,
    organiser: "Longest Day Records",
    description:
      "The year's biggest room, three floors of house and disco, and a sunrise finish for anyone still standing.",
    tickets: [
      ["Early bird", 3500, "buyer-pays", 100],
      ["General admission", 4800, "buyer-pays", 300],
    ],
  },
  {
    slug: "sketchbook-swap-and-social",
    title: "Sketchbook Swap & Social",
    category: "art",
    venue: "The Paper Mill",
    address: "31 Hopkins Street, Footscray VIC 3011",
    suburb: "Footscray",
    coordinates: [-37.7999, 144.8993],
    start: "2026-12-05 14:00",
    hours: 3,
    organiser: "Paper Mill Arts",
    description:
      "Bring a sketchbook, swap it with a stranger and draw in each other's pages. Materials, snacks and good company provided.",
    tickets: [["Free entry", 0]],
  },
];

export const generatedSampleEvents: SheltuhEvent[] = SEEDS.map((seed) => ({
  id: `evt-${seed.slug}`,
  slug: seed.slug,
  imageUrl: `/events/${seed.slug}.jpg`,
  title: seed.title,
  description: seed.description,
  category: seed.category,
  suburb: seed.suburb,
  venueName: seed.venue,
  venueAddress: seed.address,
  coordinates: { lat: seed.coordinates[0], lng: seed.coordinates[1] },
  startsAt: toUtcIso(seed.start),
  endsAt: toUtcIso(seed.start, seed.hours),
  organiserName: seed.organiser,
  poster: assignPoster(seed.slug),
  ticketTypes: seed.tickets.map(([name, priceCents, feePolicy = "buyer-pays", quantity = 100], i) => ({
    id: `${seed.slug}-${i}`,
    name,
    priceCents,
    feePolicy,
    quantityAvailable: quantity,
  })),
}));
