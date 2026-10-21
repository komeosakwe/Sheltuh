import { MAX_FAVOURITES } from "@/lib/api/types";

/** What a heart needs to know about its event. */
export interface SaveTarget {
  id: string;
  title: string;
  slug: string;
}

/**
 * `idle`: no list to show (signed out in live mode). `loading`: the ids are on
 * their way. `ready`: hearts reflect the list. `error`: the ids couldn't load.
 */
export type FavouritesStatus = "idle" | "loading" | "ready" | "error";

export interface FavouritesSnapshot {
  status: FavouritesStatus;
  /** Effective ids (confirmed, with pending changes applied), newest save first. */
  ids: readonly string[];
  saved: ReadonlySet<string>;
  count: number;
}

/**
 * Sends one change. `nextIds` is the confirmed list as it will be once this
 * change lands (demo mode stores it; live mode ignores it).
 */
export interface FavouritesBackend {
  put(id: string, nextIds: readonly string[]): Promise<void>;
  del(id: string, nextIds: readonly string[]): Promise<void>;
}

export type FavouritesSettled =
  | { kind: "saved" | "removed"; event: SaveTarget }
  | { kind: "failed"; event: SaveTarget; intent: boolean; error: unknown };

export type RequestResult = "sent" | "cap" | "not-ready";

/**
 * The saved list behind every heart: optimistic, with requests per event
 * serialised and the latest intent winning. A tap while a request is in
 * flight only records what the person now wants; it's sent when the request
 * settles (or dropped if it matches). A failure rolls back to the last state
 * the server confirmed and reports it, unless the person has since changed
 * their mind back to that state anyway.
 */
export class FavouritesStore {
  private confirmed: string[] = [];
  private readonly desired = new Map<string, boolean>();
  private readonly inflight = new Set<string>();
  private status: FavouritesStatus = "idle";
  private snapshot: FavouritesSnapshot = { status: "idle", ids: [], saved: new Set(), count: 0 };
  private readonly listeners = new Set<() => void>();
  private loadAttempt = 0;
  private active = true;

  private readonly backend: FavouritesBackend;
  private onSettled: (settled: FavouritesSettled) => void;

  constructor(backend: FavouritesBackend, onSettled: (settled: FavouritesSettled) => void = () => {}) {
    this.backend = backend;
    this.onSettled = onSettled;
  }

  /** Who hears about each settled request (the provider's latest handler). */
  setOnSettled(onSettled: (settled: FavouritesSettled) => void) {
    this.onSettled = onSettled;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FavouritesSnapshot => this.snapshot;

  /**
   * While inactive (its provider unmounted, or the account changed) results
   * still update the list but aren't reported, and loads are dropped.
   */
  setActive(active: boolean) {
    this.active = active;
  }

  /** Loads the confirmed list. A later call supersedes an earlier one still in flight. */
  async load(fetchIds: () => Promise<readonly string[]>): Promise<void> {
    const attempt = ++this.loadAttempt;
    this.status = "loading";
    this.emit();
    try {
      const ids = await fetchIds();
      if (attempt !== this.loadAttempt || !this.active) return;
      this.confirmed = [...new Set(ids)];
      this.status = "ready";
    } catch {
      if (attempt !== this.loadAttempt || !this.active) return;
      this.status = "error";
    }
    this.emit();
  }

  /** Sets the confirmed list directly (demo storage, another tab's change). */
  replace(ids: readonly string[]) {
    this.confirmed = [...new Set(ids)];
    this.status = "ready";
    this.emit();
  }

  isSaved(id: string): boolean {
    return this.snapshot.saved.has(id);
  }

  /** Asks for `event` to be saved (`want`) or not. */
  request(event: SaveTarget, want: boolean): RequestResult {
    if (this.status !== "ready") return "not-ready";
    const current = this.isSaved(event.id);
    if (want && !current && this.snapshot.count >= MAX_FAVOURITES) return "cap";
    this.desired.set(event.id, want);
    this.emit();
    if (!this.inflight.has(event.id)) void this.run(event);
    return "sent";
  }

  private async run(event: SaveTarget) {
    const id = event.id;
    this.inflight.add(id);
    try {
      for (;;) {
        const want = this.desired.get(id);
        if (want === undefined || want === this.confirmed.includes(id)) {
          this.desired.delete(id);
          break;
        }
        const nextIds = want ? [id, ...this.confirmed] : this.confirmed.filter((x) => x !== id);
        try {
          await (want ? this.backend.put(id, nextIds) : this.backend.del(id, nextIds));
        } catch (error) {
          const latest = this.desired.get(id);
          this.desired.delete(id);
          // Changed their mind back to what the server already has: nothing was lost.
          if (latest === want && this.active) this.onSettled({ kind: "failed", event, intent: want, error });
          break;
        }
        this.confirmed = want ? [id, ...this.confirmed.filter((x) => x !== id)] : this.confirmed.filter((x) => x !== id);
        if (this.desired.get(id) === want) {
          this.desired.delete(id);
          if (this.active) this.onSettled({ kind: want ? "saved" : "removed", event });
          break;
        }
      }
    } finally {
      this.inflight.delete(id);
      this.emit();
    }
  }

  private emit() {
    const removed = new Set<string>();
    const added: string[] = [];
    for (const [id, want] of this.desired) {
      const have = this.confirmed.includes(id);
      if (want && !have) added.push(id);
      if (!want && have) removed.add(id);
    }
    const ids = [...added.reverse(), ...this.confirmed.filter((id) => !removed.has(id))];
    this.snapshot = { status: this.status, ids, saved: new Set(ids), count: ids.length };
    for (const listener of this.listeners) listener();
  }
}
