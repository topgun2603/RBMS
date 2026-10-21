import { mix, shade, tint } from "./color";
import type { Ctx, Palette, StockTrade } from "./stock-art";

/*
 * Flat illustrations of what each trade sells, drawn in a 400 × 400 box standing on a ground line at y = 380. No
 * outlines: shapes are lit with soft gradients (cylinders get a bright side stripe, fabric a fold shade) so they read
 * as artwork. Colours come from the palette: the brand for the hero object, gold / steel for metal, `nat()` for things
 * that have a natural colour (tomatoes, leaves, coffee).
 */

export interface Motif {
  name: string;
  /** Where the drawing starts (y) and how wide it is, in the 400 box: placement scales it to fill its frame. */
  top: number;
  width: number;
  /** Contact-shadow half-width as a share of the box (default 0.6). */
  footprint?: number;
  draw: (c: Ctx, P: Palette) => string;
}

// ---------------------------------------------------------------- tiny helpers

const n = (v: number) => Math.round(v * 10) / 10;
const attrs = (extra?: string) => (extra ? ` ${extra}` : "");
const rect = (x: number, y: number, w: number, h: number, rx: number, fill: string, extra?: string) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rx)}" fill="${fill}"${attrs(extra)}/>`;
const circ = (cx: number, cy: number, r: number, fill: string, extra?: string) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${attrs(extra)}/>`;
const ell = (cx: number, cy: number, rx: number, ry: number, fill: string, extra?: string) =>
  `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}"${attrs(extra)}/>`;
