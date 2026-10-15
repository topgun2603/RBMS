import { describe, expect, it } from "vitest";
import { formatSseEvent, parseSse, sseComment, sseRetry } from "./sse";

describe("SSE framing", () => {
  it("formats event, id and JSON data, ending with a blank line", () => {
    expect(formatSseEvent({ event: "message", id: "1_x", data: { a: 1 } })).toBe('id: 1_x\nevent: message\ndata: {"a":1}\n\n');
    expect(formatSseEvent({ data: "plain" })).toBe("data: plain\n\n");
    expect(formatSseEvent({ event: "x", data: null })).toBe("event: x\ndata: null\n\n");
    expect(formatSseEvent({ data: "", retry: 1500.7 })).toBe("retry: 1500\ndata: \n\n");
  });

  it("splits multi-line data into several data lines (LF, CRLF and CR)", () => {
    expect(formatSseEvent({ event: "m", data: "one\ntwo\r\nthree\rfour" })).toBe("event: m\ndata: one\ndata: two\ndata: three\ndata: four\n\n");
    expect(formatSseEvent({ data: "a\n\nb" })).toBe("data: a\ndata: \ndata: b\n\n");
    // JSON never contains raw newlines (they're escaped), so a message body with line breaks stays one data line
    const frame = formatSseEvent({ event: "message", data: { body: "hi\nthere" } });
    expect(frame).toBe('event: message\ndata: {"body":"hi\\nthere"}\n\n');
  });

  it("can't be broken by newlines in event names or ids", () => {
    expect(formatSseEvent({ event: "a\nb", id: "1\r\n2", data: "x" })).toBe("id: 1 2\nevent: a b\ndata: x\n\n");
    expect(sseComment("ping\nevent: evil")).toBe(": ping event: evil\n\n");
  });

  it("comments and retry hints", () => {
    expect(sseComment("ping")).toBe(": ping\n\n");
    expect(sseRetry(3000)).toBe("retry: 3000\n\n");
  });

  it("parses back what it formats", () => {
    const text =
      sseRetry(3000) +
      formatSseEvent({ event: "ready", data: { ok: true } }) +
      sseComment("ping") +
      formatSseEvent({ event: "message", id: "5_a", data: "l1\nl2" }) +
      formatSseEvent({ data: "default" });
    expect(parseSse(text)).toEqual([
      { event: "message", data: "", retry: 3000 },
      { event: "ready", data: '{"ok":true}' },
      { event: "message", data: "l1\nl2", id: "5_a" },
      { event: "message", data: "default" },
    ]);
  });
});
