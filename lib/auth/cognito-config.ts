import { CognitoUserPool } from "amazon-cognito-identity-js";

/**
 * Both must be set for real auth to work. Unset in local/demo mode — every
 * caller checks `isAuthConfigured` first rather than letting this throw.
 */
export const isAuthConfigured = Boolean(
  process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID && process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
);

let cachedPool: CognitoUserPool | undefined;

export function getUserPool(): CognitoUserPool | undefined {
  if (!isAuthConfigured) return undefined;
  if (!cachedPool) {
    cachedPool = new CognitoUserPool({
      UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID as string,
      ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID as string,
    });
  }
  return cachedPool;
}
