import type { Metadata, ResolvingMetadata } from "next";
import CommunityPage from "@/components/community/CommunityPage";
import { COMMUNITY_LEDE } from "@/components/community/community-content";
import { inheritedShareImages, pageShareMetadata, siteOrigin } from "@/lib/share-metadata";

/** The page's title and description (the hero's lede), with its canonical URL and link preview. */
export async function generateMetadata(_props: PageProps<"/community">, parent: ResolvingMetadata): Promise<Metadata> {
  return pageShareMetadata(
    { title: "Community — Sheltüh", description: COMMUNITY_LEDE, path: "/community" },
    siteOrigin(),
    await inheritedShareImages(parent),
  );
}

export default function Community() {
  return <CommunityPage />;
}
