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
      <div className="rise mt-6 [--d:500ms]">
        <SearchBar size="lg" submit label="Search events" />
      </div>
      <CategoryRow className="rise mt-6 [--d:600ms]" />
      <PhoneEventSections guide={<GuideCard className="reveal mt-8" />} />
      <CommunitySection className="reveal mt-8" />
      <CreatorsCard className="reveal mt-8" />
    </div>
  );
}
