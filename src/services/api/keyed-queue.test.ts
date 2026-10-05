import { describe, expect, it } from "vitest";
import { createKeyedQueue } from "./keyed-queue";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("the keyed queue", () => {
  // Review Focus 5: two decisions on one job are two read-modify-writes;
  // run together, the second save would overwrite the first.
  it("runs work for the same key one after another", async () => {
    const inQueue = createKeyedQueue();
    const order: string[] = [];
    const a = inQueue("job-1", async () => {
      order.push("a:start");
      await tick();
      order.push("a:end");
    });
    const b = inQueue("job-1", async () => {
      order.push("b:start");
      order.push("b:end");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("does not make different keys wait for each other", async () => {
    const inQueue = createKeyedQueue();
    const order: string[] = [];
    const slow = inQueue("job-1", async () => {
      await tick();
      order.push("job-1");
    });
    const fast = inQueue("job-2", async () => {
      order.push("job-2");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["job-2", "job-1"]);
  });

  // The final review's Critical finding: re-validation read the whole job,
  // spent seconds in the AI pass, then saved its stale copy back — undoing a
  // drop made meanwhile. Queued on the same key, the drop runs after it.
  it("a long read-modify-write cannot overwrite a change queued behind it", async () => {
    const inQueue = createKeyedQueue();
    let stored: { rows: number; decisions?: string[] } = { rows: 3 };
    const validate = inQueue("job-1", async () => {
      const stale = { ...stored };
      await tick();
      stored = { ...stale, rows: 4 };
    });
    const drop = inQueue("job-1", async () => {
      stored = { ...stored, decisions: ["row 2 dropped"] };
    });
    await Promise.all([validate, drop]);
    expect(stored).toEqual({ rows: 4, decisions: ["row 2 dropped"] });
  });

  it("keeps going after a failure, and still reports the failure", async () => {
    const inQueue = createKeyedQueue();
    const failed = inQueue("job-1", async () => {
      throw new Error("boom");
    });
    const next = inQueue("job-1", async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
