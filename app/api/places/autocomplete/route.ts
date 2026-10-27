import { placesAutocomplete } from "@/lib/server/handlers/places";
import { route } from "@/lib/server/route";

export const POST = route(placesAutocomplete);
