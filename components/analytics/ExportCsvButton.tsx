"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { ApiError } from "@/lib/api/client";

/** Saves a Blob as a file through a temporary link. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before letting go of the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportErrorMessage(err: unknown): string {
  if (err instanceof SessionExpiredError || (err instanceof ApiError && err.status === 401)) {
    return "Your session has ended. Sign in again to export.";
  }
  if (err instanceof ApiError && err.status === 400) return err.message;
  return "Couldn't prepare the file. Try again.";
}

/**
 * "Export CSV": the API builds the file (no buyer details, formula-safe
 * cells); this downloads it. Busy as "Preparing…", errors shown beside it.
 */
export default function ExportCsvButton({
  rangeLabel,
  filename,
  fetchCsv,
}: {
  /** "Last 30 days", read after the button's name by screen readers. */
  rangeLabel: string;
  filename: string;
  fetchCsv: () => Promise<Blob>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      saveBlob(await fetchCsv(), filename);
    } catch (err) {
      setError(exportErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" className="min-h-11" busy={busy} onClick={() => void run()}>
        {busy ? "Preparing…" : "Export CSV"} <span className="sr-only">for {rangeLabel}</span>
      </Button>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}
