import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@srirealtime/web";
import { siteMessages } from "../lib/messages";
import { GalleryField, ImageField } from "./image-field";
import { VideoField } from "./media-video-field";

function render(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider bundles={[siteMessages]} namespaces={["site"]}>
        {node}
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const noop = () => undefined;

describe("ImageField", () => {
  it("empty: upload, drop, library and link", () => {
    const html = render(<ImageField value="" onChange={noop} label="Hero image" />);
    expect(html).toContain("Choose an image");
    expect(html).toContain("or drop it here");
    expect(html).toContain("Choose from library");
    expect(html).toContain("Use an image link");
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('aria-label="Hero image"');
  });

  it("filled: preview plus replace, library and remove; stock site paths resolve against the API", () => {
    const html = render(<ImageField value="/v1/branding/stock/gym/hero-1.svg?p=ef4444" onChange={noop} />);
    expect(html).toMatch(/<img src="https?:\/\/[^"]+\/v1\/branding\/stock\/gym\/hero-1\.svg\?p=ef4444"/);
    expect(html).toContain("Replace");
    expect(html).toContain("Choose from library");
    expect(html).toContain("Remove");
    expect(html).not.toContain("Use an image link");
  });

  it("disabled: every action is disabled", () => {
    const html = render(<ImageField value="" onChange={noop} disabled />);
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expect(buttons.every((b) => b.includes("disabled"))).toBe(true);
  });
});

describe("GalleryField", () => {
  it("offers the library next to the link", () => {
    const html = render(<GalleryField value={[{ url: "https://x.test/a.jpg", alt: "", caption: "" }]} onChange={noop} max={6} />);
    expect(html).toContain("Choose from library");
    expect(html).toContain("Use an image link");
  });
});

describe("VideoField", () => {
  it("empty: upload MP4 / WebM, library, and a link field", () => {
    const html = render(<VideoField id="v" label="Video" value="" onChange={noop} />);
    expect(html).toContain("Choose a video");
    expect(html).toContain("MP4 or WebM, up to 50 MB");
    expect(html).toContain('accept="video/mp4,video/webm"');
    expect(html).toContain("Choose from library");
    expect(html).toContain("Use a video link");
  });

  it("filled: plays the clip muted with replace / remove, link still editable", () => {
    const html = render(<VideoField id="v" label="Video" value="https://cdn.test/shop.mp4" onChange={noop} />);
    expect(html).toMatch(/<video[^>]*src="https:\/\/cdn\.test\/shop\.mp4"/);
    expect(html).toContain("muted");
    expect(html).toContain("Replace");
    expect(html).toContain("Remove");
    expect(html).toContain('value="https://cdn.test/shop.mp4"');
  });
});
