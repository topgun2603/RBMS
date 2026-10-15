import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@srirealtime/web";
import { siteMessages } from "../../lib/messages";
import type { ResolvedHomeSection } from "../../lib/types";
import { HomePreview } from "./home-preview";

function render(sections: ResolvedHomeSection[]) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider bundles={[siteMessages]} namespaces={["site"]}>
        <HomePreview sections={sections} shopName="Anbu Fashions" device="desktop" onDevice={() => undefined} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

/** The wrapper markup of each preview section, in order. */
const wrappers = (html: string) => [...html.matchAll(/<div (data-hidden="true" )?class="relative transition-shadow[^"]*">([\s\S]*?)<div class="([^"]*)">/g)];

describe("HomePreview", () => {
  it("shows hidden sections dimmed with a Hidden badge; visible ones as normal", () => {
    const html = render([
      { type: "text", heading: "Welcome", markdown: "Hello" },
      { type: "newsletter", heading: "Join our list", text: "", hidden: true },
    ]);
    const w = wrappers(html);
    expect(w).toHaveLength(2);
    expect(w[0]![1]).toBeUndefined();
    expect(w[0]![3]).not.toContain("opacity-40");
    expect(w[0]![2]).not.toContain("Hidden on the store");
    expect(w[1]![1]).toBeTruthy();
    expect(w[1]![2]).toContain("Hidden on the store");
    expect(w[1]![3]).toContain("opacity-40");
    // still rendered (so the owner sees what's hidden)
    expect(html).toContain("Join our list");
  });

  it("renders a hero without a picture as the branded backdrop", () => {
    const html = render([{ type: "hero", slides: [{ imageUrl: null, heading: "Festive kurtis" }] }]);
    expect(html).toContain("data-brand-hero");
    expect(html).not.toContain("<img");
    expect(html).toContain("Festive kurtis");
  });
});
