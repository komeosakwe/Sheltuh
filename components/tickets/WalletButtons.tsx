import { walletPassUrl, type WalletProvider } from "@/lib/api/orders";
import type { WalletAvailability } from "@/lib/api/types";

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

const LABELS: Record<WalletProvider, string> = {
  apple: "Add to Apple Wallet",
  google: "Add to Google Wallet",
};

/**
 * "Add to Apple Wallet" and "Add to Google Wallet" for one ticket
 * (docs/architecture.md, "Wallet passes"), each shown only when the server
 * says that wallet is on (CustomerOrder.wallet), on every device: a wallet
 * the device doesn't have just won't open. Plain links, not fetches: Google's
 * route redirects to Google's save page, and Apple's serves the .pkpass,
 * which Safari offers to add to Wallet.
 *
 * Both vendors' buttons are black with white text; these are text-only
 * stand-ins with the vendors' exact wording until the official badge
 * artwork is added (docs/wallet-setup.md, "Official badges"). 44px tall; a
 * light hairline keeps them distinct on a dark page and in forced colours.
 * With several tickets, each button's name says which ticket ("Add to Apple
 * Wallet: ticket 2 of 3"), starting with its visible words.
 */
export default function WalletButtons({ sessionId, wallet, ticketNumber, ticketCount, className = "" }: WalletButtonsProps) {
  const providers = (["apple", "google"] as const).filter((provider) => wallet?.[provider] === true);
  if (providers.length === 0) return null;
  const which = ticketCount > 1 ? `: ticket ${ticketNumber} of ${ticketCount}` : "";
  return (
    <div className={`flex flex-wrap items-center gap-2 print:hidden ${className}`.trim()}>
      {providers.map((provider) => (
        <a
          key={provider}
          href={walletPassUrl(sessionId, provider, ticketNumber)}
          aria-label={`${LABELS[provider]}${which}`}
          rel="nofollow"
          className="inline-flex min-h-11 items-center justify-center rounded-control border border-[#a6a6a6] bg-black px-4 text-sm leading-5 font-semibold whitespace-nowrap text-white hover:bg-[#1f1f1f]"
        >
          {LABELS[provider]}
        </a>
      ))}
    </div>
  );
}
