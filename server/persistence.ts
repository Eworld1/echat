/**
 * Write-through persistence.
 *
 * The app keeps its working data in memory (fast, synchronous routes). This module mirrors every
 * change to a durable store (MongoDB) in the background, and loads it back on startup, so data
 * survives restarts and redeploys even on hosts with a disposable disk (e.g. Render free plan).
 */
export type CollectionName =
  | 'users' | 'posts' | 'stories' | 'messages' | 'notifications'
  | 'pages' | 'groups' | 'events' | 'passwordResetTokens' | 'auditLogs' | 'siteConfig' | 'liveRequests';

export const COLLECTIONS: CollectionName[] = [
  'users', 'posts', 'stories', 'messages', 'notifications',
  'pages', 'groups', 'events', 'passwordResetTokens', 'auditLogs', 'siteConfig', 'liveRequests'
];

export type Snapshot = Partial<Record<CollectionName, Record<string, unknown>[]>>;

export interface CollectionChange {
  collection: CollectionName;
  upserts: { key: string; doc: Record<string, unknown> }[];
  deletes: string[];
}

export interface PersistenceDriver {
  readonly name: string;
  /** Everything currently stored (empty object when the store is new). */
  load(): Promise<Snapshot>;
  /** Apply a batch of changes atomically per collection. */
  apply(changes: CollectionChange[]): Promise<void>;
  /** Optional: durable storage for uploaded files (photos, videos, voice notes). */
  putFile?(name: string, mime: string, data: Buffer): Promise<void>;
  getFile?(name: string): Promise<{ mime: string; data: Buffer } | null>;
  /** Isolated direct-message storage; deliberately excluded from snapshot sync. */
  listDirectMessagesForUser?(userId: string): Promise<DirectMessageRecord[]>;
  listDirectMessagesBetween?(userA: string, userB: string): Promise<DirectMessageRecord[]>;
  insertDirectMessage?(message: DirectMessageRecord): Promise<void>;
  markDirectMessagesRead?(senderId: string, receiverId: string, readAt: number): Promise<void>;
  close?(): Promise<void>;
}

export interface DirectMessageRecord {
  _id: string;
  senderId: string;
  receiverId: string;
  text: string;
  createdAt: number;
  readAt: number | null;
}

export function keyOf(collection: CollectionName, item: Record<string, unknown>): string {
  const k = collection === 'passwordResetTokens' ? item.token : item.id;
  return typeof k === 'string' ? k : '';
}

export class WriteThroughSync {
  private lastSaved = new Map<CollectionName, Map<string, string>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private dirty = false;
  private failures = 0;
  readonly stats = { flushes: 0, upserts: 0, deletes: 0 };

  constructor(
    private readonly driver: PersistenceDriver,
    private readonly getData: () => Partial<Record<CollectionName, unknown[]>>,
    private readonly debounceMs = 400
  ) {
    for (const c of COLLECTIONS) this.lastSaved.set(c, new Map());
  }

  /** Record what the store already holds so the first flush only sends differences. */
  prime(snapshot: Snapshot): void {
    for (const c of COLLECTIONS) {
      const m = new Map<string, string>();
      for (const item of snapshot[c] ?? []) m.set(keyOf(c, item), JSON.stringify(item));
      this.lastSaved.set(c, m);
    }
  }

  markDirty(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
    // never keep the process alive just for a pending flush; shutdown() flushes explicitly
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Compute what changed since the last successful flush. */
  private diff(): { changes: CollectionChange[]; next: Map<CollectionName, Map<string, string>> } {
    const data = this.getData();
    const changes: CollectionChange[] = [];
    const next = new Map<CollectionName, Map<string, string>>();
    for (const c of COLLECTIONS) {
      const prev = this.lastSaved.get(c) ?? new Map<string, string>();
      const cur = new Map<string, string>();
      const upserts: CollectionChange['upserts'] = [];
      for (const raw of (data[c] ?? []) as Record<string, unknown>[]) {
        const key = keyOf(c, raw);
        if (!key) continue;
        const serialised = JSON.stringify(raw);
        cur.set(key, serialised);
        if (prev.get(key) !== serialised) upserts.push({ key, doc: JSON.parse(s