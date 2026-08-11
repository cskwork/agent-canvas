// FIFO admission queue for agent generations: up to `maxConcurrent` requests
// run at once, later ones wait in order, and only an overflowing backlog is
// rejected.
export const createGenerationQueue = (
  maxConcurrent: number,
  maxQueued: number,
) => {
  let active = 0;
  const waiters: Array<() => void> = [];

  return {
    get activeCount() {
      return active;
    },
    get queuedCount() {
      return waiters.length;
    },
    // Resolves once a slot is available, or returns null when the queue is
    // full. Every awaited acquisition must be paired with release().
    acquire(): Promise<void> | null {
      if (active < maxConcurrent) {
        active += 1;
        return Promise.resolve();
      }
      if (waiters.length >= maxQueued) {
        return null;
      }
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    release() {
      const next = waiters.shift();
      if (next) {
        // The slot transfers to the next waiter; active stays unchanged.
        next();
      } else {
        active -= 1;
      }
    },
  };
};
