#!/usr/bin/env node
/**
 * Grants Sheltüh admin access to a real, already-registered user.
 *
 * This is the ONLY way an account becomes an admin: there is no API route,
 * no signup checkbox, and no Lambda in this project with permission to add
 * anyone to the "admins" Cognito group (see infra/lib/sheltuh-stack.ts and
 * docs/architecture.md). Admin privileges are assigned through this trusted,
 * manual, out-of-band process — deliberately, per the milestone's product
 * rules.
 *
 * Usage:
 *   npm install                    # once, inside scripts/
 *   npm run promote-admin -- \
 *     --user-pool-id ap-southeast-2_XXXXXXXXX \
 *     --email someone@example.com \
 *     [--region ap-southeast-2] [--group admins]
 *
 * Requirements:
 *   - The target user must already exist and have completed sign-up
 *     (verified their email) — run this AFTER they've signed up, not before.
 *   - You need AWS credentials for the target account with
 *     cognito-idp:AdminGetUser and cognito-idp:AdminAddUserToGroup
 *     permission. Use short-lived credentials (AWS SSO / assumed role) —
 *     see docs/aws-setup.md. Never a long-lived IAM user access key, and
 *     never root credentials.
 *
 * This script never invents or hardcodes an email or user pool ID — both
 * are required arguments you supply yourself.
 */
import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };

  const userPoolId = get("--user-pool-id");
  const email = get("--email");
  const region = get("--region") ?? "ap-southeast-2";
  const groupName = get("--group") ?? "admins";

  if (!userPoolId || !email) {
    console.error(
      "Usage: promote-admin.ts --user-pool-id <id> --email <email> [--region ap-southeast-2] [--group admins]",
    );
    process.exit(1);
  }

  return { userPoolId, email, region, groupName };
}

async function main() {
  const { userPoolId, email, region, groupName } = parseArgs();
  const client = new CognitoIdentityProviderClient({ region });

  // Fail loudly if the user doesn't exist yet rather than silently no-op-ing.
  await client.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));

  await client.send(
    new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: email, GroupName: groupName }),
  );

  console.log(`Added ${email} to the "${groupName}" group in user pool ${userPoolId} (${region}).`);
  console.log("They need to sign out and back in for the new group membership to appear in their token.");
}

main().catch((err) => {
  console.error("Failed to promote admin:", err instanceof Error ? err.message : err);
  process.exit(1);
});
