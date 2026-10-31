import { getExternalGoingSummary } from "@/lib/server/handlers/external-going";
import { route } from "@/lib/server/route";

export const GET = route(getExternalGoingSummary);
