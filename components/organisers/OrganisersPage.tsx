import ApplyPageContent from "./ApplyPageContent";
import OrganisersHero from "./OrganisersHero";
import { OrganiserPillars, PublishSteps, WhySheltuh } from "./OrganisersSections";
import Strap from "@/components/ui/Strap";
import { START_EYEBROW, START_ID, START_TITLE_ID } from "./organisers-content";

/**
 * /organisers/apply, the For organisers page (redesign PR 6; the owner's mock): the hero, Create /
 * Reach / Grow, the four steps, Why Sheltüh? and the Start organising panel, which holds the
 * application itself (ApplyPageContent: sign in, the form, its status). Every "For organisers"
 * link lands here; an approved organiser still goes straight on to /dashboard.
 */
export default function OrganisersPage() {
  return (
    <>
      <OrganisersHero />
      <div className="page-container pb-16 md:pb-24">
        <OrganiserPillars className="mt-8 lg:mt-4" />
        <PublishSteps className="mt-16 lg:mt-24" />
        <WhySheltuh className="mt-16 lg:mt-24" />
        {/* --hover: cream on White, dark grey on Dark (the mock's panels); the orange dots stay above 3:1 on both. */}
        <section
          id={START_ID}
          aria-labelledby={START_TITLE_ID}
          className="mt-16 rounded-card bg-hover p-6 md:p-12 lg:mt-24"
        >
          <Strap label={START_EYEBROW} rule={false} />
          <div className="mt-4">
            <ApplyPageContent />
          </div>
        </section>
      </div>
    </>
  );
}
