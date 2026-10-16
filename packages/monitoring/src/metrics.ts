/**
 * A small Prometheus registry (text exposition format 0.0.4) — counters, gauges and histograms with labels, plus
 * collectors that add samples at scrape time (queue depth, DB connections). No dependency on prom-client.
 */

export type Labels = Record<string, string | number>;

interface Series {
  labels: Labels;
  value: number;
}

const escapeLabel = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
const escapeHelp = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

const labelKey = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}=${String(labels[k])}`)
    .join("\u0001");

export function formatLabels(labels: Labels): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return "";
  return `{${keys.map((k) => `${k}="${escapeLabel(String(labels[k]))}"`).join(",")}}`;
}

const formatValue = (v: number) => (Number.isNaN(v) ? "NaN" : v === Infinity ? "+Inf" : v === -Infinity ? "-Inf" : String(v));

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: "counter" | "gauge" | "histogram",
  ) {
    if (!NAME.test(name)) throw new Error(`Invalid metric name "${name}"`);
  }
  abstract lines(): string[];
}

export class Counter extends Metric {
  private readonly series = new Map<string, Series>();
  constructor(name: string, help: string) {
    super(name, help, "counter");
  }
  inc(labels: Labels = {}, by = 1) {
    if (by < 0) throw new Error("Counter can only increase");
    const k = labelKey(labels);
    const s = this.series.get(k);
    if (s) s.value += by;
    else this.series.set(k, { labels: { ...labels }, value: by });
  }
  get(labels: Labels = {}) {
    return this.series.get(labelKey(labels))?.value ?? 0;
  }
  lines() {
    return [...this.series.values()].map((s) => `${this.name}${formatLabels(s.labels)} ${formatValue(s.value)}`);
  }
}

export class Gauge extends Metric {
  private readonly series = new Map<string, Series>();
  constructor(name: string, help: string) {
    super(name, help, "gauge");
  }
  set(labels: Labels, value: number) {
    this.series.set(labelKey(labels), { labels: { ...labels }, value });
  }
  reset() {
    this.series.clear();
  }
  get(labels: Labels = {}) {
    return this.series.get(labelKey(labels))?.value;
  }
  lines() {
    return [...this.series.values()].map((s) => `${this.name}${formatLabels(s.labels)} ${formatValue(s.value)}`);
  }
}

interface HistSeries {
  labels: Labels;
  buckets: number[];
  sum: number;
  count: number;
}

export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class Histogram extends Metric {
  private readonly series = new Map<string, HistSeries>();
  readonly buckets: number[];
  constructor(name: string, help: string, buckets = DEFAULT_BUCKETS) {
    super(name, help, "histogram");
    this.buckets = [...buckets].sort((a, b) => a - b);
  }
  observe(labels: Labels, value: number) {
    const k = labelKey(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { labels: { ...labels }, buckets: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    for (let i = 0; i < this.buckets.length; i++) if (value <= this.buckets[i]!) s.buckets[i]!++;
    s.sum += value;
    s.count++;
  }
  lines() {
    const out: string[] = [];
    for (const s of this.series.values()) {
      this.buckets.forEach((b, i) => out.push(`${this.name}_bucket${formatLabels({ ...s.labels, le: formatValue(b) })} ${s.buckets[i]}`));
      out.push(`${this.name}_bucket${formatLabels({ ...s.labels, le: "+Inf" })} ${s.count}`);
      out.push(`${this.name}_sum${formatLabels(s.labels)} ${formatValue(s.sum)}`);
      out.push(`${this.name}_count${formatLabels(s.labels)} ${s.count}`);
    }
    return out;
  }
}

/** Runs before each scrape (fill gauges from Redis/DB). A failing collector is skipped, never fails the scrape. */
export type Collector = () => Promise<void> | void;

export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>();
  private readonly collectors: Array<{ name: string; fn: Collector }> = [];
  private readonly collectorErrors: Gauge;

  constructor(private readonly opts: { collectorTimeoutMs?: number } = {}) {
    this.collectorErrors = this.gauge("srikit_metrics_collector_error", "1 when a collector failed or timed out on this scrape");
  }

  counter(name: string, help: string) {
    return this.add(new Counter(name, help));
  }
  gauge(name: string, help: string) {
    return this.add(new Gauge(name, help));
  }
  histogram(name: string, help: string, buckets?: number[]) {
    return this.add(new Histogram(name, help, buckets));
  }
  collect(name: string, fn: Collector) {
    this.collectors.push({ name, fn });
  }

  private add<M extends Metric>(m: M): M {
    if (this.metrics.has(m.name)) throw new Error(`Metric "${m.name}" is already registered`);
    this.metrics.set(m.name, m);
    return m;
  }

  /** Prometheus text exposition. */
  async render(): Promise<string> {
    const timeout = this.opts.collectorTimeoutMs ?? 2000;
    await Promise.all(
      this.collectors.map(async (c) => {
        try {
          await withTimeout(Promise.resolve().then(c.fn), timeout);
          this.collectorErrors.set({ collector: c.name }, 0);
        } catch {
          this.collectorErrors.set({ collector: c.name }, 1);
        }
      }),
    );
    const out: string[] = [];
    for (const m of this.metrics.values()) {
      const lines = m.lines();
      if (lines.length === 0) continue;
      out.push(`# HELP ${m.name} ${escapeHelp(m.help)}`, `# TYPE ${m.name} ${m.type}`, ...lines);
    }
    return `${out.join("\n")}\n`;
  }
}

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** Rejects with `timeout` after `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}
