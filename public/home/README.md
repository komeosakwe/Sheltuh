Photos for the home page's static slots (`components/home/home-content.ts`):
the hero, the city guide card and the creators card. Drop a file here (e.g. `hero.jpg`),
ideally a square of at least 1200px so it survives every crop (images crop from the centre),
then set the matching `imageUrl` (e.g. `HOME_HERO.imageUrl = "/home/hero.jpg"`). Until then
each slot shows its generated poster art, at the same fixed size.
Find your people's "A look inside" card takes up to four square portraits (at least 160px) for
its circles: list their paths in `COMMUNITY_SAMPLE_FACES`. They show in the demo only, labelled
as sample attendees; live, the circles stay plain shapes.
Only use images you have the rights to.
