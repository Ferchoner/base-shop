/**
 * The in-memory store of one cache namespace, for Keyv (ADR-0129). It keeps at most `maxEntries` values and,
 * when one more arrives, drops the one read or written least recently. Keyv deletes an expired value only
 * when it is read again, so without a bound, keys nobody asks for twice, such as every combination of filters
 * of the store listing, would pile up for as long as the process lives.
 */
export class LruStore {
  // A Map iterates in insertion order: moving a key to the end on every use keeps the least recent first.
  private readonly entries = new Map<string, unknown>();

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): unknown {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: unknown): boolean {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.maxEntries) {
      const [leastRecent] = this.entries.keys();
      this.entries.delete(leastRecent);
    }
    return true;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
