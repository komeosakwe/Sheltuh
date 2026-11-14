import { offeredOAuthProviders, type OAuthProvider } from "@/lib/auth/oauth";
import { useNativeApp } from "@/lib/mobile/use-native-app";

/**
 * The Apple and Google sign-in buttons this page shows: offeredOAuthProviders,
 * but none inside the phone app until it has its own sign-in return
 * (docs/mobile-app.md, "Not yet: Google and Apple sign-in"). There, Supabase's
 * sign-in page opens in the system browser and the sign-in would finish
 * there, not in the app. `flagged` is what the flag offers regardless, for
 * copy that tells people with those accounts what to do.
 */
export function useOfferedOAuthProviders(configured: boolean): { providers: OAuthProvider[]; flagged: OAuthProvider[]; nativeApp: boolean } {
  const nativeApp = useNativeApp();
  const flagged = offeredOAuthProviders(configured);
  return { providers: nativeApp ? [] : flagged, flagged, nativeApp };
}
