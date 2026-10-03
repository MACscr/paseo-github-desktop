/** Map-backed LRU bounded by entry count and an optional total weight (e.g. bytes). */
export class Lru<K, V> {
  private readonly map = new Map<K, { value: V; weight: number }>();
  private totalWeight = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight = Number.POSITIVE_INFINITY,
    private readonly weigh: (value: V) => number = () => 0,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      this.totalWeight -= existing.weight;
      this.map.delete(key);
    }
    const weight = this.weigh(value);
    this.map.set(key, { value, weight });
    this.totalWeight += weight;
    while (this.map.size > this.maxEntries || (this.totalWeight > this.maxWeight && this.map.size > 1)) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.totalWeight -= this.map.get(oldest.value)!.weight;
      this.map.delete(oldest.value);
    }
  }

  delete(key: K): void {
    const entry = this.map.get(key);
    if (!entry) return;
    this.totalWeight -= entry.weight;
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.totalWeight = 0;
  }
}

/** Memoizes an async computation per key, sharing one in-flight promise and evicting failures. */
export function memoAsync<K, V>(cache: Lru<K, Promise<V>>, key: K, compute: () => Promise<V>): Promise<V> {
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = compute();
  cache.set(key, promise);
  promise.catch(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}
