import type { CollectionChange, CollectionName, PersistenceDriver, Snapshot } from './persistence.js';
import { COLLECTIONS } from './persistence.js';

/**
 * MongoDB storage (works with the free MongoDB Atlas M0 cluster).
 * One Mongo collection per Echat collection, one document per item, keyed by its id.
 * mongoose is imported lazily so the app still starts when MONGO_URI is not configured.
 */
export class MongoDriver implements PersistenceDriver {
  readonly name = 'MongoDB';
  private mongoose: typeof import('mongoose') | null = null;

  constructor(private readonly uri: string) {}

  async connect(): Promise<void> {
    const mod = await import('mongoose');
    this.mongoose = (mod.default ?? mod) as typeof import('mongoose');
    await this.mongoose.connect(this.uri, { serverSelectionTimeoutMS: 15000 });
  }

  private col(name: CollectionName) {
    const db = this.mongoose?.connection.db;
    if (!db) throw new Error('MongoDB is not connected');
    return db.collection(`echat_${name}`);
  }

  async load(): Promise<Snapshot> {
    const out: Snapshot = {};
    for (const c of COLLECTIONS) {
      const docs = await this.col(c).find({}).toArray();
      out[c] = docs.map(d => {
        const { _id, ...rest } = d as Record<string, unknown>;
        return rest;
      });
    }
    return out;
  }

  async apply(changes: CollectionChange[]): Promise<void> {
    for (const ch of changes) {
      const ops: Record<string, unknown>[] = [
        ...ch.upserts.map(u => ({
          replaceOne: { filter: { _id: u.key }, replacement: u.doc, upsert: true }
        })),
        ...ch.deletes.map(key => ({ deleteOne: { filter: { _id: key } } }))
      ];
      // bulkWrite in slices so one huge batch never exceeds Mongo's limits
      for (let i = 0; i < ops.length; i += 500) {
        await this.col(ch.collection).bulkWrite(ops.slice(i, i + 500) as never, { ordered: false });
      }
    }
  }

  async putFile(name: string, mime: string, data: Buffer): Promise<void> {
    const db = this.mongoose?.connection.db;
    if (!db) throw new Error('MongoDB is not connected');
    await db.collection('echat_uploads').replaceOne(
      { _id: name as never },
      { mime, data, size: data.length, createdAt: Date.now() },
      { upsert: true }
    );
  }

  async getFile(name: string): Promise<{ mime: string; data: Buffer } | null> {
    const db = this.mongoose?.connection.db;
    if (!db) throw new Error('MongoDB is not connected');
    const doc = await db.collection('echat_uploads').findOne({ _id: name as never });
    if (!doc) return null;
    const raw = (doc as { data?: { buffer?: Uint8Array } | Uint8Array }).data;
    const bytes = raw && 'buffer' in raw && raw.buffer ? raw.buffer : (raw as Uint8Array | undefined);
    if (!bytes) return null;
    return { mime: String((doc as { mime?: string }).mime || 'application/octet-stream'), data: Buffer.from(bytes) };
  }

  async close(): Promise<void> {
    await this.mongoose?.disconnect();
  }
}
