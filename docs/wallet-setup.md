# Wallet passes: owner setup

"Add to Google Wallet" and "Add to Apple Wallet" put a ticket in the buyer's
phone wallet, with the same QR the ticket page and email show. Each wallet
**switches itself on** once its variables are in Vercel and the site is
redeployed: no code change, no flag. Until then it's off: the ticket page
shows no button for it, the ticket email no link, and its route answers 404. How it works:
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
    Wallet** → Save. Check the card against "What the passes look like"
    below: white, the venue and event names, one row of Date, Time and
    Ticket (the event's own time), and that the QR scans at the door
    (`/dashboard/{event}/check-in`, "Admitted"). **Save three kinds of
    ticket**: an order of one unseated ticket (one row), one ticket of an
    order of several (a "Ticket number" row under the first), and a seated
    ticket (a "Seat" row):
    the card's rows are set with Google's template override, which couldn't
    be tried from the build environment. If Save fails at Google's end for
    every ticket, or a row is missing or shows an empty label, that override
    is the first thing to look at (`CARD_TEMPLATE` in
    `lib/server/wallet/google.ts`). Use an event nobody has saved a pass for
    before: Google keeps the first class it was given for an event. The logo
    and banner are fetched by Google from
    `https://<your site>/wallet/google-logo-v2.png` and
    `/wallet/google-hero-v2.png` (or, for an event with a photo, the photo's
    own `/api/events/{id}/image?v=…`), so they only show on the real https
    site. Save one ticket for an event with a photo and one for an event
    without: the first should show the photo in the banner, the second the
    Sheltüh banner.
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
   → **Pass Type IDs** → Continue. Description `Sheltuh tickets` (Apple refuses
   the ü there: "Invalid description"; buyers never see it),
   identifier **`pass.au.com.sheltuh.tickets`** → Register. That's
   `APPLE_WALLET_PASS_TYPE_ID`.
3. **CSR and private key**, in an empty folder outside the repo:

   ```sh
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout pass-key.pem -out pass.csr \
     -subj "/emailAddress=info@sheltuh.com.au/CN=Sheltuh Wallet/C=AU"
   ```

   In **Git Bash on Windows**, put `MSYS_NO_PATHCONV=1 ` in front of
   `openssl`: otherwise Git Bash rewrites the `-subj "/…"` value as a Windows
   path and the command fails.

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
   Wallet** → Wallet's "Add" sheet → Add. Check the front against "What
   the passes look like" below (date, event, time, venue, ticket, and on a
   second row the ticket's number for an order of several and the seat for
   a seated ticket), the back (event, when,
   where, backup code, order reference), and that the QR scans at the
   door. "Safari cannot download
   this file" means Wallet refused the pass: check the logs for "Apple
   Wallet passes are off", and that the certificate is for this Pass Type
   ID and team. The server also signs a test pass once before showing the
   button; if it can't (an EC certificate or key, say: use the RSA
   certificate from step 4 and the G4 intermediate, not G6), the logs name
   the variable and the button stays hidden.
10. **Renew** the certificate before it expires (Apple shows the date; about
    a year), and check the WWDR G4 certificate's own expiry too
    (`openssl x509 -enddate -noout -in wwdr-g4.pem`). When either expires,
    Apple passes switch off by themselves, and the logs say once which
    (`Apple Wallet passes are off: APPLE_WALLET_CERT_PEM has expired.`, or
    `APPLE_WALLET_WWDR_PEM`), until a new one is in Vercel and the site is
    redeployed; passes already in wallets keep working.
    If the key may have leaked, revoke the certificate in the developer
    portal and make a new one.

## What the passes look like

The designer's frames of 20 Nov 2026 ("Wallet passes": Apple Wallet pass
preview, Google Wallet pass preview), built on 21 Nov 2026. Where the
written handoff and the frames differ, the frames win: the handoff says grey
labels, the frames draw them black, so they're black.

**Passes already in a wallet keep the look they were saved with.** A pass is
static (no updates are sent: `docs/architecture.md`, "Wallet passes"). An
Apple pass carries its own colours, fields and images. A Google pass's
logo, banner and rows belong to its event's class, which Google keeps from
the first time anyone saved a ticket for that event: **a ticket saved later
for that event still gets the old logo, banner and rows** (on the new white
background, which each ticket also carries itself). Only events whose first
pass is saved after this change get the whole new Google card. Changing an
existing class needs Google's REST API (not built).

