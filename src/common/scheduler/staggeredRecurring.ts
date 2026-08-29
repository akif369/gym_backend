/** Run a background task without overlap and with a small startup jitter. */
export function startStaggeredRecurring(
  run: () => Promise<void>,
  intervalMs: number,
  startupJitterMs: number,
) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const safeIntervalMs = Number.isFinite(intervalMs) ? Math.max(1_000, Math.floor(intervalMs)) : 1_000;

  const schedule = (delayMs: number) => {
    timer = setTimeout(async () => {
      if (stopped) return;
      await run();
    if (!stopped) schedule(safeIntervalMs);
    }, delayMs);
    timer.unref();
  };

  const jitter = Math.max(0, Math.min(startupJitterMs, Math.max(0, safeIntervalMs - 1)));
  schedule(jitter > 0 ? Math.floor(Math.random() * jitter) : 0);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
