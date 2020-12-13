interface Entry {
  backlog: number | string;
}

/** A balancing scheduling pool. Useful primarily for making a pool of TaskWorkers. */
export class Pool<T extends Entry> {
  size: number;
  pool: T[];
  suspended: Set<T>;

  /**
     * Create a new Pool.
     * @param {number} size - The size of the pool.
     * @param {function} f - A function returning a pool element. This element
     * must have a "backlog" property representing its current load.
     */
  constructor(size: number, f: () => T) {
    this.size = size;
    if (this.size <= 0) throw new Error("Bad pool size");

    this.pool = [];
    this.suspended = new Set();
    for (let i = 0; i < size; i += 1) {
      this.pool.push(f());
    }
  }

  suspend(element: T): void {
    this.suspended.add(element);
  }

  resume(element: T): void {
    this.suspended.delete(element);
  }

  /**
     * Return the least-loaded element of the pool.
     * @return {?} The least-loaded element of the pool.
     */
  get(): T {
    let min: T | null = null;
    for (const element of this.pool) {
      if (this.suspended.has(element)) continue;
      if (element.backlog < ((min === null) ? Infinity : min.backlog)) {
        min = element;
      }
    }

    if (min === null) {
      throw new Error("pool-unavailable");
    }

    return min;
  }

  getStatus(): (number | string)[] {
    return this.pool.map((worker) => {
      if (!this.suspended.has(worker)) {
        return worker.backlog;
      }

      return "s";
    });
  }
}