What the code sets, and what each wallet draws itself:

| Part | Apple (`pass.json`, `lib/server/wallet/apple.ts`) | Google (class and object, `lib/server/wallet/google.ts`) |
| --- | --- | --- |
| Background | `backgroundColor` white | `hexBackgroundColor` `#ffffff` |
| Text colour | `foregroundColor` black, `labelColor` black | **Google's choice** from the background (dark text on white); its label colour can't be set |
| Typeface, sizes, label case | **Apple's** (San Francisco). The frames are drawn in Inter | **Google's** (Google Sans). The labels are written in sentence case, as the frame has them |
| Card shape | **Apple's**: the event ticket's notch at the top, its corners, its shadow | **Google's**: its corners and outline |
| Logo | `logo.png`: the wordmark in Signal Orange, 88 pt wide | `logo`: the wordmark's Ü in Signal Orange on black, in Google's circle; "Sheltüh" beside it is `issuerName` |
| Header | DATE at the top right ("Sat 14 Nov") | **Google's** header: the venue's name over the event's name |
| Image band | `strip.png`, 375 × 98 pt, under the header: the event's photo, cropped here around its focus point; the Sheltüh band without one. **Apple fixes an event ticket's strip at 98 pt**; the frame draws it 123 tall | `heroImage`, 1032 × 336 recommended, which Google puts at the bottom of the card: the event's photo (on the ticket's object), which **Google crops** to its banner's shape; the Sheltüh band (on the class) without one |
| Fields | No primary field (nothing over the strip). EVENT and TIME, then VENUE and TICKET, the last of each row at the right edge. A second row (`row: 1`) for what the frame doesn't show, so the frame's rows are never squeezed: TICKET NUMBER ("2 of 3") when the order has more than one ticket, SEAT, and ENTRY CODE for a code with no QR | One row: Date, Time, Ticket (`classTemplateInfo.cardTemplateOverride`, each item one of the object's text modules). A second row of one item: Seat for a seated ticket, otherwise Ticket number ("2 of 3") when the order has more than one. An order of one, unseated, has the frame's one row |
| Values | "Sat 14 Nov" (no year), "5–9 pm" (the ticket email's short time, in the event's zone, no zone name), the ticket type's name as entered. The wallet cuts a value that doesn't fit | The same; a row value over 40 characters is cut in the code (the whole name is in the details) |
| QR | **Apple's**: it draws the code, always on its own white tile, from the payload. Its size, tile and place can't be set. The backup code under it is `altText` | **Google's**, the same; the backup code is `alternateText` |
| Back / details | Event, when (with the year and the zone), where (venue and street address), backup code, order reference, at the door, support's address | Google's details: the venue and address (its own map link), ticket type and number, when, order reference, a "Contact support" link, the site |

**The event's photo in the image band** (since 22 Nov 2026,
`lib/server/wallet/event-image.ts`). The frames show the event's image in
Apple's strip and Google's banner, and that's what an event with a photo
gets. An event without one, or whose photo can't be used, gets the Sheltüh
band ("Images" below); the pass is made either way, never refused for its
picture.

- **Apple**: the strip is made when the pass is: the stored photo is read
  from the database (never fetched over the web), cropped to 375 × 98 pt at
  1x, 2x and 3x around the photo's focus point (the middle without one), and
  put in the `.pkpass` as 256-colour PNGs with no metadata, in place of the
  stand-in's three files (the manifest and signature cover them). Up to 3
  seconds; longer, or a photo over 5 MB or that isn't the image it says it
  is, and the stand-in goes in instead. The last 16 strips are kept in
  memory, so adding several tickets crops the photo once.
- **Google**: Google fetches the banner itself, from the photo's public
  address on the site (`/api/events/{id}/image?v=…`, https only), and crops
  it to its own banner's shape, from the middle as far as we know (it
  doesn't know the focus point; unverified: check on a phone). The photo
  goes on each ticket's object, not the event's class: Google keeps the
  first class it was given for an event, so a ticket saved now still shows
  the photo for an event whose class Google already holds with the Sheltüh
  banner. Its description is the event's title (cut at 40 characters). At
  near-maximum field lengths the save link would pass 5 KB with the photo:
  then it's left out and the Sheltüh banner shows.
- **Saved passes don't change.** A photo replaced later (only an admin can,
  on a published event) reaches passes added after that; Google keeps its
  own copy of what it fetched.

