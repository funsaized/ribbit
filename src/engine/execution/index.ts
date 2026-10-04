import { RibbitError, validateRecord, type RecordValue } from '../records/index.ts';

export interface BudgetLimits {
  totalMs: number;
  requestMs: number;
  maxRequests: number;
  maxTokens: number;
  maxBytes: number;
  maxRecords: number;
}

export const DEFAULT_BUDGET: BudgetLimits = {
  totalMs: 120_000,
  requestMs: 60_000,
  maxRequests: 32,
  maxTokens: 64_000,
  maxBytes: 8 * 1024 * 1024,
  maxRecords: 10_000,
};

export function resolveLimits(limits: Partial<BudgetLimits> = {}): BudgetLimits {
  const resolved = { ...DEFAULT_BUDGET, ...limits };

  for (const [key, value] of Object.entries(resolved))
    if (!Number.isSafeInteger(value) || value < 1) throw new RibbitError(2, `${key} must be a positive integer`);

  return resolved;
}

export class Budget {
  readonly started = performance.now();
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly limits: BudgetLimits;
  requests = 0;
  tokens = 0;
  bytes = 0;
  records = 0;
  repairs = 0;
  retries = 0;
  routes: { provider: string; model: string; source: Record<string, string> }[] = [];
  usageUnknown = false;
  private timer: ReturnType<typeof setTimeout>;
  private external?: AbortSignal;
  private tail: Promise<void> = Promise.resolve();
  private onAbort = () => this.controller.abort(new RibbitError(130, 'Cancelled'));
  constructor(limits: Partial<BudgetLimits> = {}, external?: AbortSignal) {
    this.limits = resolveLimits(limits);
    this.timer = setTimeout(
      () => this.controller.abort(new RibbitError(6, 'Total command deadline exceeded')),
      this.limits.totalMs,
    );
    this.timer.unref?.();
    this.external = external;
    if (external?.aborted) this.onAbort();
    else external?.addEventListener('abort', this.onAbort, { once: true });
  }
  check() {
    if (!this.signal.aborted && performance.now() - this.started >= this.limits.totalMs)
      this.controller.abort(new RibbitError(6, 'Total command deadline exceeded'));
    if (this.signal.aborted) throw this.signal.reason;
  }
  charge(kind: 'tokens' | 'bytes' | 'records', count: number) {
    this.check();
    if (!Number.isSafeInteger(count) || count < 0) throw new RibbitError(4, `Invalid ${kind} accounting`);
    const max = { tokens: this.limits.maxTokens, bytes: this.limits.maxBytes, records: this.limits.maxRecords }[kind];

    if (this[kind] + count > max) throw new RibbitError(6, `${kind} budget exceeded (${max})`);
    this[kind] += count;
  }
  // Every transport attempt, including repairs/retries, must enter here.
  async request<T>(execute: (signal: AbortSignal) => Promise<T>, timeoutMs = this.limits.requestMs): Promise<T> {
    const previous = this.tail;
    let release!: () => void;

    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      this.check();
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RibbitError(2, 'Invalid request timeout');
      if (this.requests >= this.limits.maxRequests)
        throw new RibbitError(6, `Request budget exceeded (${this.limits.maxRequests})`);
      this.requests++;
      const controller = new AbortController();
      const forward = () => controller.abort(this.signal.reason);

      this.signal.addEventListener('abort', forward, { once: true });
      const timer = setTimeout(
        () => controller.abort(new RibbitError(6, 'Inference request deadline exceeded')),
        Math.min(this.limits.requestMs, timeoutMs),
      );
      let remove = () => {};
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => reject(controller.signal.reason);

        controller.signal.addEventListener('abort', onAbort, { once: true });
        remove = () => controller.signal.removeEventListener('abort', onAbort);
      });

      try {
        return await Promise.race([Promise.resolve().then(() => execute(controller.signal)), aborted]);
      } finally {
        clearTimeout(timer);
        remove();
        this.signal.removeEventListener('abort', forward);
      }
    } finally {
      release();
    }
  }
  close() {
    clearTimeout(this.timer);
    this.external?.removeEventListener('abort', this.onAbort);
  }
}

export async function* take<T>(source: AsyncIterable<T>, count: number): AsyncGenerator<T> {
  if (!Number.isSafeInteger(count) || count < 0) throw new RibbitError(2, 'take count must be a nonnegative integer');
  if (count === 0) return;
  let seen = 0;

  for await (const value of source) {
    yield value;
    if (++seen >= count) return;
  }
}

export async function* validated(source: AsyncIterable<RecordValue>, budget: Budget): AsyncGenerator<RecordValue> {
  const ids = new Set<string>();

  for await (const record of source) {
    budget.check();
    validateRecord(record);
    if (ids.has(record.id)) throw new RibbitError(4, `Duplicate emitted record ID: ${record.id}`);
    budget.charge('records', 1);
    budget.charge('bytes', Buffer.byteLength(JSON.stringify(record)) + 1);
    ids.add(record.id);
    yield record;
  }
}

export async function writeOutput(
  chunks: AsyncIterable<string>,
  sink: { write(chunk: string): Promise<void> },
  downstreamPipe: boolean,
): Promise<void> {
  try {
    for await (const chunk of chunks) await sink.write(chunk);
  } catch (error) {
    if (downstreamPipe && (error as { code?: string })?.code === 'EPIPE') return;
    if (error instanceof RibbitError) throw error;
    throw new RibbitError(7, `Output write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Await cooperative work while allowing the invocation to stop waiting on abort. */
export async function abortable<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let remove = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    const onAbort = () => reject(signal.reason);

    signal.addEventListener('abort', onAbort, { once: true });
    remove = () => signal.removeEventListener('abort', onAbort);
  });

  try {
    return await Promise.race([work, cancelled]);
  } finally {
    remove();
  }
}

/** Close iterators on early exit without letting an uncooperative return block cancellation. */
export async function* cancellable<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  let complete = false;

  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const part = await abortable(iterator.next(), signal);

      if (part.done) {
        complete = true;

        return;
      }
      yield part.value;
    }
  } finally {
    if (!complete && iterator.return) {
      const closing = Promise.resolve().then(() => iterator.return!());

      if (signal.aborted) void closing.catch(() => {});
      else await abortable(closing, signal);
    }
  }
}
