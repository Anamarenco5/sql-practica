// Semáforo simple: limita cuántas tareas corren a la vez; el resto espera en fila.
export function semaphore(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const acquire = async () => {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
  };
  const release = () => {
    active--;
    queue.shift()?.();
  };
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
  return { acquire, release, run };
}
