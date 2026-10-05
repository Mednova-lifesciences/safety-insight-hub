/**
 * Serialises async work per key.
 *
 * Line-list writes read the whole job and save it back. Two overlapping —
 * a person dropping two cases in quick succession, or a drop landing while
 * Fix is running — would let the later save overwrite the earlier one's
 * change with a stale copy. Queueing per job closes that within this tab.
 * The same pattern as the PSUR memo's document queue.
 */
export function createKeyedQueue() {
  const queues = new Map<string, Promise<unknown>>();
  return function inQueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };
}
