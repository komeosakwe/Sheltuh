import { listFavouriteIds } from "@/lib/server/handlers/favourites";
import { route } from "@/lib/server/route";

export const GET = route(listFavouriteIds);
