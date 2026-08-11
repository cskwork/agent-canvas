import { describe, expect, it } from "vitest";

import { createGenerationQueue } from "./generationQueue";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createGenerationQueue", () => {
  it("runs up to the concurrency limit immediately", async () => {
    const queue = createGenerationQueue(2, 8);

    await queue.acquire();
    await queue.acquire();
    expect(queue.activeCount).toBe(2);
    expect(queue.queuedCount).toBe(0);
  });

  it("queues extra requests and wakes them in FIFO order", async () => {
    const queue = createGenerationQueue(1, 8);
    const order: number[] = [];

    await queue.acquire();
    const second = queue.acquire()!.then(() => order.push(2));
    const third = queue.acquire()!.then(() => order.push(3));
    expect(queue.queuedCount).toBe(2);

    queue.release();
    await second;
    queue.release();
    await third;
    expect(order).toEqual([2, 3]);
    expect(queue.queuedCount).toBe(0);
  });

  it("rejects only when the backlog is full", async () => {
    const queue = createGenerationQueue(1, 1);

    await queue.acquire();
    expect(queue.acquire()).not.toBeNull();
    expect(queue.acquire()).toBeNull();
  });

  it("frees slots once drained", async () => {
    const queue = createGenerationQueue(1, 1);

    await queue.acquire();
    queue.release();
    await tick();
    expect(queue.activeCount).toBe(0);
    await expect(queue.acquire()).resolves.toBeUndefined();
  });
});
