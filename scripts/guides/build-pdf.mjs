#!/usr/bin/env node
/**
 * Render a guide written in Markdown to a styled A4 PDF with headless Chrome.
 *
 *   node scripts/guides/build-pdf.mjs <input.md> <output.pdf> "<title>" [--html out.html] [--lang en|ta] [--compact]
 *
 * No Markdown library is installed in this repo, so this file has a small converter for the subset the guides use:
 * front matter (title, subtitle, date), # / ## / ### headings, paragraphs, flat - and 1. lists, tables, images
 * (a line with only an image becomes a captioned figure), "::: callout" blocks, --- rules, raw HTML blocks (a line
 * starting with "<" up to the next blank line), and **bold**, *italic*, `code` and [links](url) inline.
 * Each "# " heading is a chapter; add " {pb}" at the end of the heading to start it on a new page. Images are embedded, so the HTML has no file paths.
 * Fonts: Noto Sans and Noto Sans Tamil from Google Fonts, with local fallbacks (Nirmala UI also covers Tamil).
 * Env: CHROME_PATH (default: the Windows Chrome install).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const compact = args.includes("--compact");
if (compact) args.splice(args.indexOf("--compact"), 1);
const htmlOut = flag("--html");
const lang = flag("--lang") || "en";
const [input, output, titleArg] = args;
if (!input || !output) {
  console.error('usage: build-pdf.mjs <input.md> <output.pdf> "<title>" [--html out.html] [--lang en|ta]');
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
};

const inputDir = path.dirname(path.resolve(input));
const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const embed = (src) => {
  const file = path.resolve(inputDir, src);
  const type = mime[path.extname(file).toLowerCase()];
  if (!type || !fs.existsSync(file)) throw new Error(`image not found: ${src}`);
  return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
};

function convert(md) {
  let meta = {};
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    md = md.slice(fm[0].length);
  }
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  let firstH1 = true;
  const isBlank = (l) => l.trim() === "";
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    // raw html block
    if (/^\s*</.test(line)) {
      const buf = [];
      while (i < lines.length && !isBlank(lines[i])) buf.push(lines[i++]);
      // a diagram may contain blank-free html only; keep going until tags balance for div blocks
      let html = buf.join("\n");
      const count = (re) => (html.match(re) || []).length;
      while (count(/<div\b/g) > count(/<\/div>/g) && i < lines.length) html += "\n" + lines[i++];
      out.push(html);
      continue;
    }
    if (line.startsWith(":::")) {
      const kind = line.slice(3).trim() || "callout";
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(":::")) buf.push(lines[i++]);
      i++;
      out.push(`<aside class="${kind}">${buf.filter((l) => !isBlank(l)).map((l) => `<p>${inline(l)}</p>`).join("")}</aside>`);
      continue;
    }
    let m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      const level = m[1].length;
      const pb = / \{pb\}$/.test(m[2]);
      m[2] = m[2].replace(/ \{pb\}$/, "");
      const cls = level === 1 ? (firstH1 ? ' class="chapter first"' : pb ? ' class="chapter pb"' : ' class="chapter"') : "";
      if (level === 1) firstH1 = false;
      out.push(`<h${level}${cls}>${inline(m[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    m = line.match(/^!\[(.*)\]\((.+)\)\s*$/);
    if (m) {
      out.push(`<figure><img src="${embed(m[2])}" alt=""><figcaption>${inline(m[1])}</figcaption></figure>`);
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    m = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (m) {
      const ordered = /\d/.test(m[2]);
      const items = [];
      while (i < lines.length) {
        const mm = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (mm) { items.push(mm[3]); i++; }
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += " " + lines[i].trim(); i++; }
        else break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,3}\s|:::|\||!\[|\s*<|---+\s*$)/.test(lines[i]) && !/^([-*]|\d+\.)\s/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i++]); }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return { meta, body: out.join("\n") };
}

const css = `
@page { size: A4; margin: 20mm 18mm 22mm 18mm;
  @bottom-center { content: counter(page); font: 9pt "Noto Sans","Segoe UI",sans-serif; color: #6b7280; } }
@page cover { margin: 0; @bottom-center { content: none; } }
:root { --accent: #0f766e; --accent-dark: #115e59; --soft: #ecfdf5; --ink: #1f2937; --muted: #6b7280; }
* { box-sizing: border-box; }
html { font-family: ${lang === "ta" ? '"Noto Sans Tamil","Noto Sans"' : '"Noto Sans","Noto Sans Tamil"'},"Nirmala UI","Segoe UI",Arial,sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.55; }
body { margin: 0; }
.cover { page: cover; height: 297mm; width: 210mm; padding: 28mm 22mm; color: #fff; display: flex; flex-direction: column; justify-content: space-between;
  background: linear-gradient(155deg, #0b4f4a 0%, #0f766e 55%, #14b8a6 100%); break-after: page; position: relative; overflow: hidden; }
.cover::after { content: ""; position: absolute; right: -60mm; bottom: -60mm; width: 170mm; height: 170mm; border-radius: 50%; background: rgba(255,255,255,.07); }
.cover .brand { font-weight: 700; letter-spacing: .18em; font-size: 11pt; text-transform: uppercase; opacity: .9; }
.cover h1 { font-size: 34pt; line-height: 1.12; margin: 0 0 10mm; font-weight: 800; }
.cover .subtitle { font-size: 14pt; max-width: 135mm; opacity: .95; line-height: 1.45; }
.cover .date { font-size: 11pt; opacity: .85; }
.cover .rule { width: 28mm; height: 3px; background: #99f6e4; margin: 0 0 8mm; }
h1.chapter { font-size: 22pt; color: var(--accent-dark); margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 3px solid var(--accent); margin-top: 12mm; break-after: avoid; line-height: 1.2; }
h1.chapter.pb { break-before: page; margin-top: 0; }
h1.chapter.first { break-before: auto; margin-top: 0; }
h2 { font-size: 14pt; color: var(--accent); margin: 7mm 0 2mm; break-after: avoid; }
h3 { font-size: 11.5pt; color: var(--accent-dark); margin: 5mm 0 1mm; break-after: avoid; }
p { margin: 0 0 3mm; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 3.5mm; padding-left: 6mm; }
li { margin: 0 0 1.2mm; }
li::marker { color: var(--accent); }
strong { color: #111827; }
a { color: var(--accent); text-decoration: none; }
code { font-family: Consolas, monospace; background: #f3f4f6; padding: 0 2px; border-radius: 3px; font-size: 9.5pt; }
table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 9.5pt; break-inside: avoid; }
th { background: var(--accent); color: #fff; text-align: left; padding: 2mm 3mm; font-weight: 600; }
td { padding: 2mm 3mm; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
tr:nth-child(even) td { background: #f9fafb; }
figure { margin: 4mm 0 6mm; break-inside: avoid; }
figure img { width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 3mm; box-shadow: 0 1px 6px rgba(0,0,0,.08); display: block; }
figcaption { font-size: 8.8pt; color: var(--muted); margin-top: 2mm; padding-left: 1mm; }
figcaption::before { content: "${lang === "ta" ? "படம். " : "Figure. "}"; font-weight: 600; color: var(--accent); }
aside.callout { background: var(--soft); border-left: 4px solid var(--accent); border-radius: 0 2mm 2mm 0; padding: 3mm 4mm 1mm; margin: 4mm 0 5mm; break-inside: avoid; }
aside.callout p { margin-bottom: 2mm; }
hr { border: 0; border-top: 1px solid #e5e7eb; margin: 5mm 0; }
.diagram { margin: 4mm 0 6mm; font-size: 9pt; break-inside: avoid; }
.dg-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
.dg-box { border-radius: 2.5mm; padding: 3mm; text-align: center; border: 1.5px solid; }
.dg-box b { display: block; font-size: 9.5pt; margin-bottom: 1mm; }
.dg-box span { display: block; font-size: 8pt; line-height: 1.35; }
.dg-sell { background: #f0fdfa; border-color: #5eead4; color: #134e4a; }
.dg-run { background: #fff7ed; border-color: #fdba74; color: #7c2d12; }
.dg-core { background: var(--accent); color: #fff; border-radius: 3mm; padding: 4mm; text-align: center; }
.dg-core b { display: block; font-size: 12pt; margin-bottom: 1mm; }
.dg-core span { font-size: 8.5pt; opacity: .95; }
.dg-arrows { text-align: center; color: var(--accent); font-size: 10pt; line-height: 1.6; letter-spacing: .1em; }
`;

// --compact: denser text and smaller figures for long manuals.
const compactCss = `
html { font-size: 9.4pt; line-height: 1.42; }
p { margin-bottom: 2.2mm; }
li { margin-bottom: .8mm; }
h2 { margin: 5mm 0 1.5mm; font-size: 13pt; }
table { margin: 2mm 0 3.5mm; font-size: 9pt; }
td, th { padding: 1.4mm 2.6mm; }
figure { margin: 3mm auto 4mm; width: 68%; }
figure img { width: 100%; }
`;

const { meta, body } = convert(fs.readFileSync(input, "utf8"));
const title = titleArg || meta.title || "Guide";
const coverTitle = esc(meta.title || title);
const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700;800&family=Noto+Sans+Tamil:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${css}${compact ? compactCss : ""}</style></head><body>
<section class="cover"><div class="brand">RBMS</div><div><div class="rule"></div><h1>${coverTitle}</h1><div class="subtitle">${esc(meta.subtitle || "")}</div></div><div class="date">${esc(meta.date || "")}</div></section>
${body}
</body></html>`;

// Names that must never appear in a customer guide.
const banned = /srikit|srirealtime|localhost|@srirealtime/i;
const hit = html.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, "").match(banned);
if (hit) {
  console.error(`forbidden text in guide: "${hit[0]}"`);
  process.exit(2);
}
if (htmlOut) fs.writeFileSync(htmlOut, html);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "package.json"));
let puppeteer;
try {
  puppeteer = req("puppeteer-core");
} catch {
  const pnpm = path.join(root, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpm).find((d) => d.startsWith("puppeteer-core@"));
  if (!dir) throw new Error("puppeteer-core not found in node_modules");
  puppeteer = (await import(pathToFileURL(path.join(pnpm, dir, "node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js")).href)).default;
}
const executablePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 }).catch(() => page.setContent(html));
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
  console.log("fonts loaded:", [...new Set(fonts)].join(", ") || "none (system fallback)");
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  await page.pdf({ path: output, format: "A4", printBackground: true, preferCSSPageSize: true });
} finally {
  await browser.close();
}
console.log("wrote", output);