const path = (d: string, fill: string, extra?: string) => `<path d="${d}" fill="${fill}"${attrs(extra)}/>`;
const line = (d: string, stroke: string, w: number, extra?: string) =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${attrs(extra)}/>`;
const g = (transform: string, body: string) => `<g transform="${transform}">${body}</g>`;

/** Cylinder shading left → right: shade, highlight, body, deep edge. */
const cyl = (c: Ctx, base: string, hi = 0.45) => c.lin([shade(base, 0.18), tint(base, hi), base, shade(base, 0.32)], 0, 0, 1, 0);
const metal = (c: Ctx, P: Palette) => c.lin([P.steelDeep, "#ffffff", P.steel, P.steelDeep], 0, 0, 1, 0);
const goldG = (c: Ctx, P: Palette) => c.lin([P.goldDeep, tint(P.gold, 0.45), P.gold, P.goldDeep], 0, 0, 1, 1);
const down = (c: Ctx, top: string, bottom: string) => c.lin([top, bottom]);
/** A small round highlight dot (gloss on fruit, beads, gems). */
const gloss = (cx: number, cy: number, r: number, op = 0.7) => circ(cx, cy, r, "#ffffff", `opacity="${op}"`);
/** A leaf pointing along `angle` degrees from its stem at (x, y). */
const leaf = (x: number, y: number, len: number, angle: number, fill: string, vein: string) =>
  g(
    `translate(${n(x)} ${n(y)}) rotate(${n(angle)})`,
    path(`M0 0C${n(len * 0.3)} ${n(-len * 0.32)} ${n(len * 0.75)} ${n(-len * 0.3)} ${n(len)} 0C${n(len * 0.75)} ${n(len * 0.3)} ${n(len * 0.3)} ${n(len * 0.32)} 0 0Z`, fill) +
      line(`M${n(len * 0.08)} 0H${n(len * 0.85)}`, vein, Math.max(1, len * 0.03), `opacity=".55"`),
  );

// ---------------------------------------------------------------- fashion

const sareeStack: Motif = {
  name: "Silk sarees",
  top: 182,
  width: 296,
  footprint: 0.75,
  draw: (c, P) => {
    const fold = (x: number, y: number, w: number, base: string, border: string) => {
      const h = 46;
      return (
        rect(x, y, w, h, 9, down(c, tint(base, 0.18), shade(base, 0.12))) +
        rect(x, y + h - 14, w, 10, 3, border) +
        rect(x, y + h - 18, w, 2.5, 1, border, `opacity=".8"`) +
        // dotted zari motifs in the border
        Array.from({ length: Math.floor(w / 18) }, (_, i) => circ(x + 12 + i * 18, y + h - 9, 2.1, tint(border, 0.6))).join("") +
        // the folded end on the right
        path(`M${n(x + w - 30)} ${n(y)}H${n(x + w - 9)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + 9)}V${n(y + h - 9)}Q${n(x + w)} ${n(y + h)} ${n(x + w - 9)} ${n(y + h)}H${n(x + w - 30)}Q${n(x + w - 40)} ${n(y + h / 2)} ${n(x + w - 30)} ${n(y)}Z`, shade(base, 0.25), `opacity=".55"`) +
        rect(x + 10, y + 7, w * 0.55, 3, 1.5, "#ffffff", `opacity=".22"`)
      );
    };
    const pallu = path(
      "M118 214C104 250 128 286 112 330C106 348 118 366 136 372L176 372C160 350 168 320 162 292C156 262 164 236 156 214Z",
      c.lin([tint(P.brand, 0.25), P.brand, P.deep], 0, 0, 1, 1),
    );
    const palluBorder = line("M120 362C138 368 160 370 174 368", P.gold, 7) + line("M124 352C140 358 158 360 170 358", P.gold, 2, `opacity=".8"`);
    const tassels = [128, 142, 156, 170].map((x) => line(`M${x} 372V384`, P.gold, 2.4) + circ(x, 386, 3, P.goldDeep)).join("");
    return (
      fold(52, 326, 296, P.brand, P.gold) +
      fold(66, 278, 268, P.accent, P.gold) +
      fold(80, 230, 240, P.deep, P.gold) +
      fold(96, 182, 208, mix(P.brand, P.gold, 0.35), P.goldDeep) +
      pallu +
      palluBorder +
      tassels
    );
  },
};

const kurtaHanger: Motif = {
  name: "Kurta on a hanger",
  top: 16,
  width: 240,
  footprint: 0.45,
  draw: (c, P) => {
    const hook = line("M200 72C200 52 222 50 222 34C222 22 210 16 200 22", P.steelDeep, 6);
    const bar = line("M200 72L112 112M200 72L288 112", P.steelDeep, 7) + line("M108 114H292", P.steelDeep, 7);
    const body = path(
      "M150 104L118 116L80 214L112 226L128 182L118 366Q200 380 282 366L272 182L288 226L320 214L282 116L250 104Q236 132 200 134Q164 132 150 104Z",
      c.lin([tint(P.brand, 0.2), P.brand, shade(P.brand, 0.18)], 0, 0, 1, 1),
    );
    const neck = path("M150 104Q164 132 200 134Q236 132 250 104L238 102Q228 122 200 124Q172 122 162 102Z", P.gold);
    const placket = line("M200 134V210", P.gold, 4) + [150, 168, 186].map((y) => circ(200, y, 3.4, tint(P.gold, 0.5))).join("");
    const hem = path("M120 344Q200 358 280 344L282 366Q200 380 118 366Z", P.gold) + Array.from({ length: 9 }, (_, i) => circ(136 + i * 16, 359 + Math.sin(i) * 1.5, 2.4, P.goldDeep)).join("");
    const cuffs = path("M80 214L112 226L116 214L85 202Z", P.gold) + path("M320 214L288 226L284 214L315 202Z", P.gold);
    const fold = path("M200 210C196 270 204 320 198 370", "none", `stroke="${shade(P.brand, 0.3)}" stroke-width="3" opacity=".35"`);
    const buta = [
      [160, 250],
      [240, 280],
      [168, 316],
      [236, 222],
    ]
      .map(([x, y]) => path(`M${x} ${y! - 7}C${x! + 7} ${y! - 3} ${x! + 5} ${y! + 6} ${x} ${y! + 7}C${x! - 6} ${y! + 4} ${x! - 4} ${y! - 2} ${x} ${y! - 7}Z`, P.gold, `opacity=".75"`))
      .join("");
    return hook + bar + body + fold + neck + placket + cuffs + hem + buta;
  },
};

const potli: Motif = {
  name: "Potli bag",
  top: 60,
  width: 170,
  footprint: 0.42,
  draw: (c, P) => {
    const cord = line("M168 150C150 100 176 60 200 60C224 60 250 100 232 150", P.gold, 5);
    const frill = path("M152 160C148 138 170 128 184 140C190 124 210 124 216 140C230 128 252 138 248 160Z", c.lin([tint(P.brand, 0.3), P.brand]));
    const bag = path("M150 160C96 190 92 300 128 344C150 372 250 372 272 344C308 300 304 190 250 160Z", c.rad([tint(P.brand, 0.35), P.brand, P.deep], 0.4, 0.35, 0.7));
    const tie = rect(146, 152, 108, 14, 7, P.gold);
    const motif =
      circ(200, 268, 36, "none", `stroke="${P.gold}" stroke-width="4"`) +
      circ(200, 268, 22, P.gold, `opacity=".9"`) +
      circ(200, 268, 9, P.accent) +
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return circ(200 + Math.cos(a) * 48, 268 + Math.sin(a) * 48, 3, tint(P.gold, 0.4));
      }).join("");
    const tassel = (x: number) => line(`M${x} 166C${x - 6} 200 ${x - 14} 220 ${x - 12} 240`, P.gold, 3) + path(`M${x - 20} 238H${x - 4}L${x - 6} 268H${x - 18}Z`, goldG(c, P));
    return cord + bag + frill + tie + motif + tassel(160) + gloss(160, 210, 10, 0.25);
  },
};

// ---------------------------------------------------------------- jewellery

const necklaceBust: Motif = {
  name: "Necklace on a stand",
  top: 50,
  width: 320,
  footprint: 0.78,
  draw: (c, P) => {
    const velvet = P.velvet;
    const bust = path(
      "M168 64Q168 50 182 50H218Q232 50 232 64V146Q234 186 290 208Q342 230 346 298V360H54V298Q58 230 110 208Q166 186 168 146Z",
      c.lin([tint(velvet, 0.2), velvet, shade(velvet, 0.35)], 0, 0, 1, 1),
    );
    const sheen = path("M182 60Q178 120 176 150Q170 196 116 222Q80 240 72 290", "none", `stroke="#ffffff" stroke-width="5" opacity=".12" stroke-linecap="round"`);
    const plinth = rect(40, 356, 320, 26, 6, goldG(c, P)) + rect(40, 356, 320, 5, 2, "#ffffff", `opacity=".25"`);
    const beads = (rx: number, ry: number, cy: number, count: number, r: number, from = 0.15, to = 0.85) =>
      Array.from({ length: count }, (_, i) => {
        const t = from + ((to - from) * i) / (count - 1);
        const a = Math.PI * t;
        const x = 200 - Math.cos(a) * rx;
        const y = cy + Math.sin(a) * ry;
        return circ(x, y, r, goldG(c, P)) + gloss(x - r * 0.3, y - r * 0.35, r * 0.3, 0.8);
      }).join("");
    const strand1 = beads(64, 66, 150, 15, 6.5);
    const strand2 = beads(84, 98, 150, 19, 5.2, 0.12, 0.88);
    const gems = [0.3, 0.5, 0.7]
      .map((t) => {
        const a = Math.PI * t;
        return circ(200 - Math.cos(a) * 84, 150 + Math.sin(a) * 98, 7, c.rad([tint(P.gem, 0.5), P.gem], 0.35, 0.35, 0.7)) + gloss(200 - Math.cos(a) * 84 - 2, 150 + Math.sin(a) * 98 - 2.5, 2);
      })
      .join("");
    const pendant =
      path("M200 246C214 262 222 276 222 290C222 304 212 314 200 314C188 314 178 304 178 290C178 276 186 262 200 246Z", goldG(c, P)) +
      path("M200 260C209 271 213 281 213 290C213 299 207 305 200 305C193 305 187 299 187 290C187 281 191 271 200 260Z", c.rad([tint(P.gem, 0.55), P.gem, shade(P.gem, 0.35)], 0.4, 0.35, 0.7)) +
      gloss(195, 282, 3.5) +
      [0, 1, 2].map((i) => circ(188 + i * 12, 322, 4, P.cream) + gloss(187 + i * 12, 320.5, 1.3)).join("");
    return bust + sheen + plinth + strand1 + strand2 + gems + pendant;
  },
};

const ringBox: Motif = {
  name: "Ring in a box",
  top: 110,
  width: 232,
  footprint: 0.6,
  draw: (c, P) => {
    const box = P.velvet;
    const lid = path("M96 196L120 110H280L304 196Z", c.lin([tint(box, 0.18), box])) + path("M112 188L132 122H268L288 188Z", c.lin([shade(P.velvet, 0.1), tint(P.velvet, 0.25)]), `opacity=".9"`);
    const base = rect(84, 236, 232, 136, 16, c.lin([tint(box, 0.12), shade(box, 0.3)])) + rect(84, 196, 232, 52, 12, c.lin([tint(P.velvet, 0.3), tint(P.velvet, 0.1)]));
    const slit = path("M120 222Q200 238 280 222", "none", `stroke="${shade(P.velvet, 0.5)}" stroke-width="7" stroke-linecap="round"`);
    const trim = rect(84, 300, 232, 6, 2, P.gold, `opacity=".9"`);
    const band = ell(200, 196, 40, 44, "none", `stroke="${goldG(c, P)}" stroke-width="12"`) + path("M166 176A40 44 0 0 1 200 152", "none", `stroke="#ffffff" stroke-width="3" opacity=".5" stroke-linecap="round"`);
    const ice = mix("#e6f3ff", P.brand, 0.08);
    const gem =
      path("M174 150L186 132H214L226 150L200 178Z", ice) +
      path("M174 150H226L200 178Z", mix(ice, P.steelDeep, 0.25)) +
      path("M186 132L194 150H206L214 132Z", "#ffffff", `opacity=".9"`) +
      path("M194 150L200 178L206 150Z", "#ffffff", `opacity=".55"`) +
      rect(184, 150, 32, 6, 2, P.gold);
    const shine = `<g opacity=".95">${[
      [232, 124, 9],
      [166, 120, 6],
    ]
      .map(([x, y, r]) => `<path d="M${x} ${y! - r!}L${x! + r! * 0.22} ${y! - r! * 0.22}L${x! + r!} ${y}L${x! + r! * 0.22} ${y! + r! * 0.22}L${x} ${y! + r!}L${x! - r! * 0.22} ${y! + r! * 0.22}L${x! - r!} ${y}L${x! - r! * 0.22} ${y! - r! * 0.22}Z" fill="#ffffff"/>`)
      .join("")}</g>`;
    return lid + base + trim + slit + band + gem + shine;
  },
};

const jhumka: Motif = {
  name: "Jhumka earrings",
  top: 180,
  width: 250,
  footprint: 0.55,
  draw: (c, P) => {
    const one = (x: number, scale: number) => {
      const bell =
        path("M-46 0C-46 -58 -20 -76 0 -76C20 -76 46 -58 46 0Z", goldG(c, P)) +
        path("M-30 -14C-30 -48 -14 -62 0 -62C14 -62 30 -48 30 -14Z", "none", `stroke="${P.goldDeep}" stroke-width="2.5" opacity=".6"`) +
        path("M-16 -40C-12 -56 -4 -62 6 -62", "none", `stroke="#ffffff" stroke-width="4" opacity=".45" stroke-linecap="round"`) +
        rect(-48, -4, 96, 9, 4, P.goldDeep) +
        Array.from({ length: 9 }, (_, i) => {
          const bx = -40 + i * 10;
          return line(`M${bx} 5V14`, P.gold, 1.6) + circ(bx, 18, 4.4, P.cream) + gloss(bx - 1.3, 16.6, 1.4);
        }).join("") +
        circ(0, -32, 9, c.rad([tint(P.gem, 0.5), P.gem], 0.35, 0.35, 0.7)) +
        gloss(-2.5, -35, 2.4);
      const top =
        Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return circ(Math.cos(a) * 15, -150 + Math.sin(a) * 15, 7, goldG(c, P));
        }).join("") +
        circ(0, -150, 10, c.rad([tint(P.gem, 0.5), P.gem], 0.35, 0.35, 0.7)) +
        gloss(-3, -153, 2.6) +
        [-124, -110, -96, -84].map((y) => circ(0, y, 4, goldG(c, P))).join("");
      return g(`translate(${x} 352) scale(${scale})`, top + bell);
    };
    return one(140, 1) + one(262, 0.92);
  },
};

// ---------------------------------------------------------------- tailoring

const sewingMachine: Motif = {
  name: "Sewing machine",
  top: 92,
  width: 340,
  footprint: 0.8,
  draw: (c, P) => {
    const body = P.dark ? mix(P.brand, "#000000", 0.35) : P.deep;
    const bodyG = c.lin([tint(body, 0.22), body, shade(body, 0.3)]);
    const base = rect(40, 330, 320, 40, 10, c.lin([tint(P.brand, 0.12), shade(P.brand, 0.25)])) + rect(40, 330, 320, 6, 3, "#ffffff", `opacity=".18"`);
    const plate = rect(96, 318, 110, 14, 3, metal(c, P));
    const pillar = path("M262 330V196Q262 170 288 170H300Q322 170 322 196V330Z", bodyG);
    const arm = path("M96 148Q96 120 124 120H296Q326 120 326 150V196Q326 210 312 210H150Q136 210 132 224V232H96Z", bodyG);
    const head = path("M92 132Q92 120 104 120H146V286Q146 296 136 296H102Q92 296 92 286Z", c.lin([tint(body, 0.28), body], 0, 0, 1, 0));
    const decal =
      line("M160 150H292", P.gold, 4) +
      line("M168 162H284", P.gold, 1.6, `opacity=".8"`) +
      [190, 220, 250].map((x) => path(`M${x} 182C${x + 8} 174 ${x + 16} 182 ${x + 8} 190C${x} 198 ${x - 8} 190 ${x} 182Z`, P.gold, `opacity=".8"`)).join("") +
      rect(100, 200, 40, 8, 3, P.gold, `opacity=".85"`);
    const needle = line("M118 296V322", P.steel, 3) + rect(110, 290, 16, 10, 2, metal(c, P)) + line("M124 300L128 322", P.steelDeep, 2);
    const wheel = circ(334, 178, 40, metal(c, P)) + circ(334, 178, 30, "none", `stroke="${P.steelDeep}" stroke-width="3" opacity=".5"`) + circ(334, 178, 9, P.steelDeep) + [0, 60, 120].map((a) => g(`rotate(${a} 334 178)`, rect(331, 150, 6, 56, 3, P.steelDeep, `opacity=".55"`))).join("");
    const spool = rect(232, 92, 30, 8, 2, P.cream) + rect(236, 100, 22, 22, 3, c.lin([P.accent, shade(P.accent, 0.2)], 0, 0, 1, 0)) + rect(232, 118, 30, 6, 2, P.cream);
    const thread = line("M246 96C230 80 190 100 160 112C130 124 118 160 118 200V290", P.accent, 1.6, `opacity=".9"`);
    const cloth = path("M40 348Q90 336 150 346T262 340L268 370H40Z", c.lin([tint(P.accent, 0.2), P.accent]), `opacity=".95"`) + line("M60 356Q110 346 160 354T250 352", P.brand, 2, `stroke-dasharray="6 6" opacity=".6"`);
    return base + cloth + plate + pillar + arm + head + decal + needle + wheel + spool + thread + gloss(110, 140, 6, 0.25);
  },
};

const spools: Motif = {
  name: "Thread spools",
  top: 226,
  width: 250,
  footprint: 0.7,
  draw: (c, P) => {
    const wood = P.nat("#c99a63");
    const spool = (x: number, y: number, h: number, col: string) => {
      const w = 64;
      return (
        rect(x - w / 2 - 6, y - h, w + 12, 14, 5, c.lin([tint(wood, 0.2), shade(wood, 0.15)])) +
        rect(x - w / 2, y - h + 12, w, h - 24, 4, cyl(c, col, 0.4)) +
        Array.from({ length: Math.floor((h - 30) / 7) }, (_, i) => line(`M${x - w / 2 + 2} ${y - h + 18 + i * 7}H${x + w / 2 - 2}`, shade(col, 0.2), 1.2, `opacity=".45"`)).join("") +
        rect(x - w / 2 - 6, y - 14, w + 12, 14, 5, c.lin([tint(wood, 0.1), shade(wood, 0.25)]))
      );
    };
    const needle = g("rotate(-28 290 200)", path("M286 110L294 110L292 300L290 312L288 300Z", metal(c, P)) + ell(290, 124, 2, 8, P.paper));
    const thread = line("M290 120C330 140 340 210 300 240C260 270 250 320 210 330", P.brand, 2.4, `opacity=".85"`);
    return spool(110, 380, 150, P.brand) + spool(196, 380, 200, P.accent === P.paper ? P.light : P.accent) + spool(280, 380, 120, P.gold) + thread + needle;
  },
};

const tape: Motif = {
  name: "Measuring tape",
  top: 198,
  width: 320,
  footprint: 0.78,
  draw: (c, P) => {
    const yellow = P.nat("#f0c24b");
    const ribbon = path("M190 330C120 330 60 300 60 250C60 210 110 196 140 222", "none", `stroke="${yellow}" stroke-width="30" stroke-linecap="butt"`);
    const ribbonFloor = path("M226 352H372V380H226Z", yellow) + Array.from({ length: 15 }, (_, i) => line(`M${232 + i * 9.5} 352V${i % 5 === 0 ? 366 : 360}`, shade(yellow, 0.55), 1.6)).join("");
    const tick = Array.from({ length: 12 }, (_, i) => {
      const t = i / 11;
      const a = Math.PI * 0.5 + t * Math.PI * 1.15;
      return line(`M${n(130 + Math.cos(a) * 62)} ${n(268 - Math.sin(a) * -58)}L${n(130 + Math.cos(a) * 52)} ${n(268 - Math.sin(a) * -48)}`, shade(yellow, 0.5), 1.4, `opacity=".7"`);
    }).join("");
    const case_ = circ(260, 290, 92, c.rad([tint(P.brand, 0.3), P.brand, P.deep], 0.38, 0.32, 0.75)) + circ(260, 290, 62, "none", `stroke="${tint(P.brand, 0.4)}" stroke-width="3" opacity=".6"`) + circ(260, 290, 22, metal(c, P)) + circ(260, 290, 8, P.steelDeep);
    const mouth = rect(180, 352, 52, 28, 6, shade(P.brand, 0.35));
    return ribbon + tick + ribbonFloor + case_ + mouth + gloss(226, 250, 12, 0.18);
  },
};

// ---------------------------------------------------------------- restaurant

const thali: Motif = {
  name: "South Indian thali",
  top: 172,
  width: 372,
  footprint: 0.9,
  draw: (c, P) => {
    const plate = ell(200, 316, 186, 66, metal(c, P)) + ell(200, 310, 166, 54, c.lin([tint(P.steel, 0.5), P.steel])) + ell(200, 312, 166, 54, "none", `stroke="${P.steelDeep}" stroke-width="1.5" opacity=".35"`);
    const leafG = P.nat("#4f8a35");
    const banana = path("M70 318C110 268 290 262 336 300C300 344 120 352 70 318Z", c.lin([tint(leafG, 0.2), leafG])) + line("M76 316C150 300 260 296 330 302", shade(leafG, 0.3), 2, `opacity=".5"`);
    const katori = (x: number, y: number, fill: string) =>
      ell(x, y + 6, 30, 12, P.steelDeep, `opacity=".35"`) + path(`M${x - 30} ${y}Q${x - 28} ${y + 22} ${x} ${y + 22}Q${x + 28} ${y + 22} ${x + 30} ${y}Z`, metal(c, P)) + ell(x, y, 30, 10, P.steel) + ell(x, y + 1, 25, 7.5, c.lin([tint(fill, 0.25), fill]));
    const bowls = katori(112, 270, P.nat("#e8b23c")) + katori(170, 256, P.nat("#c8572a")) + katori(234, 256, P.nat("#7da443")) + katori(292, 270, P.nat("#f4efe2"));
    const rice = path("M150 318C150 288 176 280 200 280C226 280 252 288 252 318Z", c.lin(["#ffffff", P.cream])) + Array.from({ length: 10 }, (_, i) => ell(162 + (i % 5) * 18, 300 + Math.floor(i / 5) * 9, 4, 1.6, P.steel, `opacity=".7"`)).join("");
    const papad = ell(304, 318, 40, 15, P.nat("#e8c98a")) + Array.from({ length: 7 }, (_, i) => circ(282 + i * 7, 316 + (i % 2) * 5, 1.4, P.nat("#a3743a"))).join("");
    const steam = [180, 214].map((x, i) => line(`M${x} 270C${x - 10} 250 ${x + 10} 236 ${x} 214C${x - 8} 198 ${x + 6} 186 ${x} 172`, P.mid, 3.5, `opacity="${0.55 - i * 0.15}"`)).join("");
    return plate + banana + bowls + rice + papad + steam;
  },
};

const filterCoffee: Motif = {
  name: "Filter coffee",
  top: 14,
  width: 216,
  footprint: 0.6,
  draw: (c, P) => {
    const coffee = P.nat("#7a4a2b");
    const dabara = path("M92 290Q96 352 150 368H250Q304 352 308 290Z", metal(c, P)) + ell(200, 290, 108, 18, P.steel) + ell(200, 292, 96, 13, c.lin([P.steelDeep, P.steel]));
    const tumbler = path("M140 132L160 316Q200 326 240 316L260 132Z", metal(c, P)) + [170, 188].map((y) => line(`M${144 + (y - 132) * 0.1} ${y}H${256 - (y - 132) * 0.1}`, P.steelDeep, 2.4, `opacity=".45"`)).join("");
    const rim = ell(200, 132, 60, 12, P.steel) + ell(200, 133, 52, 9, c.rad([tint(coffee, 0.55), coffee], 0.5, 0.4, 0.6));
    const froth = ell(190, 131, 18, 4, "#ffffff", `opacity=".35"`);
    const shine = path("M160 146L174 304", "none", `stroke="#ffffff" stroke-width="8" opacity=".55" stroke-linecap="round"`);
    const steam = [176, 204, 230].map((x, i) => line(`M${x} 112C${x - 12} 92 ${x + 12} 76 ${x} 56C${x - 10} 40 ${x + 8} 28 ${x} 14`, P.mid, 4, `opacity="${0.6 - i * 0.12}"`)).join("");
    return dabara + tumbler + shine + rim + froth + steam;
  },
};

const curryBowl: Motif = {
  name: "Clay bowl of curry",
  top: 108,
  width: 300,
  footprint: 0.68,
  draw: (c, P) => {
    const clay = P.nat("#b45a32");
    const bowl = path("M74 240Q80 352 200 360Q320 352 326 240Z", c.lin([shade(clay, 0.25), tint(clay, 0.2), clay, shade(clay, 0.35)], 0, 0, 1, 0));
    const rim = ell(200, 240, 128, 26, tint(clay, 0.12)) + ell(200, 242, 114, 20, c.lin([P.nat("#d9772f"), P.nat("#b04a1e")]));
    const swirl = path("M140 240C170 230 230 232 262 244", "none", `stroke="${P.cream}" stroke-width="5" opacity=".8" stroke-linecap="round"`);
    const herbs = [
      [170, 236, -20],
      [214, 232, 30],
      [244, 242, -60],
      [188, 248, 80],
    ]
      .map(([x, y, a]) => leaf(x!, y!, 18, a!, P.nat("#3f8a3a"), "#ffffff"))
      .join("");
    const band = path("M84 278Q200 300 316 278", "none", `stroke="${P.cream}" stroke-width="3" stroke-dasharray="2 9" opacity=".7" stroke-linecap="round"`);
    const spoon = path("M300 236L366 150", "none", `stroke="${metal(c, P)}" stroke-width="10" stroke-linecap="round"`) + ell(298, 240, 16, 9, P.steel, `transform="rotate(-52 298 240)"`);
    const steam = [170, 204, 236].map((x, i) => line(`M${x} 210C${x - 10} 190 ${x + 10} 174 ${x} 152C${x - 8} 136 ${x + 6} 124 ${x} 108`, P.mid, 4, `opacity="${0.55 - i * 0.12}"`)).join("");
    return steam + bowl + band + rim + swirl + herbs + spoon;
  },
};

// ---------------------------------------------------------------- cloud kitchen

const handi: Motif = {
  name: "Biryani handi",
  top: 62,
  width: 280,
  footprint: 0.7,
  draw: (c, P) => {
    const copper = P.nat("#b8662f");
    const pot = path("M110 170Q60 200 64 270Q70 350 150 370H250Q330 350 336 270Q340 200 290 170Z", c.lin([shade(copper, 0.3), tint(copper, 0.35), copper, shade(copper, 0.4)], 0, 0, 1, 0));
    const band = path("M70 250Q200 276 330 250L332 268Q200 294 68 268Z", goldG(c, P));
    const neck = rect(118, 150, 164, 30, 10, c.lin([shade(copper, 0.25), tint(copper, 0.3), shade(copper, 0.35)], 0, 0, 1, 0));
    const cloth = path("M104 156Q200 110 296 156L288 176Q200 150 112 176Z", c.lin([tint(P.brand, 0.2), P.brand])) + path("M150 132Q200 96 250 132Q232 150 200 148Q168 150 150 132Z", c.lin([tint(P.brand, 0.3), P.brand, P.deep]));
    const knot = path("M196 108C176 80 160 92 168 112C178 120 190 118 196 108Z", P.deep) + path("M204 108C224 80 240 92 232 112C222 120 210 118 204 108Z", P.deep) + circ(200, 110, 9, P.brand);
    const dough = path("M106 176Q200 196 294 176", "none", `stroke="${P.cream}" stroke-width="7" stroke-linecap="round"`);
    const steam = [150, 250].map((x) => line(`M${x} 120C${x - 10} 100 ${x + 10} 84 ${x} 62`, P.mid, 4, `opacity=".45"`)).join("");
    return steam + pot + band + neck + dough + cloth + knot + gloss(108, 230, 9, 0.25);
  },
};

const takeawayBag: Motif = {
  name: "Takeaway bag",
  top: 74,
  width: 236,
  footprint: 0.6,
  draw: (c, P) => {
    const kraft = P.nat("#c9a06a");
    const handles = line("M156 132C156 86 182 74 200 74C218 74 244 86 244 132", shade(kraft, 0.35), 7);
    const back = path("M108 132H292L302 160H98Z", shade(kraft, 0.2));
    const bag = path("M98 150H302L318 372H82Z", c.lin([tint(kraft, 0.15), kraft, shade(kraft, 0.18)], 0, 0, 1, 0));
    const fold = path("M98 150H302L300 176H100Z", shade(kraft, 0.12));
    const side = path("M282 176L318 372H290L270 176Z", shade(kraft, 0.22), `opacity=".7"`);
    const label =
      circ(196, 266, 54, c.lin([tint(P.brand, 0.2), P.brand])) +
      circ(196, 266, 44, "none", `stroke="${P.cream}" stroke-width="2.5" stroke-dasharray="3 6" stroke-linecap="round"`) +
      // fork and spoon
      line("M180 238V296", P.cream, 5) +
      line("M172 238V256Q172 264 180 264Q188 264 188 256V238", P.cream, 3.4) +
      ell(212, 248, 9, 13, P.cream) +
      line("M212 260V296", P.cream, 5);
    const sticker = rect(232, 168, 52, 22, 5, P.accent, `transform="rotate(8 258 179)"`);
    return handles + back + bag + fold + side + label + sticker;
  },
};

const noodleBox: Motif = {
  name: "Noodle box",
  top: 52,
  width: 250,
  footprint: 0.55,
  draw: (c, P) => {
    const box = path("M118 170H282L258 372H142Z", c.lin([P.brand, shade(P.brand, 0.25)], 0, 0, 1, 0));
    const flaps = path("M118 170L92 120L166 150Z", tint(P.brand, 0.2)) + path("M282 170L308 120L234 150Z", shade(P.brand, 0.15)) + path("M150 170L176 132H224L250 170Z", tint(P.brand, 0.3));
    const noodles = path("M136 172C150 140 250 140 264 172Z", P.nat("#f1c565")) + [150, 172, 196, 220, 244].map((x) => line(`M${x} 170C${x + 6} 156 ${x - 4} 148 ${x + 4} 140`, P.nat("#d8a23c"), 3)).join("");
    const handle = line("M150 182C150 140 250 140 250 182", P.steelDeep, 3, `opacity=".8"`);
    const sticks = line("M232 168L330 52", P.nat("#b98a52"), 7) + line("M246 172L346 64", P.nat("#a7783f"), 7);
    const emblem = circ(200, 270, 30, P.cream, `opacity=".95"`) + circ(200, 270, 20, "none", `stroke="${P.brand}" stroke-width="5"`) + path("M188 270H212", "none", `stroke="${P.brand}" stroke-width="5" stroke-linecap="round"`);
    return sticks + noodles + flaps + box + handle + emblem;
  },
};

// ---------------------------------------------------------------- grocery

const basket: Motif = {
  name: "Grocery basket",
  top: 92,
  width: 290,
  footprint: 0.75,
  draw: (c, P) => {
    const wicker = P.nat("#c8955a");
    const handle = path("M96 214C96 92 304 92 304 214", "none", `stroke="${shade(wicker, 0.2)}" stroke-width="14" stroke-linecap="round"`);
    const bread = g("rotate(-24 150 170)", rect(96, 150, 140, 40, 20, c.lin([P.nat("#e7b46a"), P.nat("#b97a35")])) + [120, 150, 180, 210].map((x) => line(`M${x} 158L${x + 12} 182`, P.nat("#f3d9a6"), 3)).join(""));
    const bottle = rect(232, 112, 40, 110, 12, c.lin(["#ffffff", P.cream], 0, 0, 1, 0)) + rect(240, 96, 24, 22, 5, P.brand) + rect(232, 150, 40, 30, 3, P.brand, `opacity=".85"`);
    const greens = [
      [170, 214, -110],
      [190, 214, -80],
      [210, 214, -60],
      [150, 214, -140],
    ]
      .map(([x, y, a]) => leaf(x!, y!, 70, a!, P.nat(a! < -100 ? "#4f8f3a" : "#67a845"), "#ffffff"))
      .join("");
    const apple = circ(118, 206, 26, c.rad([P.nat("#ef6b55"), P.nat("#b8281d")], 0.35, 0.35, 0.7)) + gloss(110, 196, 6, 0.5) + leaf(118, 182, 16, -60, P.nat("#4f8f3a"), "#fff");
    const body = path("M70 210H330L304 372H96Z", c.lin([tint(wicker, 0.15), wicker, shade(wicker, 0.2)], 0, 0, 1, 0));
    const weave =
      Array.from({ length: 5 }, (_, i) => line(`M${74 + i * 1.5} ${236 + i * 28}H${326 - i * 1.5}`, shade(wicker, 0.28), 3, `opacity=".6"`)).join("") +
      Array.from({ length: 11 }, (_, i) => line(`M${90 + i * 22} 214L${104 + i * 19.5} 370`, shade(wicker, 0.22), 2, `opacity=".45"`)).join("");
    const rim = rect(62, 204, 276, 20, 10, c.lin([tint(wicker, 0.3), shade(wicker, 0.1)]));
    const tag = rect(242, 266, 54, 30, 6, P.brand, `transform="rotate(-6 269 281)"`) + circ(252, 276, 3, P.cream);
    return handle + greens + bread + bottle + apple + body + weave + rim + tag;
  },
};

const jars: Motif = {
  name: "Pantry jars",
  top: 130,
  width: 330,
  footprint: 0.8,
  draw: (c, P) => {
    const jar = (x: number, w: number, h: number, fill: string, grain: string, lid: string) => {
      const y = 380 - h;
      return (
        rect(x, y + 22, w, h - 22, 18, c.lin([tint(fill, 0.25), fill, shade(fill, 0.15)], 0, 0, 1, 0)) +
        Array.from({ length: Math.floor((w * (h - 50)) / 260) }, (_, i) => circ(x + 12 + ((i * 37) % (w - 24)), y + 50 + ((i * 53) % (h - 70)), 2.4, grain, `opacity=".55"`)).join("") +
        rect(x - 2, y + 22, w + 4, h - 22, 18, "#ffffff", `opacity=".14"`) +
        rect(x + 10, y + 34, 9, h - 60, 4.5, "#ffffff", `opacity=".45"`) +
        rect(x + 6, y, w - 12, 26, 7, c.lin([tint(lid, 0.2), shade(lid, 0.2)])) +
        rect(x + w * 0.22, y + h * 0.48, w * 0.56, h * 0.22, 5, P.cream, `opacity=".92"`) +
        rect(x + w * 0.3, y + h * 0.54, w * 0.4, 4, 2, lid, `opacity=".7"`)
      );
    };
    return jar(40, 96, 190, P.nat("#e8b23c"), P.nat("#b77d15"), P.brand) + jar(152, 104, 250, P.nat("#f3eadb"), P.nat("#b9ab92"), P.deep) + jar(272, 90, 160, P.nat("#c0392b"), P.nat("#7c1d14"), P.gold);
  },
};

const groceryBag: Motif = {
  name: "Shopping bag of groceries",
  top: 40,
  width: 240,
  footprint: 0.6,
  draw: (c, P) => {
    const kraft = P.nat("#cfa874");
    const baguette = g("rotate(14 230 140)", rect(210, 40, 42, 200, 21, c.lin([P.nat("#e7b46a"), P.nat("#b0702e")], 0, 0, 1, 0)) + [70, 100, 130, 160].map((y) => line(`M218 ${y}L244 ${y + 12}`, P.nat("#f3d9a6"), 3)).join(""));
    const greens = [-120, -95, -70].map((a, i) => leaf(150 + i * 10, 190, 90, a, P.nat(i === 1 ? "#5b9c3f" : "#4b8a35"), "#fff")).join("");
    const carrot = g("rotate(-16 120 170)", path("M108 100L132 100L120 230Z", c.lin([P.nat("#f08c2e"), P.nat("#d1661a")], 0, 0, 1, 0))) + leaf(116, 104, 30, -110, P.nat("#4b8a35"), "#fff") + leaf(120, 104, 26, -70, P.nat("#5b9c3f"), "#fff");
    const bag = path("M84 176H316L300 376H100Z", c.lin([tint(kraft, 0.2), kraft, shade(kraft, 0.2)], 0, 0, 1, 0));
    const lip = path("M84 176H316L312 198H88Z", shade(kraft, 0.12));
    const label = rect(138, 246, 124, 70, 10, P.brand) + rect(152, 264, 96, 7, 3.5, P.cream, `opacity=".85"`) + rect(152, 282, 64, 7, 3.5, P.cream, `opacity=".6"`);
    return carrot + greens + baguette + bag + lip + label;
  },
};

// ---------------------------------------------------------------- fresh produce

const crate: Motif = {
  name: "Crate of tomatoes",
  top: 116,
  width: 310,
  footprint: 0.8,
  draw: (c, P) => {
    const wood = P.nat("#c08a50");
    const tomato = (x: number, y: number, r: number) =>
      circ(x, y, r, c.rad([P.nat("#f0644a"), P.nat("#c62f1f"), P.nat("#8f1d12")], 0.35, 0.35, 0.75)) +
      gloss(x - r * 0.35, y - r * 0.38, r * 0.2, 0.55) +
      path(`M${x} ${y - r + 2}l-9 -3l6 7l-8 5l10 -2l1 9l3 -9l9 3l-6 -7l8 -5l-10 2z`, P.nat("#3f7d2c"));
    const pile = [
      [100, 220, 34],
      [164, 210, 36],
      [232, 214, 35],
      [296, 222, 33],
      [134, 180, 32],
      [200, 172, 34],
      [264, 182, 32],
      [168, 146, 30],
      [234, 148, 30],
    ]
      .map(([x, y, r]) => tomato(x!, y!, r!))
      .join("");
    const back = rect(60, 216, 280, 24, 4, shade(wood, 0.35));
    const planks = [0, 1, 2].map((i) => rect(52, 238 + i * 46, 296, 38, 5, c.lin([tint(wood, 0.18), shade(wood, 0.1)]))).join("");
    const grainLines = [0, 1, 2].map((i) => line(`M70 ${256 + i * 46}C140 ${250 + i * 46} 220 ${262 + i * 46} 330 ${254 + i * 46}`, shade(wood, 0.3), 1.6, `opacity=".45"`)).join("");
    const posts = rect(46, 228, 24, 152, 5, shade(wood, 0.2)) + rect(330, 228, 24, 152, 5, shade(wood, 0.25));
    const stamp = rect(162, 290, 76, 28, 6, P.brand, `opacity=".9"`) + rect(176, 301, 48, 6, 3, P.cream, `opacity=".8"`);
    return back + pile + planks + grainLines + posts + stamp;
  },
};

const veggies: Motif = {
  name: "Carrots and greens",
  top: 150,
  width: 300,
  footprint: 0.72,
  draw: (c, P) => {
    const carrot = (x: number, a: number, len: number) =>
      g(
        `rotate(${a} ${x} 360)`,
        path(`M${x - 18} ${360 - len}Q${x} ${360 - len - 8} ${x + 18} ${360 - len}L${x + 3} 372Q${x} 378 ${x - 3} 372Z`, c.lin([P.nat("#f59b3a"), P.nat("#e0731d"), P.nat("#bf5612")], 0, 0, 1, 0)) +
          [0.3, 0.5, 0.7].map((t) => line(`M${x - 14 + t * 8} ${360 - len * (1 - t)}h${10 - t * 6}`, P.nat("#b4510f"), 2, `opacity=".5"`)).join("") +
          leaf(x, 360 - len, 60, -100, P.nat("#4b8a35"), "#fff") +
          leaf(x, 360 - len, 52, -70, P.nat("#5fa042"), "#fff") +
          leaf(x, 360 - len, 46, -125, P.nat("#3f7a2c"), "#fff"),
      );
    const brinjal =
      path("M286 230C330 230 352 290 336 332C322 368 270 376 250 344C232 314 246 230 286 230Z", c.rad([P.nat("#8a4fa8"), P.nat("#5a2b70"), P.nat("#3b1a4a")], 0.35, 0.35, 0.75)) +
      gloss(276, 262, 8, 0.4) +
      path("M262 238C272 214 300 214 312 238C300 230 290 246 286 252C280 244 272 232 262 238Z", P.nat("#4b8a35")) +
      line("M286 228C286 214 292 204 300 198", P.nat("#3f7a2c"), 6);
    const bunch = path("M130 380C108 330 90 270 120 220C150 270 150 330 150 380Z", c.lin([P.nat("#6fb04a"), P.nat("#3f7a2c")])) + path("M150 380C150 320 170 260 200 240C210 300 186 350 170 380Z", c.lin([P.nat("#5fa042"), P.nat("#356a26")]));
    return bunch + carrot(160, -14, 190) + carrot(200, 6, 170) + carrot(232, 22, 150) + brinjal;
  },
};

const fruits: Motif = {
  name: "Mango, bananas and watermelon",
  top: 196,
  width: 360,
  footprint: 0.85,
  draw: (c, P) => {
    const melon =
      path("M40 376A110 110 0 0 1 260 376Z", P.nat("#3f8a3a")) +
      path("M52 376A98 98 0 0 1 248 376Z", P.nat("#f4f1d6")) +
      path("M62 376A88 88 0 0 1 238 376Z", c.rad([P.nat("#ff6b6b"), P.nat("#e0384a")], 0.5, 1, 0.9)) +
      [
        [110, 340],
        [150, 318],
        [190, 340],
        [130, 360],
        [170, 360],
        [150, 346],
      ]
        .map(([x, y]) => ell(x!, y!, 3, 5, "#2b1d1d"))
        .join("");
    const banana = (dx: number, rot: number) =>
      g(`rotate(${rot} 300 300) translate(${dx} 0)`, path("M230 210C260 300 330 330 380 300C340 310 280 280 252 206Z", c.lin([P.nat("#ffe066"), P.nat("#f2b705")], 0, 0, 1, 1)) + line("M232 208l-8 -14", P.nat("#7a5a1a"), 6));
    const mango =
      path("M230 250C270 196 360 210 368 280C374 340 320 378 270 370C220 362 200 296 230 250Z", c.rad([P.nat("#ffd24a"), P.nat("#f59e0b"), P.nat("#e56a1c")], 0.35, 0.3, 0.8)) +
      gloss(262, 254, 10, 0.4) +
      leaf(262, 228, 54, -40, P.nat("#3f8a3a"), "#fff") +
      line("M256 236L248 222", P.nat("#6b4a1f"), 5);
    return banana(-60, -18) + banana(-50, -8) + melon + mango;
  },
};

// ---------------------------------------------------------------- bakery

const cake: Motif = {
  name: "Celebration cake",
  top: 124,
  width: 284,
  footprint: 0.66,
  draw: (c, P) => {
    const stand = path("M150 380H250L232 362H168Z", metal(c, P)) + rect(190, 330, 20, 34, 4, metal(c, P)) + ell(200, 330, 142, 16, metal(c, P));
    const sponge = P.cream;
    const tier = (y: number, rx: number, h: number) =>
      rect(200 - rx, y - h, rx * 2, h, 4, c.lin([shade(sponge, 0.12), "#ffffff", sponge, shade(sponge, 0.18)], 0, 0, 1, 0)) +
      ell(200, y - h, rx, rx * 0.16, "#ffffff") +
      path(
        `M${200 - rx} ${y - h}` +
          Array.from({ length: 8 }, (_, i) => {
            const x0 = 200 - rx + (i * rx * 2) / 8;
            const d = 10 + ((i * 7) % 4) * 6;
            return `Q${x0 + rx / 8} ${y - h + d + 10} ${x0 + (rx * 2) / 8} ${y - h}`;
          }).join("") +
          `V${y - h - 6}H${200 - rx}Z`,
        c.lin([tint(P.brand, 0.2), P.brand]),
      ) +
      ell(200, y - h - 4, rx, rx * 0.16, c.lin([tint(P.brand, 0.35), P.brand]));
    const bottom = tier(322, 120, 86);
    const top = tier(232, 78, 64);
    const cherries = [168, 200, 232].map((x, i) => circ(x, 156 - (i === 1 ? 6 : 0), 11, c.rad([P.nat("#ff5a5f"), P.nat("#b3001b")], 0.35, 0.35, 0.7)) + gloss(x - 3, 152 - (i === 1 ? 6 : 0), 3) + line(`M${x} ${146 - (i === 1 ? 6 : 0)}C${x + 2} 134 ${x + 8} 128 ${x + 14} 124`, P.nat("#4b6b2a"), 2)).join("");
    const dots = Array.from({ length: 9 }, (_, i) => circ(96 + i * 26, 296 + (i % 2) * 8, 3.2, P.gold)).join("");
    return stand + bottom + dots + top + cherries;
  },
};

const cupcake: Motif = {
  name: "Cupcake",
  top: 40,
  width: 200,
  footprint: 0.45,
  draw: (c, P) => {
    const wrap = path("M118 240H282L256 376H144Z", c.lin([P.brand, shade(P.brand, 0.25)], 0, 0, 1, 0)) + Array.from({ length: 8 }, (_, i) => line(`M${132 + i * 20} 244L${150 + i * 15} 372`, tint(P.brand, 0.35), 3, `opacity=".55"`)).join("");
    const frost = c.lin(["#ffffff", P.accent === P.paper ? P.soft : P.accent]);
    const swirl = path("M104 244C88 214 120 196 146 200C140 172 176 156 200 168C224 156 260 172 254 200C280 196 312 214 296 244Z", frost) + path("M140 196C150 160 188 140 200 120C212 140 250 160 260 196C240 186 220 196 200 188C180 196 160 186 140 196Z", frost) + path("M176 150C182 120 200 100 206 84C214 104 224 124 226 150C214 144 190 144 176 150Z", frost);
    const shade1 = path("M110 236C150 250 250 250 290 236", "none", `stroke="${shade(P.accent, 0.15)}" stroke-width="5" opacity=".35" stroke-linecap="round"`);
    const sprinkles = [
      [150, 220, 20],
      [186, 206, -30],
      [232, 222, 60],
      [214, 176, 10],
      [170, 176, -60],
      [256, 210, -10],
      [126, 228, 45],
    ]
      .map(([x, y, a], i) => rect(x!, y!, 14, 4.5, 2.2, [P.brand, P.gold, P.nat("#4fb3a9")][i % 3]!, `transform="rotate(${a} ${x} ${y})"`))
      .join("");
    const cherry = circ(206, 84, 16, c.rad([P.nat("#ff5a5f"), P.nat("#b3001b")], 0.35, 0.35, 0.7)) + gloss(201, 79, 4) + line("M206 70C208 52 218 44 228 40", P.nat("#4b6b2a"), 3);
    return wrap + swirl + shade1 + sprinkles + cherry;
  },
};

const breads: Motif = {
  name: "Bread loaf and croissant",
  top: 70,
  width: 340,
  footprint: 0.85,
  draw: (c, P) => {
    const crust = c.lin([P.nat("#e8a45a"), P.nat("#b86b2a"), P.nat("#8d4d1c")]);
    const loaf = path("M40 376V300C40 230 90 196 160 196C230 196 280 230 280 300V376Z", crust) + [100, 150, 200].map((x) => path(`M${x - 18} ${250 + (x === 150 ? -10 : 0)}Q${x} ${236 + (x === 150 ? -10 : 0)} ${x + 22} ${248 + (x === 150 ? -10 : 0)}`, "none", `stroke="${P.nat("#f6d49a")}" stroke-width="9" stroke-linecap="round"`)).join("") + gloss(90, 236, 10, 0.2);
    const seg = (x: number, y: number, rx: number, ry: number, rot: number) => ell(x, y, rx, ry, c.lin([P.nat("#f0b663"), P.nat("#c27a2c")]), `transform="rotate(${rot} ${x} ${y})"`);
    const croissant = seg(256, 352, 26, 18, -40) + seg(372, 352, 26, 18, 40) + seg(282, 336, 30, 24, -20) + seg(346, 336, 30, 24, 20) + seg(314, 330, 34, 30, 0) + [290, 314, 338].map((x) => line(`M${x} 312Q${x + 4} 334 ${x} 356`, P.nat("#9a5a1f"), 2.5, `opacity=".5"`)).join("");
    const wheat = line("M70 196C64 150 72 110 92 80", P.gold, 3) + [100, 120, 140, 160].map((y, i) => ell(80 + i * 3, y - 10, 5, 10, P.gold, `transform="rotate(${-30 + i * 6} ${80 + i * 3} ${y - 10})"`) + ell(92 + i * 2, y - 2, 5, 10, P.goldDeep, `transform="rotate(${30} ${92 + i * 2} ${y - 2})"`)).join("");
    return wheat + loaf + croissant;
  },
};

