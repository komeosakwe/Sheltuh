import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Page not found</h1>
      <p className="text-muted">
        We couldn&rsquo;t find that page. The event may have been removed, or the link might
        be out of date.
      </p>
      <Link
        href="/"
        className="rounded bg-accent px-4 py-2 font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
      >
        Back to all events
      </Link>
    </div>
  );
}
