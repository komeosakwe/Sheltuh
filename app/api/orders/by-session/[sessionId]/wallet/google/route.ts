import { getGoogleWalletPass } from "@/lib/server/handlers/wallet";
import { route } from "@/lib/server/route";

export const GET = route(getGoogleWalletPass);