// ---------------------------------------------------------------- pharmacy

const capsules: Motif = {
  name: "Capsules and a blister pack",
  top: 236,
  width: 330,
  footprint: 0.85,
  draw: (c, P) => {
    const blister = g("rotate(-8 170 300)", rect(40, 236, 260, 130, 16, metal(c, P)) + Array.from({ length: 8 }, (_, i) => ell(80 + (i % 4) * 60, 270 + Math.floor(i / 4) * 62, 20, 20, c.rad(["#ffffff", P.steel], 0.35, 0.35, 0.7)) + ell(80 + (i % 4) * 60, 270 + Math.floor(i / 4) * 62, 13, 13, i === 5 ? P.steel : c.lin([P.light, P.brand]), i === 5 ? "" : `opacity=".9"`)).join(""));
    const capsule = (x: number, y: number, rot: number, a: string, b: string) =>
      g(`rotate(${rot} ${x} ${y})`, path(`M${x - 46} ${y}A22 22 0 0 1 ${x - 24} ${y - 22}H${x}V${y + 22}H${x - 24}A22 22 0 0 1 ${x - 46} ${y}Z`, c.lin([tint(a, 0.4), a, shade(a, 0.2)])) + path(`M${x} ${y - 22}H${x + 24}A22 22 0 0 1 ${x + 24} ${y + 22}H${x}Z`, c.lin([tint(b, 0.5), b, shade(b, 0.15)])) + rect(x - 36, y - 14, 50, 6, 3, "#ffffff", `opacity=".5"`));
    const tablet = (x: number, y: number) => ell(x, y + 4, 26, 10, shade(P.cream, 0.15)) + ell(x, y, 26, 10, "#ffffff") + line(`M${x - 14} ${y}H${x + 14}`, P.steel, 2);
    return blister + capsule(300, 300, -30, P.brand, "#ffffff") + capsule(250, 356, 12, P.gold, P.cream) + tablet(330, 364) + tablet(176, 372);
  },
};