**Not built: the refund policy line.** The frames' notes list the refund
policy among the back-of-pass and details lines. The passes are built
without the event's policy or the order's price, so it's left out rather
than guessed.

## Official badges

Both buttons are the vendors' official artwork, downloaded by the owner on
20 Nov 2026, in `public/wallet/badges/` (`lib/wallet-badges.ts`), and used
on the ticket page (`components/tickets/WalletButtons.tsx`) and in the
ticket email. Apple's is committed byte for byte. Google's has one change,
the owner's call on 20 Nov 2026: its two outline rectangles' corner radius
goes from `rx="27"` (a pill) to `rx="13"`, so it's a rounded rectangle like
Apple's (Apple's corner is about 24% of its height; 13 is 24% of 54).
Nothing else in it changed. Google's guidelines ask for the button
unaltered, so Google could flag this when it reviews the Wallet
integration; if it does, put back the original (`rx="27"`, the SHA-256
below) and re-run `scripts/render-ticket-email-assets.ts`. Apart from
that, as with the sign-in logos (`docs/auth-logos.md`), never redraw,
recolour, crop or restyle them, and never ship a made-up version. To
replace one, download it again yourself.

| File | Source | What it is | SHA-256 |
| --- | --- | --- | --- |
| `US-UK_Add_to_Apple_Wallet_RGB_101421.svg` | Apple's "Add to Apple Wallet" badge files (the `US_UK/RGB` folder), from the Add to Apple Wallet guidelines (<https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/>). The owner accepted Apple's Wallet Marketing Artwork License Agreement to download them. | Black, two lines ("Add to / Apple Wallet"), 110.739 × 35.016 | `052b3b446860fd2f9b49c2f0336038947623a5a9433ee3583585b8552ff6f506` |
| `enAU_add_to_google_wallet_add-wallet-badge.svg` | Google Wallet's brand guidelines badge packs ("Add to Google Wallet", all locales) | Australian English, two lines ("Add to / Google Wallet"), 199 × 55, corners rounded as above | Committed: `18d7d9603d0953e4887cb62f292a6378304da0e21c6668306b9d653e2e5a717b`. Google's original: `6e5b4dd71644a1df382ef0255591526859488e17e398eeae36d2f3f25b7e8efb` |

Not committed, from the same downloads:
- Google's one-line `enAU_add_to_google_wallet_wallet-button.svg`
  (SHA-256 `ab93b845dd1807ae8c6056d1b3354b871d7c90e454028c7ae7df2b995ad750ee`).
- Google's "View in Google Wallet" files: `en-AU_view_in_wallet_wallet-button.svg`
  (`18f8a5f68fe59b76f11e867e06979ee04aac9c9547ce22f143be6ed129fed4c6`) and
  `en-AU_view_in_wallet_add-wallet-badge.svg`
  (`7e2362d65b0e5ea932d56cbed7f1dfc832f51d82706b648705f4e0bb8575daf9`).
  "View in" is only right once a pass is known to be saved, and the site
  can't know that: Google's route redirects to Google's save page, and
  Apple's serves the `.pkpass`, with no callback to us. So both always say
  "Add".

All of them are vector SVG with no scripts and no external references.
Google's are plain paths with an internal gradient. Apple's is an
Illustrator export whose only `<image>`s are inline base64 PNGs (the cards'
shadows). The text in each is outlined. A test checks the committed files'
SHA-256 (`tests/WalletButtons.test.tsx`).

**Which variant, and how they're shown:**
- **Two-line badges for both.** Apple's badge only comes in two lines.
  Google's matching two-line badge pairs with it, and fits half a
  phone-width row. Google's one-line button, which the owner's design
  images show, would have type about 40% bigger beside Apple's at the same
  height, and at half a 375px row it would be 29px tall.
