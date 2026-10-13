// A small seeded PRNG (mulberry32) so a scenario built from the same seed is the same world:
// same ids, same versions, same PR numbers. Only timestamps follow the world clock.

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** An integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }

  /** Picks by weight: `[["npm", 70], ["cargo", 5]]`. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    const last = entries.at(-1);
    if (!last) throw new Error("weighted pick from an empty list");
    return last[0];
  }

  /** `count` distinct items, in random order. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < count && pool.length > 0) {
      const [item] = pool.splice(Math.floor(this.next() * pool.length), 1);
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  hex(length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) out += Math.floor(this.next() * 16).toString(16);
    return out;
  }

  /** URL-safe characters, the alphabet GitHub's node ids are written in. */
  idChars(length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) out += ID_CHARS[Math.floor(this.next() * ID_CHARS.length)];
    return out;
  }
}