const medBottle: Motif = {
  name: "Medicine bottle",
  top: 62,
  width: 240,
  footprint: 0.6,
  draw: (c, P) => {
    const amber = P.nat("#c46a1c");
    const bottle = path("M112 150Q112 128 134 128H226Q248 128 248 150V352Q248 376 224 376H136Q112 376 112 352Z", c.lin([shade(amber, 0.25), tint(amber, 0.3), amber, shade(amber, 0.4)], 0, 0, 1, 0));
    const neck = rect(136, 104, 88, 30, 6, shade(amber, 0.2));
    const cap = rect(124, 62, 112, 50, 10, c.lin([tint(P.brand, 0.2), P.brand, P.deep], 0, 0, 1, 0)) + Array.from({ length: 9 }, (_, i) => line(`M${136 + i * 11} 70V104`, shade(P.brand, 0.3), 2, `opacity=".45"`)).join("");
    const label = rect(124, 200, 112, 116, 8, "#ffffff") + rect(158, 220, 44, 44, 4, "none") + path("M170 222H190V238H206V258H190V274H170V258H154V238H170Z", P.brand) + rect(144, 286, 72, 6, 3, P.steel) + rect(152, 298, 56, 6, 3, P.steel, `opacity=".7"`);
    const shine = rect(124, 146, 10, 196, 5, "#ffffff", `opacity=".35"`);
    const spoon = path("M262 372C262 352 280 340 300 340C320 340 338 352 338 372Z", metal(c, P)) + path("M276 368C276 356 288 350 300 350C312 350 324 356 324 368Z", c.lin([tint(P.brand, 0.3), P.brand])) + line("M300 340L330 200", P.steelDeep, 8);
    return spoon + neck + bottle + label + shine + cap;
  },
};

