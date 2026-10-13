export type Priority = "interactive" | "background";

/** A fixed number of slots, `reserved` of them only for interactive work. Waiting interactive work goes first. */
export class Lane {
  private busy = 0;
  private readonly waiting: Record<Priority, (() => void)[]> = { interactive: [], background: [] };

  constructor(
    private readonly slots: number,
    private readonly reserved: number,
  ) {}

  async run<T>(priority: Priority, work: () => Promise<T>): Promise<T> {
    if (this.fits(priority)) this.busy++;
    else await new Promise<void>((resolve) => this.waiting[priority].push(resolve));
    try {
      return await work();
    } finally {
      this.busy--;
      this.wake();
    }
  }

  private fits(priority: Priority): boolean {
    return this.busy < (priority === "interactive" ? this.slots : this.slots - this.reserved);
  }

  // Slots are taken here, before the waiter resumes, so nothing can slip in between.
  private wake(): void {
    for (const priority of ["interactive", "background"] as const) {
      const queue = this.waiting[priority];
      while (queue.length > 0 && this.fits(priority)) {
        this.busy++;
        queue.shift()?.();
      }
    }
  }
}
