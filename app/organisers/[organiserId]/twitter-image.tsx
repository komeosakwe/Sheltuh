// The same card for Twitter/X (app/organisers/[organiserId]/opengraph-image.tsx).
export { contentType, default, generateImageMetadata, size } from "./opengraph-image";

// Next reads this export statically, so it can't be re-exported.
export const dynamic = "force-dynamic";
