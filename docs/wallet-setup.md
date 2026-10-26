# Wallet passes: owner setup

"Add to Google Wallet" and "Add to Apple Wallet" put a ticket in the buyer's
phone wallet, with the same QR the ticket page and email show. Each wallet
**switches itself on** once its variables are in Vercel and the site is
redeployed: no code change, no flag. Until then it's off: the ticket page
shows no button for it, and its route answers 404. How it works:
`docs/architecture.md`, "Wallet passes".

Rules for every value below:

- They're **server-only**. Never prefix one with `NEXT_PUBLIC_`.
- In Vercel, add them to **Production only** (Project → Settings →
  Environment Variables, untick Preview and Development), and tick
  **Sensitive**.
- Never commit them, paste them in chat or email, or keep the key files in
  a synced folder. Delete the local copies once they're in Vercel.
- If a variable is wrong, the wallet stays off and the function logs (Vercel →
  the deployment → Logs) say which variable, never its value, e.g.
  `Google Wallet passes are off: GOOGLE_WALLET_PRIVATE_KEY isn't an RSA private key in PEM (2048 bits or more).`

## Google Wallet

Use the Google Workspace account (`business@sheltuh.com.au` or similar), not
a personal one.

1. **Business profile.** Open the Google Pay & Wallet Console,
   <https://pay.google.com/business/console>, and fill in the business
   profile (business name "Sheltuh", the ABN's address, a contact). Google
   won't grant publishing access without it.
2. **Issuer ID.** In the console, open **Google Wallet API** and follow
   "Get started" if asked. Copy the **Issuer ID** (a long number, e.g.
   `3388000000012345678`). That's `GOOGLE_WALLET_ISSUER_ID`.
3. **Cloud project.** Open <https://console.cloud.google.com/>, then the
   project picker → **New project**, named **`sheltuh-wallet`**, under the
   sheltuh.com.au organisation.
4. **Enable the API.** In that project: APIs & Services → Library → search
   **Google Wallet API** → **Enable**.
5. **Service account, with no roles.** IAM & Admin → Service Accounts →
   **Create service account**: name `sheltuh-wallet-passes`. On "Grant this
   service account access to project" and "Grant users access", add
   **nothing**: just **Done**. It needs no Cloud roles; its access comes
   from the Wallet console (next step). Copy its email,
   `sheltuh-wallet-passes@sheltuh-wallet.iam.gserviceaccount.com`. That's
   `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`.
6. **Invite it in the Wallet console.** Back in the Pay & Wallet Console →
   **Users** → **Invite a user**: the service account's email, access level
   **Developer** → Invite. (No email is involved: service accounts don't
   need to accept.)
7. **JSON key.** Cloud console → the service account → **Keys** → **Add
   key** → **Create new key** → **JSON** → Create. A `.json` file downloads.
   If Google refuses with "Service account key creation is disabled", the
   organisation policy `iam.disableServiceAccountKeyCreation` is on (the
   default for newer Workspace organisations): an Organisation Policy
   Administrator turns it off **for the `sheltuh-wallet` project only**
   (IAM & Admin → Organisation Policies → that policy → Manage policy →
   Override parent's policy → Not enforced), then try again.
8. **Vercel (Production only).** Open the JSON file in a text editor:
   - `GOOGLE_WALLET_ISSUER_ID`: the Issuer ID from step 2.
   - `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`: the file's `client_email`.
   - `GOOGLE_WALLET_PRIVATE_KEY`: the file's `private_key` value, copied
     exactly: from `-----BEGIN PRIVATE KEY-----` to
     `-----END PRIVATE KEY-----\n`, with its `\n` escapes as they are (with
     or without the surrounding quotes; both work).

   Then delete the JSON file from your computer (and your Downloads and
   Recycle Bin). If it may have leaked, delete the key in the Cloud console
   (Keys → the key → Delete) and make a new one.
9. **Redeploy** (Vercel → Deployments → the latest Production deployment →
   ⋯ → Redeploy). Variables only reach new deployments.
10. **Test a pass.** Until Google grants publishing access, only accounts
    added in the Pay & Wallet Console (Users) can save passes, and they show
    as test passes. Add your own Google account there, then on an Android
    phone signed in with it: open a ticket's page (`/checkout/success?…`
    from the ticket email, a free test ticket is fine) → **Add to Google
    Wallet** → Save. Check the event name, date and time (Melbourne time),
    venue, ticket type and number, and that the QR scans at the door
    (`/dashboard/{event}/check-in`, "Admitted"). The logo and banner are
    fetched by Google from `https://<your site>/wallet/google-logo.png` and
    `/wallet/google-hero.png`, so they only show on the real https site.
11. **Request publishing access.** Pay & Wallet Console → Google Wallet API →
    **Request publishing access**. Google reviews the business profile and
    the passes (the event ticket classes the site has created). Until it's
    approved, other people's "Add to Google Wallet" fails at Google's end.

## Apple Wallet

Needs the **Apple Developer Program** (an annual fee). Until it's done, leave
every `APPLE_WALLET_*` variable unset: Apple's button stays hidden. Steps 3–6
use OpenSSL, which macOS, Linux and Git Bash on Windows already have.

1. **Enrol** at <https://developer.apple.com/programs/enroll/>. As a sole
   trader you enrol as an individual (Apple shows your own name as the
   seller); a company needs a D-U-N-S number. Then Account → Membership
   details → copy the **Team ID** (10 letters and digits). That's
   `APPLE_WALLET_TEAM_ID`.
2. **Pass Type ID.** Certificates, Identifiers & Profiles → Identifiers → **+**
   → **Pass Type IDs** → Continue. Description `Sheltüh tickets`,
   identifier **`pass.au.com.sheltuh.tickets`** → Register. That's
   `APPLE_WALLET_PASS_TYPE_ID`.
3. **CSR and private key**, in an empty folder outside the repo:

   ```sh
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout pass-key.pem -out pass.csr \
     -subj "/emailAddress=info@sheltuh.com.au/CN=Sheltuh Wallet/C=AU"
   ```

   `pass-key.pem` is the private key (unencrypted, so no passphrase is
   needed). Keep it private.
4. **Certificate.** Identifiers → `pass.au.com.sheltuh.tickets` → **Create
   Certificate** → upload `pass.csr` → Continue → **Download** (`pass.cer`).
   Convert it to PEM:

   ```sh
   openssl x509 -inform DER -in pass.cer -out pass-cert.pem
   ```

   (Made it with Keychain Access instead? Export the certificate and its key
   from Keychain as `Certificates.p12`, then
   `openssl pkcs12 -legacy -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem`
   and `openssl pkcs12 -legacy -in Certificates.p12 -nocerts -out pass-key.pem`;
   the second asks for a PEM passphrase, which goes in
   `APPLE_WALLET_KEY_PASSPHRASE`.)
5. **WWDR G4.** Download Apple's "Worldwide Developer Relations - G4"
   intermediate from <https://www.apple.com/certificateauthority/>
   (`AppleWWDRCAG4.cer`), then:

   ```sh
   openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr-g4.pem
   openssl verify -partial_chain -CAfile wwdr-g4.pem pass-cert.pem   # must say: pass-cert.pem: OK
   ```

6. **Base64**, one line each (Linux and Git Bash: `base64 -w0`; macOS:
   `base64 -i`):

   ```sh
   base64 -w0 pass-cert.pem > cert.b64
   base64 -w0 pass-key.pem  > key.b64
   base64 -w0 wwdr-g4.pem   > wwdr.b64
   ```

7. **Vercel (Production only):** `APPLE_WALLET_PASS_TYPE_ID`,
   `APPLE_WALLET_TEAM_ID`, `APPLE_WALLET_CERT_PEM` (contents of `cert.b64`),
   `APPLE_WALLET_KEY_PEM` (`key.b64`), `APPLE_WALLET_WWDR_PEM` (`wwdr.b64`),
   and `APPLE_WALLET_KEY_PASSPHRASE` only if the key is encrypted. Then
   delete the folder (keep `pass-key.pem` and `pass.cer` only in a password
   manager, if at all: a new certificate can always be made).
8. **Redeploy.**
9. **Test on an iPhone**, in Safari: a ticket's page → **Add to Apple
   Wallet** → Wallet's "Add" sheet → Add. Check the front (event, date,
   time, venue, ticket, seat), the back (when, where, backup code, order
   reference), and that the QR scans at the door. "Safari cannot download
   this file" means Wallet refused the pass: check the logs for "Apple
   Wallet passes are off", and that the certificate is for this Pass Type
   ID and team.