const firstAid: Motif = {
  name: "First-aid kit",
  top: 104,
  width: 280,
  footprint: 0.72,
  draw: (c, P) => {
    const handle = path("M150 160V128Q150 112 166 112H234Q250 112 250 128V160", "none", `stroke="${P.deep}" stroke-width="16" stroke-linejoin="round"`);
    const box = rect(60, 152, 280, 220, 26, c.lin([tint(P.brand, 0.2), P.brand, shade(P.brand, 0.2)]));
    const lid = rect(60, 152, 280, 54, 26, tint(P.brand, 0.12)) + rect(60, 196, 280, 10, 0, shade(P.brand, 0.25), `opacity=".5"`);
    const plate = circ(200, 284, 58, "#ffffff") + path("M184 248H216V268H236V300H216V320H184V300H164V268H184Z", P.brand);
    const clasp = rect(102, 190, 26, 26, 6, P.steel) + rect(272, 190, 26, 26, 6, P.steel);
    return handle + box + lid + clasp + plate + rect(76, 214, 10, 140, 5, "#ffffff", `opacity=".25"`);
  },
};

// ---------------------------------------------------------------- electronics

const phone: Motif = {
  name: "Smartphone",
  top: 40,
  width: 220,
  footprint: 0.5,
  draw: (c, P) => {
    const frame = P.dark ? mix(P.steelDeep, "#000000", 0.4) : P.ink;
    const body = g("rotate(-10 200 220)", rect(120, 40, 160, 330, 30, c.lin([tint(frame, 0.25), frame], 0, 0, 1, 0)) + rect(130, 50, 140, 310, 22, c.lin([P.light, P.brand, P.deep], 0, 0, 1, 1)) + rect(176, 60, 48, 12, 6, frame) + Array.from({ length: 8 }, (_, i) => rect(146 + (i % 3) * 38, 110 + Math.floor(i / 3) * 44, 30, 30, 9, "#ffffff", `opacity="${0.18 + (i % 3) * 0.06}"`)).join("") + rect(150, 300, 100, 28, 14, "#ffffff", `opacity=".3"`) + path("M130 50H200L130 200Z", "#ffffff", `opacity=".1"`));
    return body;
  },
};

