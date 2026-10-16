import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "./metrics";

describe("MetricsRegistry", () => {
  it("renders counters, gauges and histograms in Prometheus text format", async () => {
    const reg = new MetricsRegistry();
    const c = reg.counter("http_requests_total", "Requests");
    c.inc({ method: "GET", route: "/v1/x", status: 200 });
    c.inc({ status: 200, route: "/v1/x", method: "GET" });
    c.inc({ method: "POST", route: '/v1/"q"', status: 500 });
    const g = reg.gauge("queue_depth", "Depth");
    g.set({ queue: "a" }, 3);
    const h = reg.histogram("dur_seconds", "Duration", [0.1, 1]);
    h.observe({ route: "/r" }, 0.05);
    h.observe({ route: "/r" }, 0.5);
    h.observe({ route: "/r" }, 5);
    const text = await reg.render();
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain('http_requests_total{method="GET",route="/v1/x",status="200"} 2');
    expect(text).toContain('route="/v1/\\"q\\""');
    expect(text).toContain('queue_depth{queue="a"} 3');
    expect(text).toContain('dur_seconds_bucket{route="/r",le="0.1"} 1');
    expect(text).toContain('dur_seconds_bucket{route="/r",le="1"} 2');
    expect(text).toContain('dur_seconds_bucket{route="/r",le="+Inf"} 3');
    expect(text).toContain('dur_seconds_count{route="/r"} 3');
    expect(text).toContain('dur_seconds_sum{route="/r"} 5.55');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("runs collectors per scrape and flags failing or slow ones", async () => {
    const reg = new MetricsRegistry({ collectorTimeoutMs: 30 });
    const g = reg.gauge("x", "x");
    let n = 0;
    reg.collect("good", () => g.set({}, ++n));
    reg.collect("bad", () => {
      throw new Error("down");
    });
    reg.collect("slow", () => new Promise(() => {}));
    const text = await reg.render();
    expect(text).toContain("x 1");
    expect(text).toContain('srikit_metrics_collector_error{collector="good"} 0');
    expect(text).toContain('srikit_metrics_collector_error{collector="bad"} 1');
    expect(text).toContain('srikit_metrics_collector_error{collector="slow"} 1');
    expect(await reg.render()).toContain("x 2");
  });

  it("rejects duplicate and invalid names", () => {
    const reg = new MetricsRegistry();
    reg.counter("a_total", "a");
    expect(() => reg.counter("a_total", "a")).toThrow(/already/);
    expect(() => reg.gauge("bad-name", "b")).toThrow(/Invalid/);
  });
});
