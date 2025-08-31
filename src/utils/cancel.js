export class CancelledError extends Error {
  constructor(message = 'cancelled') {
    super(message);
    this.name = 'CancelledError';
    this.cancelled = true;
  }
}

// Wrap an async factory with UI-driven cancellation. The factory receives an AbortSignal.
export async function withUICancel(ui, factory) {
  const controller = new AbortController();
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { controller.abort(); } catch {}
  };

  if (ui?.onRegisterKill) ui.onRegisterKill(stop);

  let cancelTimer; let rejected = false;
  const cancelPromise = new Promise((_, reject) => {
    const tick = () => {
      if (ui?.shouldCancel && ui.shouldCancel()) {
        rejected = true;
        return reject(new CancelledError());
      }
      cancelTimer = setTimeout(tick, 60);
    };
    tick();
  });

  try {
    const task = factory(controller.signal);
    const result = await Promise.race([task, cancelPromise]);
    return result;
  } finally {
    clearTimeout(cancelTimer);
    if (ui?.onRegisterKill) ui.onRegisterKill(null);
  }
}

