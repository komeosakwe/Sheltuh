import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSmtpSender } from "@/lib/server/email";
import { encodePng } from "@/lib/server/png";
import { ticketQrMatrix } from "@/lib/ticket-qr";
import { createFakeStripeClient, decodeStripeForm, FakeStripe } from "../journey/harness/fake-stripe";
import { parseMail, qrModulesFromPng, SmtpSink } from "../journey/harness/smtp-sink";

/*
 * The journey harness's own parts (journey/harness), checked without a
 * database so `npm test` keeps them honest: a fake that accepted anything, or
 * a decoder that read anything as a match, would make the journeys pass
 * vacuously.
 */

describe("journey harness: QR read-back from PNG pixels", () => {
  it("reads back exactly the encoded modules, at any scale and quiet zone", () => {
    for (const code of ["7KQM-2HXD", "ABCD-EFGH", "Z9Z9-2345"]) {
      const matrix = ticketQrMatrix(code)!;
      for (const [scale, quiet] of [
        [12, 4],
        [3, 2],
        [1, 4],
      ]) {
        expect(qrModulesFromPng(encodePng(matrix, scale, quiet))).toEqual(matrix);
      }
    }
  });

  it("another code's QR doesn't match", () => {
    const png = encodePng(ticketQrMatrix("7KQM-2HXD")!, 12, 4);
    expect(qrModulesFromPng(png)).not.toEqual(ticketQrMatrix("7KQM-2HXE"));
  });

  it("refuses what isn't a PNG", () => {
    expect(() => qrModulesFromPng(Buffer.from("not a png"))).toThrow(/Not a PNG/);
  });
});

describe("journey harness: Stripe form decoding", () => {
  it("nests brackets and turns numbered keys into arrays", () => {
    const body =
      "mode=payment&line_items[0][price_data][unit_amount]=3000&line_items[0][quantity]=2" +
      "&line_items[1][price_data][unit_amount]=230&payment_intent_data[transfer_data][destination]=acct_1&metadata[orderId]=ord_1";
    expect(decodeStripeForm(body)).toEqual({
      mode: "payment",
      line_items: [{ price_data: { unit_amount: "3000" }, quantity: "2" }, { price_data: { unit_amount: "230" } }],
      payment_intent_data: { transfer_data: { destination: "acct_1" } },
      metadata: { orderId: "ord_1" },
    });
  });
});

