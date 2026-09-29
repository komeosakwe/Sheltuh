import Link from "next/link";

export default function NotFoundMessage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 px-5 py-20 sm:px-8">
      <h1 className="display-lg">Page not found</h1>
      <p className="text-muted">
        We couldn&rsquo;t find that page. The event may have been removed, or the link might be
        out of date.
      </p>
      <Link
        href="/"
        className="btn btn-solid"
      >
        Back to all events
      </Link>
    </div>
  );
}
