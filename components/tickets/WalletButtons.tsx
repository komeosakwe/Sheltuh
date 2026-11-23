import { walletPassUrl } from "@/lib/api/orders";
import type { WalletAvailability } from "@/lib/api/types";
import { WALLET_BADGES } from "@/lib/wallet-badges";

interface WalletButtonsProps {
  /** The order id from the ticket page's own URL (`session_id`): the same capability the page reads the order with. */
  sessionId: string;
  /** CustomerOrder.wallet: which wallets the server makes passes for. Unset or both false: nothing renders. */
  wallet: WalletAvailability | undefined;
  /** The ticket's number on the page and in the email (1-based, the API's order), and how many the order has. */
  ticketNumber: number;
  ticketCount: number;
  className?: string;
}

/**
 * "Add to Apple Wallet" and "Add to Google Wallet" for one ticket
 * (docs/architecture.md, "Wallet passes"), each shown only when the server
 * says that wallet is on (CustomerOrder.wallet), on every device: a wallet
 * the device doesn't have just won't open. Plain links, not fetches: Google's
 * route redirects to Google's save page, and Apple's serves the .pkpass,
 * which Safari offers to add to Wallet.
 *
 * Each is the vendor's official badge (lib/wallet-badges.ts; Google's with rounded-rectangle corners):
 * Apple's then Google's, both 160px wide at their own proportions (Google's
 * 44px tall, Apple's about 51), centred on each other in a row and lined up
 * when they wrap, 8px apart (Apple asks for 0.1x the height around its
 * badge: about 5px). No hover effects, no dimming, and the same files in both
 * themes. They always say "Add": the site can't tell whether a pass was
 * saved, so Google's "View in Google Wallet" isn't used. Each image's alt is
 * the vendor's wording. With several tickets, each link's name says which
 * ticket ("Add to Apple Wallet: ticket 2 of 3"), starting with those words.
 */
export default function WalletButtons({ sessionId, wallet, ticketNumber, ticketCount, className = "" }: WalletButtonsProps) {
  const providers = (["apple", "google"] as const).filter((provider) => wallet?.[provider] === true);
  if (providers.length === 0) return null;
  const which = ticketCount > 1 ? `: ticket ${ticketNumber} of ${ticketCount}` : "";
  return (
    <div className={`flex flex-wrap items-center gap-2 print:hidden ${className}`.trim()}>
      {providers.map((provider) => {
        const badge = WALLET_BADGES[provider];
        return (
          <a
            key={provider}
            href={walletPassUrl(sessionId, provider, ticketNumber)}
            aria-label={`${badge.label}${which}`}
            rel="nofollow"
            className={`inline-flex ${provider === "apple" ? "rounded-control" : "rounded-full"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the vendor's SVG, unmodified at its own proportions (its artboard's width and height; shown 160px wide, height to match); next/image would need SVG optimisation off and fixed dimensions */}
            <img src={badge.src} width={badge.width} height={badge.height} alt={badge.label} draggable={false} className="block h-auto w-40" />
          </a>
        );
      })}
    </div>
  );
}
