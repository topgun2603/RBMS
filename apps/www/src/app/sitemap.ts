import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: { path: string; priority: number; freq: "weekly" | "monthly" | "yearly" }[] = [
    { path: "", priority: 1, freq: "weekly" },
    { path: "/billing", priority: 0.9, freq: "monthly" },
    { path: "/online-store", priority: 0.9, freq: "monthly" },
    { path: "/industries", priority: 0.9, freq: "monthly" },
    { path: "/demo", priority: 0.8, freq: "monthly" },
    { path: "/pricing", priority: 0.9, freq: "weekly" },
    { path: "/signup", priority: 0.7, freq: "monthly" },
    { path: "/terms", priority: 0.2, freq: "yearly" },
    { path: "/privacy", priority: 0.2, freq: "yearly" },
    { path: "/refunds", priority: 0.2, freq: "yearly" },
  ];
  return pages.map((p) => ({
    url: `${SITE_URL}${p.path}`,
    changeFrequency: p.freq,
    priority: p.priority,
    alternates: { languages: { en: `${SITE_URL}${p.path}?lang=en`, ta: `${SITE_URL}${p.path}?lang=ta` } },
  }));
}
