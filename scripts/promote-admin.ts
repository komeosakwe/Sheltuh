/**
 * Grants (or with --revoke, removes) Sheltüh admin access for an existing,
 * already-verified account.
 *
 * This is the only way an account becomes an admin: there's no API route or
 * sign-up option for it. It sets `app_metadata.role = "admin"`, which only a
 * service-role key can write and which the API re-reads from Supabase Auth
 * on every request (lib/server/deps.ts).
 *
 * Usage (needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY, e.g. in
 * .env.local):
 *   npm run promote-admin -- someone@example.com
 *   npm run promote-admin -- someone@example.com --revoke
 *
 * The admin must sign out and back in (or wait up to an hour for their
 * session to refresh) before the admin screens appear; the API itself
 * honours the change immediately.
 */
import { createClient, type User } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Add it to .env.local (see docs/supabase-setup.md).`);
    process.exit(1);
  }
  return value;
}

async function findUserByEmail(email: string, list: (page: number) => Promise<User[]>): Promise<User | undefined> {
  for (let page = 1; ; page += 1) {
    const users = await list(page);
    const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match || users.length === 0) return match;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  const revoke = args.includes("--revoke");
  if (!email) {
    console.error("Usage: npm run promote-admin -- someone@example.com [--revoke]");
    process.exit(1);
  }

  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const user = await findUserByEmail(email, async (page) => {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    return data.users;
  });
  if (!user) {
    console.error(`No account found for ${email}. They need to sign up (and verify their email) first.`);
    process.exit(1);
  }
  if (!user.email_confirmed_at) {
    console.error(`${email} hasn't verified their email yet.`);
    process.exit(1);
  }

  const appMetadata = { ...user.app_metadata };
  if (revoke) delete appMetadata.role;
  else appMetadata.role = "admin";
  const { error } = await supabase.auth.admin.updateUserById(user.id, { app_metadata: appMetadata });
  if (error) throw error;
  console.log(revoke ? `Removed admin access from ${email}.` : `${email} is now an admin.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