const laptop: Motif = {
  name: "Laptop",
  top: 110,
  width: 340,
  footprint: 0.85,
  draw: (c, P) => {
    const frame = P.dark ? mix(P.steelDeep, "#000000", 0.3) : P.ink;
    const lid = rect(70, 110, 260, 176, 14, c.lin([tint(frame, 0.2), frame]));
    const screen = rect(82, 122, 236, 150, 6, c.lin([P.deep, P.brand, P.light], 0, 1, 1, 0));
    const ui = rect(98, 140, 90, 10, 5, "#ffffff", `opacity=".7"`) + rect(98, 158, 60, 8, 4, "#ffffff", `opacity=".4"`) + rect(98, 186, 96, 64, 8, "#ffffff", `opacity=".22"`) + rect(204, 140, 98, 110, 10, "#ffffff", `opacity=".16"`) + circ(253, 186, 26, P.gold, `opacity=".85"`);
    const base = path("M30 296H370L352 330H48Z", metal(c, P)) + rect(170, 296, 60, 8, 4, P.steelDeep, `opacity=".45"`);
    const shine = path("M82 122H190L82 230Z", "#ffffff", `opacity=".08"`);
    return lid + screen + ui + shine + base;
  },
};

const headphones: Motif = {
  name: "Headphones",
  top: 120,
  width: 240,
  footprint: 0.6,
  draw: (c, P) => {
    const band = path("M100 250C100 120 300 120 300 250", "none", `stroke="${P.dark ? P.steelDeep : P.ink}" stroke-width="22" stroke-linecap="round"`) + path("M112 222C122 150 278 150 288 222", "none", `stroke="${P.brand}" stroke-width="8" stroke-linecap="round" opacity=".9"`);
    const cup = (x: number, flip: number) =>
      rect(x - 40, 226, 80, 136, 34, c.lin([tint(P.brand, 0.25), P.brand, P.deep], 0, 0, flip, 1)) + rect(x - 30 + flip * 16, 240, 30, 108, 15, P.dark ? P.steelDeep : P.ink, `opacity=".85"`) + rect(x - 22, 244, 10, 50, 5, "#ffffff", `opacity=".25"`);
    return band + cup(104, 1) + cup(296, 0);
  },
};

