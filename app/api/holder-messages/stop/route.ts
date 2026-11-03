import { openStopHolderMessages, stopHolderMessages } from "@/lib/server/handlers/holder-messages";
import { route } from "@/lib/server/route";

// GET only redirects to the confirm page; POST (the page's button, or a mail client's one-click unsubscribe) suppresses.
export const GET = route(openStopHolderMessages);
export const POST = route(stopHolderMessages);
