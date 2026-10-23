import type { Metadata, ResolvingMetadata } from "next";
import Home from "@/components/home/Home";
import { inheritedShareImages, pageShareMetadata, SITE_NAME, siteOrigin } from "@/lib/share-metadata";

/** The site's own title and description (app/layout.tsx), plus the home's canonical URL and link preview. */
export async function generateMetadata(_props: PageProps<"/">, parent: ResolvingMetadata): Promise<Metadata> {
  const resolved = await parent;
  return pageShareMetadata(
    {
      title: resolved.title?.absolute || SITE_NAME,
      description: resolved.description ?? "",
      path: "/",
    },
    siteOrigin(),
    await inheritedShareImages(Promise.resolve(resolved)),
  );
}

export default function DiscoverPage() {
  return <Home />;
}
