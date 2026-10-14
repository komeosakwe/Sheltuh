import { deleteFavourite, putFavourite } from "@/lib/server/handlers/favourites";
import { route } from "@/lib/server/route";

export const PUT = route(putFavourite);
export const DELETE = route(deleteFavourite);