// ---------------------------------------------------------------- repair

const phoneTools: Motif = {
  name: "Phone repair",
  top: 60,
  width: 340,
  footprint: 0.85,
  draw: (c, P) => {
    const mat = path("M30 330L90 270H370L310 330Z", P.mid, `opacity=".55"`);
    const frame = P.dark ? mix(P.steelDeep, "#000000", 0.4) : P.ink;
    const phoneBack = g("translate(0 0) skewX(-30)", rect(270, 214, 120, 76, 12, c.lin([tint(frame, 0.2), frame])) + rect(278, 220, 104, 64, 8, c.lin([P.light, P.brand])) + line("M300 230L322 252L310 262L340 276", "#ffffff", 2.5, `opacity=".8"`));
    const driver = g("rotate(-35 200 220)", rect(186, 60, 28, 120, 12, c.lin([tint(P.brand, 0.3), P.brand, P.deep], 0, 0, 1, 0)) + Array.from({ length: 5 }, (_, i) => line(`M${192 + i * 4} 76V166`, shade(P.brand, 0.3), 1.6, `opacity=".5"`)).join("") + rect(194, 176, 12, 18, 3, P.steelDeep) + path("M196 194H204L203 296L200 304L197 296Z", metal(c, P)));
    const screws = [
      [96, 316],
      [124, 300],
      [150, 318],
    ]
      .map(([x, y]) => ell(x!, y!, 7, 4, P.steelDeep) + line(`M${x! - 4} ${y}H${x! + 4}`, P.steel, 1.4))
      .join("");
    return mat + phoneBack + screws + driver;
  },
};

const gearWrench: Motif = {
  name: "Gear and spanner",
  top: 18,
  width: 260,
  footprint: 0.7,
  draw: (c, P) => {
    const teeth = 10;
    const R = 112;
    const r0 = 92;
    let d = "";
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * Math.PI * 2;
      const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? R : r0;
      d += `${i === 0 ? "M" : "L"}${n(200 + Math.cos(a0 + 0.06) * rr)} ${n(220 + Math.sin(a0 + 0.06) * rr)}L${n(200 + Math.cos(a1 - 0.06) * rr)} ${n(220 + Math.sin(a1 - 0.06) * rr)}`;
    }
    const gear = path(`${d}Z`, c.lin([tint(P.brand, 0.25), P.brand, P.deep], 0, 0, 1, 1)) + circ(200, 220, 54, P.paper === P.deep ? P.soft : shade(P.brand, 0.25)) + circ(200, 220, 38, c.lin([P.light, P.brand]));
    const wrench = g(
      "rotate(40 200 220)",
      path("M188 70H212V330H188Z", metal(c, P)) +
        path("M200 18C228 18 248 38 248 62C248 82 236 96 220 102V84H180V102C164 96 152 82 152 62C152 38 172 18 200 18Z", metal(c, P)) +
        rect(186, 40, 28, 40, 4, P.paper) +
        circ(200, 352, 30, metal(c, P)) +
        circ(200, 352, 14, P.paper),
    );
    return gear + wrench;
  },
};

const toolbox: Motif = {
  name: "Toolbox",
  top: 46,
  width: 320,
  footprint: 0.8,
  draw: (c, P) => {
    const handle = path("M150 160V128H250V160", "none", `stroke="${P.steelDeep}" stroke-width="12" stroke-linejoin="round"`);
    const tools = g("rotate(-14 160 150)", rect(146, 70, 20, 110, 6, P.nat("#b98a52")) + rect(124, 56, 64, 28, 6, metal(c, P))) + g("rotate(18 250 150)", rect(242, 66, 16, 120, 5, metal(c, P)) + circ(250, 66, 18, metal(c, P)) + rect(244, 46, 12, 22, 2, P.paper));
    const box = path("M50 190H350L336 376H64Z", c.lin([tint(P.brand, 0.2), P.brand, shade(P.brand, 0.25)], 0, 0, 1, 0));
    const lid = rect(40, 160, 320, 46, 10, c.lin([tint(P.brand, 0.3), P.brand])) + rect(40, 160, 320, 6, 3, "#ffffff", `opacity=".25"`);
    const latch = rect(184, 196, 32, 26, 5, P.steel) + rect(192, 204, 16, 10, 2, P.steelDeep);
    const stripe = rect(58, 276, 284, 14, 0, P.gold, `opacity=".85"`);
    return tools + handle + box + lid + stripe + latch;
  },
};

// ---------------------------------------------------------------- salon

const scissorsComb: Motif = {
  name: "Scissors and comb",
  top: 34,
  width: 300,
  footprint: 0.8,
  draw: (c, P) => {
    const comb = g("rotate(-12 200 330)", rect(40, 300, 300, 30, 8, c.lin([tint(P.brand, 0.3), P.brand])) + Array.from({ length: 24 }, (_, i) => rect(50 + i * 11.6, 328, 6, i < 10 ? 34 : 26, 3, P.brand)).join(""));
    const blade = (rot: number, flip: number) =>
      g(`rotate(${rot} 200 210)`, path(`M200 210L${200 + flip * 14} 200L${200 + flip * 8} 40Q${200 + flip * 2} 34 200 44Z`, metal(c, P)) + path(`M200 210L${200 - flip * 6} 228`, "none", `stroke="${P.steelDeep}" stroke-width="10" stroke-linecap="round"`) + circ(200 - flip * 30, 270, 30, "none", `stroke="${P.gold}" stroke-width="12"`) + path(`M${200 - flip * 6} 226L${200 - flip * 20} 244`, "none", `stroke="${P.gold}" stroke-width="12" stroke-linecap="round"`));
    return comb + blade(-14, 1) + blade(14, -1) + circ(200, 210, 7, P.steelDeep) + circ(200, 210, 3, P.steel);
  },
};

const mirror: Motif = {
  name: "Hand mirror",
  top: 20,
  width: 230,
  footprint: 0.5,
  draw: (c, P) => {
    const frame = goldG(c, P);
    const handle = path("M184 260H216L222 364Q200 380 178 364Z", frame) + ell(200, 262, 22, 8, P.goldDeep);
    const ring = ell(200, 150, 104, 120, frame);
    const scallop = Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * Math.PI * 2;
      return circ(200 + Math.cos(a) * 104, 150 + Math.sin(a) * 120, 9, frame);
    }).join("");
    const glass = ell(200, 150, 86, 102, c.lin([tint(P.light, 0.5), P.light, P.brand], 0, 0, 1, 1));
    const streaks = path("M150 90L190 70L130 200L116 192Z", "#ffffff", `opacity=".4"`) + path("M200 200L240 170L210 236Z", "#ffffff", `opacity=".25"`);
    const gem = circ(200, 30, 10, c.rad([tint(P.brand, 0.5), P.brand], 0.35, 0.35, 0.7));
    return handle + scallop + ring + glass + streaks + gem;
  },
};

const polish: Motif = {
  name: "Nail polish",
  top: 154,
  width: 260,
  footprint: 0.75,
  draw: (c, P) => {
    const bottle = (x: number, col: string, h: number) => {
      const y = 380 - h;
      return (
        rect(x - 18, y - 96, 36, 100, 8, c.lin([P.ink, tint(P.ink, 0.35), P.ink], 0, 0, 1, 0)) +
        rect(x - 14, y - 4, 28, 12, 3, P.gold) +
        rect(x - 44, y + 6, 88, h - 6, 22, c.lin([tint(col, 0.35), col, shade(col, 0.3)], 0, 0, 1, 0)) +
        rect(x - 34, y + 20, 10, h - 40, 5, "#ffffff", `opacity=".4"`)
      );
    };
    return bottle(110, P.light, 110) + bottle(290, P.gold, 96) + bottle(200, P.brand, 130);
  },
};

// ---------------------------------------------------------------- gym

const dumbbell: Motif = {
  name: "Dumbbell",
  top: 100,
  width: 340,
  footprint: 0.82,
  draw: (c, P) => {
    const iron = P.dark ? mix(P.steelDeep, "#000000", 0.25) : P.ink;
    const one = (y: number, s: number) =>
      g(
        `translate(200 ${y}) scale(${s})`,
        rect(-120, -12, 240, 24, 10, metal(c, P)) +
          [-1, 1]
            .map((k) => rect(k * 104 - 26, -70, 52, 140, 16, c.lin([tint(iron, 0.3), iron, shade(iron, 0.4)])) + rect(k * 150 - 18, -50, 36, 100, 12, c.lin([tint(P.brand, 0.25), P.brand, P.deep])) + rect(k * 104 - 18, -60, 10, 120, 5, "#ffffff", `opacity=".14"`))
            .join("") +
          Array.from({ length: 6 }, (_, i) => line(`M${-40 + i * 16} -12V12`, P.steelDeep, 2, `opacity=".45"`)).join(""),
      );
    return one(308, 1) + g("rotate(-14 200 180)", one(180, 0.72));
  },
};

const kettlebell: Motif = {
  name: "Kettlebell",
  top: 54,
  width: 270,
  footprint: 0.6,
  draw: (c, P) => {
    const iron = P.dark ? mix(P.steelDeep, "#000000", 0.25) : P.ink;
    const handle = path("M126 210C112 110 148 70 200 70C252 70 288 110 274 210", "none", `stroke="${c.lin([tint(iron, 0.35), iron], 0, 0, 1, 0)}" stroke-width="34" stroke-linecap="round"`);
    const bell = path("M200 160C286 160 334 224 334 290C334 340 310 372 290 376H110C90 372 66 340 66 290C66 224 114 160 200 160Z", c.rad([tint(P.brand, 0.35), P.brand, P.deep], 0.38, 0.35, 0.75));
    const plate = rect(150, 270, 100, 50, 12, P.cream, `opacity=".92"`) + rect(166, 286, 68, 8, 4, P.brand) + rect(176, 300, 48, 6, 3, P.brand, `opacity=".6"`);
    return handle + bell + plate + gloss(140, 220, 18, 0.18);
  },
};

