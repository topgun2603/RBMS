import type { Device } from "./schema";

/** Crawlers, link previews, monitoring, headless browsers and HTTP libraries. */
const BOT_RE = new RegExp(
  [
    "\\bbot\\b",
    "bot[/;)-]",
    "\\+https?://",
    "crawl",
    "spider",
    "slurp",
    "mediapartners",
    "facebookexternalhit",
    "facebookcatalog",
    "embedly",
    "quora link preview",
    "whatsapp/",
    "telegrambot",
    "skypeuripreview",
    "bingpreview",
    "pinterestbot",
    "petalbot",
    "semrush",
    "ahrefs",
    "mj12",
    "dotbot",
    "bytespider",
    "gptbot",
    "chatgpt",
    "claudebot",
    "perplexity",
    "ccbot",
    "applebot",
    "google-inspectiontool",
    "googleother",
    "adsbot",
    "lighthouse",
    "pagespeed",
    "gtmetrix",
    "pingdom",
    "uptimerobot",
    "statuscake",
    "headlesschrome",
    "headless",
    "phantomjs",
    "puppeteer",
    "playwright",
    "selenium",
    "webdriver",
    "cypress",
    "curl/",
    "wget/",
    "python-requests",
    "python-urllib",
    "aiohttp",
    "httpx",
    "axios/",
    "node-fetch",
    "undici",
    "got \\(",
    "go-http-client",
    "java/",
    "okhttp",
    "apache-httpclient",
    "libwww-perl",
    "postmanruntime",
    "insomnia",
    "scrapy",
    "^mozilla/5\\.0$",
  ].join("|"),
  "i",
);

/** True for crawlers and headless/automated clients, and for a missing or tiny user agent. */
export function isBot(ua: string | null | undefined): boolean {
  if (!ua) return true;
  const s = ua.trim();
  if (s.length < 10) return true;
  return BOT_RE.test(s);
}

const TABLET_RE = /ipad|tablet|playbook|silk|kindle|nexus (7|9|10)|sm-t\d|tab\b/i;
const MOBILE_RE = /mobi|iphone|ipod|android.+mobile|windows phone|iemobile|opera mini|blackberry|bb10|kaios/i;

/** mobile | tablet | desktop from the user agent (iPadOS desktop-mode Safari counts as desktop). */
export function deviceOf(ua: string | null | undefined): Device {
  const s = ua ?? "";
  if (TABLET_RE.test(s)) return "tablet";
  if (MOBILE_RE.test(s)) return "mobile";
  // Android without "Mobile" is a tablet by Google's convention.
  if (/android/i.test(s)) return "tablet";
  return "desktop";
}
