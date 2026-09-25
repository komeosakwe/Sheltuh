import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import Stripe from "stripe";

interface StripeSecretShape {
  secretKey: string;
  webhookSecret: string;
}

const secretsClient = new SecretsManagerClient({});

// Cached at module scope so a warm Lambda invocation reuses the same client
// and doesn't re-fetch the secret on every request.
let cached: { stripe: Stripe; webhookSecret: string } | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function loadSecret(): Promise<StripeSecretShape> {
  const secretId = requireEnv("STRIPE_SECRET_ARN");
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) throw new Error("Stripe secret has no SecretString value.");
  const parsed = JSON.parse(result.SecretString) as Partial<StripeSecretShape>;
  if (!parsed.secretKey || !parsed.webhookSecret) {
    throw new Error(
      "Stripe secret is missing secretKey/webhookSecret — it still holds CDK's placeholder value. " +
        "See docs/aws-setup.md's Stripe section for how to fill it in with your real Stripe keys.",
    );
  }
  return parsed as StripeSecretShape;
}

/** Lazily loads the platform's Stripe secret key + webhook signing secret from Secrets Manager. */
export async function getStripe(): Promise<{ stripe: Stripe; webhookSecret: string }> {
  if (cached) return cached;
  const secret = await loadSecret();
  const stripe = new Stripe(secret.secretKey);
  cached = { stripe, webhookSecret: secret.webhookSecret };
  return cached;
}
