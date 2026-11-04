// What both ads share: units, easing, real footage as timed frames, the kolam, scenes, and the wipe that carries each cut.
const q = new URLSearchParams(location.search);
const W = +q.get("w") || 1920, H = +q.get("h") || 1080, portrait = H > W;
const u = Math.min(W, H) / 100;
document.documentElement.style.setProperty("--u", u + "px");
const stage = document.getElementById("stage");
const LOGO_SLIP = "M8 2h24a3 3 0 0 1 3 3v33l-3.75-3-3.75 3-3.75-3L20 38l-3.75-3-3.75 3-3.75-3L5 38V5a3 3 0 0 1 3-3Z";
const LOGO_R = "M14 8h8.6c4.5 0 7.4 2.6 7.4 6.6 0 2.9-1.5 5.1-4 6.1l4.7 8.3h-5.3l-4.2-7.7H18.6V29H14V8Zm4.6 4v5.3h3.6c1.9 0 3.1-1 3.1-2.7S24.1 12 22.2 12h-3.6Z";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const outExpo = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const outBack = (k) => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const inOut = (k) => k * k * (3 - 2 * k);
const el = (parent, tag, css, html) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html !== undefined) e.innerHTML = html; parent.appendChild(e); return e; };
const px = (n) => n * u + "px";

/** Slams text in: big to normal, with a quick fade. */
function slam(e, t, at, from = 1.7) {
  const k = prog(t, at, at + 0.22);
  e.style.opacity = k > 0 ? Math.min(1, k * 3) : 0;
  e.style.transform = (e.dataset.base || "") + ` scale(${from + (1 - from) * outExpo(k)})`;
}
function rise(e, t, at, dist = 4) {
  const k = outExpo(prog(t, at, at + 0.4));
  e.style.opacity = k;
  e.style.transform = (e.dataset.base || "") + ` translateY(${(1 - k) * dist * u}px)`;
}

// ---- real footage, as frames with their times
const clips = {};
let clipDir = "out/clips";
async function loadClip(name) { clips[name] = await (await fetch(`${clipDir}/${name}/index.json`)).json(); }
function frameAt(name, sec) {
  const c = clips[name];
  let lo = 0, hi = c.frames.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c.frames[m].t <= sec) lo = m; else hi = m - 1; }
  return `${clipDir}/${name}/${c.frames[lo].file}`;
}
const pending = [];
function show(img, src) {
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  img.src = src;
  pending.push(img.decode().catch(() => {}));
}

// ---- the kolam, drawn one line as in the real thing
function kolamPath(cols, rows, cell) {
  const pts = []; let x = 0, y = 1, dx = 1, dy = 1;
  do { pts.push([x * cell / 2, y * cell / 2]); x += dx; y += dy; if (x <= 0 || x >= cols * 2) dx = -dx; if (y <= 0 || y >= rows * 2) dy = -dy; } while (!(x === 0 && y === 1 && dx === 1 && dy === 1));
  const mid = (a, b) => `${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}`;
  let d = `M ${mid(pts[pts.length - 1], pts[0])}`;
  pts.forEach((p, i) => { d += ` Q ${p[0]} ${p[1]} ${mid(p, pts[(i + 1) % pts.length])}`; });
  const dots = []; for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) dots.push([(c + .5) * cell, (r + .5) * cell]);
  return { d, dots, w: cols * cell, h: rows * cell };
}
function kolam(parent, cols, rows, css, color, opacity) {
  const k = kolamPath(cols, rows, 40);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `-6 -6 ${k.w + 12} ${k.h + 12}`);
  svg.style.cssText = "position:absolute;" + css + `;opacity:${opacity}`;
  for (const [x, y] of k.dots) { const c = document.createElementNS(ns, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 2.6); c.setAttribute("fill", color); svg.appendChild(c); }
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", k.d); p.setAttribute("fill", "none"); p.setAttribute("stroke", color); p.setAttribute("stroke-width", 3); p.setAttribute("stroke-linecap", "round"); p.setAttribute("pathLength", 1); p.setAttribute("stroke-dasharray", 1);
  svg.appendChild(p); parent.appendChild(svg);
  return (k2) => p.setAttribute("stroke-dashoffset", 1 - k2);
}

const scenes = [];
function scene(start, end, bg, build) {
  const root = el(stage, "div", `background:${bg}`); root.className = "scene";
  const update = build(root);
  scenes.push({ start, end, root, update });
}

/** Wires up window.seek and window.ready. Each cut is a [time, colour, colour] wipe. */
function startAd({ dir, names, cuts }) {
  clipDir = dir;
  const wipe = el(stage, "div"); wipe.id = "wipe";
  const wipe2 = el(stage, "div"); wipe2.id = "wipe2";
  window.seek = async (t) => {
    for (const s of scenes) {
      const on = t >= s.start && t < s.end;
      s.root.style.display = on ? "block" : "none";
      if (on) s.update(t - s.start);
    }
    let shown = false;
    for (const [c, a, b] of cuts) {
      const k = (t - c + .22) / .44;
      if (k <= 0 || k >= 1) continue;
      shown = true;
      const x = (inOut(k) * 2 - 1) * 112;
      wipe.style.display = wipe2.style.display = "block";
      wipe.style.background = a; wipe2.style.background = b;
      wipe.style.transform = `translateX(${x}%) skewX(-12deg)`;
      wipe2.style.transform = `translateX(${x - 14}%) skewX(-12deg)`;
    }
    if (!shown) wipe.style.display = wipe2.style.display = "none";
    await Promise.all(pending.splice(0));
    // A font's first use starts its download, and until it lands the text is invisible: never let a frame catch that.
    void document.body.offsetHeight;
    await document.fonts.ready;
  };
  window.ready = (async () => {
    await Promise.all(names.map(loadClip));
    await document.fonts.ready;
    await Promise.all(["900 40px 'Catamaran'", "900 40px 'Big Shoulders'", "700 20px 'JetBrains Mono'", "700 20px 'Noto Sans Tamil'", "700 20px 'Plus Jakarta Sans'"].map((f) => document.fonts.load(f, "அa")));
    return true;
  })();
}