10. **Renew** the certificate before it expires (Apple shows the date; about
    a year). When it expires, Apple passes switch off by themselves (logged)
    until the new one is in Vercel; passes already in wallets keep working.
    If the key may have leaked, revoke the certificate in the developer
    portal and make a new one.

## Official badges

The buttons are text-only stand-ins in the vendors' colours and exact
wording ("Add to Apple Wallet", "Add to Google Wallet",
`components/tickets/WalletButtons.tsx`). Both vendors ask for their own
badge artwork. Before launch, as for the sign-in logos
(`docs/auth-logos.md`):

1. Apple: the "Add to Apple Wallet" badge from the Add to Apple Wallet
   guidelines (<https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/>),
   English (Australia), black, SVG.
2. Google: the "Add to Google Wallet" button from Google Wallet's brand
   guidelines (<https://developers.google.com/wallet/tickets/events/resources/brand-guidelines>),
   the primary (black) one, SVG.
3. Save them unmodified in `public/wallet/badges/`, swap them into
   `WalletButtons.tsx` (keeping the accessible names and the 44px height),
   and note the source URL and download date in the commit. Neither page
   could be read when this was built (unverified URLs).

## Images

`public/wallet/` holds the pass images, rendered from the brand vectors in
`public/brand/` by `node --import tsx scripts/render-wallet-images.ts`
(`sharp`, no fonts, nothing fetched): Apple's icon (the ü on Signal Orange,
29/58/87 px), logo (the wordmark in black, 30 pt tall) and strip (plain
Signal Orange behind the event name), and Google's logo (660 px, the ü on
orange, inside Google's circle crop) and hero banner (1032 × 336, the
wordmark on orange). The Apple images are also embedded in
`lib/server/wallet/images.ts`, generated by the same script; a test checks
the two match. Rerun the script only if a mark changes.