const shaker: Motif = {
  name: "Shaker bottle",
  top: 40,
  width: 124,
  footprint: 0.45,
  draw: (c, P) => {
    const lid = rect(140, 64, 120, 54, 14, P.dark ? P.steelDeep : P.ink) + rect(176, 40, 48, 30, 8, P.brand);
    const body = path("M138 120H262L250 372H150Z", c.lin([tint(P.brand, 0.35), P.brand, P.deep], 0, 0, 1, 0));
    const window_ = rect(162, 170, 18, 160, 9, "#ffffff", `opacity=".35"`);
    const marks = [200, 240, 280].map((y) => line(`M216 ${y}H244`, "#ffffff", 4, `opacity=".6"`)).join("");
    const band = rect(141, 140, 118, 12, 3, P.gold, `opacity=".85"`);
    return lid + body + band + window_ + marks;
  },
};

// ---------------------------------------------------------------- hardware

const hammerWrench: Motif = {
  name: "Hammer and spanner",
  top: 30,
  width: 300,
  footprint: 0.8,
  draw: (c, P) => {
    const hammer = g(
      "rotate(-38 200 220)",
      rect(186, 110, 28, 260, 12, c.lin([P.nat("#d5a46a"), P.nat("#9b6a36")], 0, 0, 1, 0)) + rect(184, 300, 32, 70, 14, P.brand) + path("M130 70H262Q280 70 282 88L284 118H130Z", metal(c, P)) + path("M130 70Q100 76 96 100L130 118Z", P.steelDeep),
    );
    const wrench = g(
      "rotate(38 200 220)",
      path("M188 110H212V330H188Z", metal(c, P)) +
        path("M200 50C228 50 248 70 248 94C248 114 236 128 220 134V116H180V134C164 128 152 114 152 94C152 70 172 50 200 50Z", metal(c, P)) +
        rect(186, 72, 28, 40, 4, P.paper) +
        path("M184 300H216L212 360Q200 372 188 360Z", P.deep),
    );
    return wrench + hammer;
  },
};

const paint: Motif = {
  name: "Paint tin and roller",
  top: 120,
  width: 330,
  footprint: 0.85,
  draw: (c, P) => {
    const tin = rect(56, 200, 180, 176, 12, metal(c, P)) + ell(146, 200, 90, 18, P.steel) + ell(146, 200, 80, 14, c.lin([tint(P.brand, 0.25), P.brand]));
    const drips = path("M66 206Q80 240 80 262Q80 272 88 272Q96 272 96 262V214H120V236Q120 246 128 246Q136 246 136 236V216H180V280Q180 292 188 292Q196 292 196 280V214Z", P.brand);
    const label = rect(56, 286, 180, 60, 0, P.brand, `opacity=".9"`) + rect(80, 304, 90, 8, 4, P.cream, `opacity=".85"`) + rect(80, 320, 60, 6, 3, P.cream, `opacity=".6"`);
    const handle = path("M70 200C70 140 222 140 222 200", "none", `stroke="${P.steelDeep}" stroke-width="5"`);
    const roller = g("rotate(-28 300 220)", rect(240, 120, 120, 50, 22, c.lin([tint(P.brand, 0.35), P.brand, P.deep])) + line("M360 145H378V220H300V300", P.steelDeep, 7) + rect(290, 296, 20, 76, 8, P.dark ? P.steelDeep : P.ink));
    return handle + tin + label + drips + roller;
  },
};

const drill: Motif = {
  name: "Power drill",
  top: 92,
  width: 306,
  footprint: 0.65,
  draw: (c, P) => {
    const body = path("M90 120Q90 92 118 92H284Q308 92 308 120V170Q308 196 282 196H210L196 300H140L150 196H118Q90 196 90 168Z", c.lin([tint(P.brand, 0.25), P.brand, P.deep], 0, 0, 1, 1));
    const grip = path("M152 200L140 300H196L208 200Z", P.dark ? P.steelDeep : P.ink, `opacity=".85"`);
    const battery = rect(116, 296, 112, 52, 10, P.dark ? P.steelDeep : P.ink) + rect(130, 310, 40, 8, 4, P.gold);
    const chuck = rect(306, 116, 34, 56, 8, metal(c, P)) + path("M340 136H392L396 144L392 152H340Z", metal(c, P));
    const vents = [120, 136, 152].map((x) => rect(x, 112, 8, 40, 4, shade(P.brand, 0.35), `opacity=".6"`)).join("");
    const trigger = rect(196, 196, 18, 34, 6, P.gold);
    return body + grip + trigger + battery + chuck + vents + rect(206, 108, 90, 8, 4, "#ffffff", `opacity=".25"`);
  },
};

// ---------------------------------------------------------------- optical

const spectacles: Motif = {
  name: "Spectacles",
  top: 176,
  width: 380,
  footprint: 0.82,
  draw: (c, P) => {
    const frame = P.dark ? P.light : P.deep;
    const lens = (cx: number) =>
      circ(cx, 250, 74, c.lin([tint(P.light, 0.7), tint(P.light, 0.3)], 0, 0, 1, 1), `opacity=".7"`) +
      circ(cx, 250, 74, "none", `stroke="${frame}" stroke-width="14"`) +
      path(`M${cx - 44} ${220}L${cx - 14} ${196}L${cx - 50} ${266}Z`, "#ffffff", `opacity=".55"`) +
      path(`M${cx + 6} ${290}L${cx + 40} ${262}L${cx + 22} ${300}Z`, "#ffffff", `opacity=".3"`);
    const bridge = path("M168 236Q200 206 232 236", "none", `stroke="${frame}" stroke-width="12" stroke-linecap="round"`);
    const temples = line("M38 228L10 200", frame, 10) + line("M362 228L390 200", frame, 10);
    const shine = circ(64, 214, 4, "#ffffff", `opacity=".7"`) + circ(270, 214, 4, "#ffffff", `opacity=".7"`);
    const reflection = ell(200, 372, 150, 6, P.mid, `opacity=".4"`);
    return reflection + temples + lens(110) + lens(290) + bridge + shine;
  },
};

const sunglasses: Motif = {
  name: "Aviator sunglasses",
  top: 196,
  width: 380,
  footprint: 0.8,
  draw: (c, P) => {
    const lens = (cx: number, flip: number) =>
      path(`M${cx - 70} 230Q${cx - 74} 200 ${cx - 30} 196H${cx + 30}Q${cx + 74} 200 ${cx + 66} 244Q${cx + 56} 310 ${cx} 312Q${cx - 60} 310 ${cx - 70} 230Z`, c.lin([shade(P.brand, 0.5), P.deep, tint(P.brand, 0.2)], 0, 0, flip, 1)) +
      path(`M${cx - 70} 230Q${cx - 74} 200 ${cx - 30} 196H${cx + 30}Q${cx + 74} 200 ${cx + 66} 244Q${cx + 56} 310 ${cx} 312Q${cx - 60} 310 ${cx - 70} 230Z`, "none", `stroke="${goldG(c, P)}" stroke-width="7"`) +
      path(`M${cx - 52} 222L${cx - 20} 206L${cx - 50} 262Z`, "#ffffff", `opacity=".35"`);
    const bridge = line("M168 214Q200 196 232 214", P.gold, 6) + line("M164 196H236", P.gold, 4);
    const arms = line("M42 222L14 196", P.gold, 6) + line("M358 222L386 196", P.gold, 6);
    return arms + lens(112, 1) + lens(288, 0) + bridge;
  },
};

const glassesCase: Motif = {
  name: "Glasses case",
  top: 186,
  width: 300,
  footprint: 0.82,
  draw: (c, P) => {
    const base = path("M50 300Q50 376 200 376Q350 376 350 300Z", c.lin([tint(P.brand, 0.2), P.brand, P.deep], 0, 0, 0, 1));
    const lid = path("M60 296Q64 190 200 186Q336 190 340 296Z", c.lin([tint(P.brand, 0.3), P.brand]));
    const lining = path("M76 296Q80 210 200 206Q320 210 324 296Z", P.cream);
    const hinge = rect(50, 292, 300, 10, 5, P.gold);
    const cloth = path("M90 300Q140 270 200 290T320 300L310 330Q200 350 96 330Z", P.light, `opacity=".9"`);
    const frames = circ(150, 282, 34, "none", `stroke="${P.ink}" stroke-width="7"`) + circ(250, 282, 34, "none", `stroke="${P.ink}" stroke-width="7"`) + line("M184 276Q200 266 216 276", P.ink, 6);
    return base + lid + lining + hinge + cloth + frames;
  },
};

// ---------------------------------------------------------------- per trade

const MOTIFS: Record<StockTrade, Motif[]> = {
  fashion: [sareeStack, kurtaHanger, potli],
  jewellery: [necklaceBust, ringBox, jhumka],
  tailoring: [sewingMachine, spools, tape],
  restaurant: [thali, filterCoffee, curryBowl],
  cloud_kitchen: [handi, takeawayBag, noodleBox],
  grocery: [basket, jars, groceryBag],
  fresh: [crate, veggies, fruits],
  bakery: [cake, cupcake, breads],
  pharmacy: [medBottle, capsules, firstAid],
  electronics: [laptop, phone, headphones],
  repair: [phoneTools, gearWrench, toolbox],
  salon: [mirror, scissorsComb, polish],
  gym: [dumbbell, kettlebell, shaker],
  hardware: [hammerWrench, paint, drill],
  optical: [spectacles, sunglasses, glassesCase],
};

export function stockMotifs(trade: StockTrade): Motif[] {
  return MOTIFS[trade];
}
