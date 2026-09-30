import SearchBar from "@/components/SearchBar";
import CategoryRow from "./CategoryRow";
import CommunitySection from "./CommunitySection";
import CreatorsCard from "./CreatorsCard";
import GuideCard from "./GuideCard";
import PhoneEventSections from "./PhoneEventSections";
import PhoneHero from "./PhoneHero";

/**
 * The home page below 640px (docs/design/mobile-home.md). app/page.tsx shows
 * this on phones and the desktop tree from `sm` up; `display: none` keeps the
 * inactive one out of the accessibility tree.
 */
export default function PhoneHome({ className = "" }: { className?: string }) {
  return (
    <div className={`mx-auto px-5 pt-6 pb-12 ${className}`.trim()}>
      <PhoneHero />
      <div className="mt-6">
        <SearchBar size="lg" submit label="Search events" />
      </div>
      <CategoryRow className="mt-6" />
      <PhoneEventSections guide={<GuideCard className="mt-8" />} />
      <CommunitySection className="mt-8" />
      <CreatorsCard className="mt-8" />
    </div>
  );
}