describe("journey harness: fake Stripe through the real SDK", () => {
  const key = "sk_test_harness_self_test";
  const fake = new FakeStripe(key, "whsec_self_test");
  beforeAll(() => fake.start());
  afterAll(() => fake.stop());

  it("only ever makes a client for a sk_test_ key (D9)", () => {
    expect(() => createFakeStripeClient("sk_live_123", fake.port)).toThrow(/sk_test_/);
    expect(() => createFakeStripeClient("rk_live_123", fake.port)).toThrow(/sk_test_/);
  });

  it("replays an idempotent request, refuses the key with other parameters, and refuses a wrong API key", async () => {
    const stripe = createFakeStripeClient(key, fake.port);
    const account = await stripe.accounts.create({ country: "AU" });
    fake.activateAccount(account.id);
    const params = {
      mode: "payment" as const,
      client_reference_id: "ord_self",
      line_items: [{ price_data: { currency: "aud", product_data: { name: "GA" }, unit_amount: 3000 }, quantity: 1 }],
      payment_intent_data: { application_fee_amount: 230, transfer_data: { destination: account.id } },
      success_url: "http://127.0.0.1/ok",
    };
    const first = await stripe.checkout.sessions.create(params, { idempotencyKey: "k1" });
    const again = await stripe.checkout.sessions.create(params, { idempotencyKey: "k1" });
    expect(again.id).toBe(first.id);
    expect(fake.sessionsCreated).toBe(1);
    await expect(stripe.checkout.sessions.create({ ...params, client_reference_id: "ord_other" }, { idempotencyKey: "k1" })).rejects.toMatchObject({
      type: "StripeIdempotencyError",
    });
    const wrong = createFakeStripeClient("sk_test_wrong", fake.port);
    await expect(wrong.accounts.retrieve(account.id)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("makes embedded sessions as Stripe does: a client secret and no URL, return_url only", async () => {
    const stripe = createFakeStripeClient(key, fake.port);
    const account = await stripe.accounts.create({ country: "AU" });
    fake.activateAccount(account.id);
    const params = {
      mode: "payment" as const,
      client_reference_id: "ord_embedded",
      line_items: [{ price_data: { currency: "aud", product_data: { name: "GA" }, unit_amount: 3000 }, quantity: 1 }],
      payment_intent_data: { application_fee_amount: 230, transfer_data: { destination: account.id } },
      ui_mode: "embedded_page" as const,
      return_url: "http://127.0.0.1/done",
    };
    const session = await stripe.checkout.sessions.create(params);
    expect(session.url).toBeNull();
    expect(session.client_secret).toMatch(new RegExp(`^${session.id}_secret_`));
    expect((await stripe.checkout.sessions.retrieve(session.id)).client_secret).toBe(session.client_secret);
    await expect(stripe.checkout.sessions.create({ ...params, success_url: "http://127.0.0.1/ok" })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(stripe.checkout.sessions.create({ ...params, return_url: undefined })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a session paying out to an account that can't take charges", async () => {
    const stripe = createFakeStripeClient(key, fake.port);
    const account = await stripe.accounts.create({ country: "AU" });
    await expect(
      stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price_data: { currency: "aud", product_data: { name: "GA" }, unit_amount: 3000 }, quantity: 1 }],
        payment_intent_data: { transfer_data: { destination: account.id } },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("signs webhook events the SDK verifies with the secret, and only with it", () => {
    const { payload, signature } = fake.sign(fake.event("charge.refunded", { id: "ch_1" }));
    expect(createFakeStripeClient(key, fake.port).webhooks.constructEvent(payload, signature, "whsec_self_test").type).toBe("charge.refunded");
    expect(() => createFakeStripeClient(key, fake.port).webhooks.constructEvent(payload, signature, "whsec_other")).toThrow();
  });
});

describe("journey harness: SMTP sink with the app's real sender", () => {
  const sink = new SmtpSink("sender@sheltuh.test", "s3cret");
  beforeAll(() => sink.start());
  afterAll(() => sink.stop());

  const sender = (pass: string) =>
    createSmtpSender({
      NODE_ENV: "test",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(sink.port),
      SMTP_USER: "sender@sheltuh.test",
      SMTP_PASS: pass,
      EMAIL_FROM: "Sheltüh <tickets@sheltuh.test>",
    })!;

  it("captures an authenticated message whose parts, inline image and non-ASCII subject parse back exactly", async () => {
    const png = encodePng(ticketQrMatrix("7KQM-2HXD")!, 12, 4);
    await sender("s3cret")({
      to: "buyer@example.com",
      subject: "Your tickets for Café Nights",
      text: "Code 7KQM-2HXD",
      html: '<p>Code 7KQM-2HXD</p><img src="cid:qr-1@sheltuh.test">',
      inlineImages: [{ cid: "qr-1@sheltuh.test", contentType: "image/png", content: png }],
    });
    const mail = await sink.waitFor((m) => m.rcptTo.includes("buyer@example.com"));
    expect(mail.authUser).toBe("sender@sheltuh.test");
    const parsed = parseMail(mail.raw);
    expect(parsed.subject).toBe("Your tickets for Café Nights");
    expect(parsed.parts.find((p) => p.contentType === "text/plain")!.body.toString("utf8")).toContain("7KQM-2HXD");
    const image = parsed.parts.find((p) => p.contentType === "image/png")!;
    expect(image.contentId).toBe("qr-1@sheltuh.test");
    expect(image.body.equals(png)).toBe(true);
  });

  it("refuses wrong credentials, and every message while it simulates an outage", async () => {
    const before = sink.messages.length;
    await expect(sender("wrong")({ to: "x@example.com", subject: "s", text: "t", html: "<p>t</p>" })).rejects.toThrow();
    sink.rejectData = true;
    try {
      await expect(sender("s3cret")({ to: "x@example.com", subject: "s", text: "t", html: "<p>t</p>" })).rejects.toThrow();
    } finally {
      sink.rejectData = false;
    }
    expect(sink.messages).toHaveLength(before);
  });
});