- **Same width, own proportions** (the owner's call, 22 Nov 2026). Shown
  at the same size: each artwork at its own proportions at one shared
  width, so Apple's (the narrower shape) is a little taller. Stacked, their
  edges line up; in a row they're centred on each other. On the site, 160px
  wide (Google 44px tall, its touch target; Apple about 51), 8px apart. In
  the email, 174px wide (Google 174 × 48, the design images' 47.5px height;
  Apple 174 × 55), 12px apart; on a phone, 166 wide (Google 46 tall, Apple
  52), 8px apart, each centred in half the row.
  Both at one width *and* one height isn't possible without changing the
  artwork: the two have different proportions (Apple 3.16:1, Google
  3.62:1), and each draws its own outline all the way round, so an equal
  box filled to match (badge colour, border and corners) leaves the
  smaller one's outline showing inside it as a second edge. Never stretch,
  crop or cover the outline to get there.
- **Clear space.** Apple asks for 0.1 × the badge's height around it (5.1px
  on the site, 5.5 in the email, 5.2 on a phone), which the gaps cover.
  Google's own minimum-size and clear-space numbers weren't readable from
  the build environment. Check them on Google's guidelines page.
- **No changes.** No colour behind them (their corners are transparent), no
  hover or pressed effects, no dimming.
- **Light theme.** The black badges on white, as both vendors ask.
- **Dark theme.** The site's Dark page is `#000000`, and the wallet rows sit
  on it. Apple asks for its outline badge on very dark backgrounds. That
  version isn't in the files supplied: the `US_UK` folder has the black
  badge only. For now Dark shows the black badge, separated from the page
  only by its own grey rim. **Get Apple's outline badge** and use it on
  Dark. Google's badge has its own grey outline for dark pages.
- **Apple's other rules.** Next to the badges, "To add your ticket(s) to
  Apple Wallet, open this page / email on your iPhone or Mac." appears on
  the ticket page (`CheckoutConfirmation.tsx`), and once under the last
  ticket's badges in the email (and its plain-text part). This is Apple's
  instruction for people who open them on another device. The email has no
  legal footer (owner decision), so Apple's credit line, plus Google's, is
  on the Terms of Use page (`app/terms/page.tsx`, "Trademarks"), which the
  email's footer links to: "Apple, Apple Wallet, iPhone and Mac are
  trademarks of Apple Inc., registered in the U.S. and other countries.
  Google Wallet is a trademark of Google LLC." It lists only the marks
  used; check it against Apple's Trademark List.
- **The email's PNGs.** Gmail and Outlook don't show SVG, so the email uses
  `public/email/ticket/{apple,google}-wallet-badge@{2x,3x}.png`: the same
  SVGs rendered directly (no resampling) at 96 / 144px tall by
  `node --import tsx scripts/render-ticket-email-assets.ts`, transparent
  outside the badge. Their alt text is the vendors' wording.

## Images

`public/wallet/` holds the pass images, rendered from the brand vectors in
`public/brand/` by `node --import tsx scripts/render-wallet-images.ts`
(`sharp`, no fonts, nothing fetched). Never edit them by hand: change the
script and run it.

| File | What it is |
| --- | --- |
| `apple-icon.png`, `@2x`, `@3x` | 29 / 58 / 87 px: the ü in black on Signal Orange (the app icon's look), for notifications and the lock screen. Not in the designer's frames; unchanged |
| `apple-logo.png`, `@2x`, `@3x` | The wordmark in Signal Orange on transparent, 88 pt wide (20 pt tall), the frame's size. Apple allows up to 160 × 50 pt |
| `apple-strip.png`, `@2x`, `@3x` | 375 × 98 pt: the wordmark's Ü in Signal Orange on black. The stand-in for an event without a usable photo (above) |
| `google-logo-v2.png` | 660 × 660: the wordmark's Ü in Signal Orange on black, inside Google's circle crop (the frame's round logo) |
| `google-hero-v2.png` | 1032 × 336: the wordmark in Signal Orange on black, the same stand-in (the class's banner, shown when the ticket's object has no photo) |
| `google-logo.png`, `google-hero.png` | The look before 21 Nov 2026 (black on Signal Orange). **Keep them**: Google classes made before then still fetch these two URLs. No new pass uses them |

The Ü is the wordmark's own (the script takes that letter's outlines from
`sheltuh-wordmark.svg`), as the frame's logo has it, not the secondary ü of
`sheltuh-u.svg`, which stays on the icon.

**New Google artwork gets a new file name** (`GOOGLE_LOGO_PATH` /
`GOOGLE_HERO_PATH` in `lib/server/wallet/google.ts`), never a new image
under an old name: older classes still point at the old one, and Google
keeps a copy of what it fetches (for how long couldn't be checked from the
build environment), so a changed file under the same name might not show.

The Apple images are also embedded in `lib/server/wallet/images.ts`,
generated by the same script; a test checks the two match, and the sizes.
Rerun the script only if a mark or a size changes.
