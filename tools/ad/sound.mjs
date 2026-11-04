// The ad's whole soundtrack, generated here from sine waves and noise, so there is nothing to license: a percussive groove and
// a simple pentatonic line, plus effects cued to the picture. Writes out/sound.wav (44.1 kHz, 16-bit, stereo).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const SR = 44100, LEN = 30, N = SR * LEN;
const L = new Float32Array(N), R = new Float32Array(N);
// Same noise every build, so a rebuild sounds the same.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function put(at, len, fn, gain = 1, pan = 0) {
  const start = Math.floor(at * SR), n = Math.floor(len * SR);
  const gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan);
  for (let i = 0; i < n && start + i < N; i++) {
    if (start + i < 0) continue;
    const v = fn(i / SR, i / n);
    L[start + i] += v * gl;
    R[start + i] += v * gr;
  }
}
const lowpass = (coef) => { let y = 0; return (x) => (y += coef * (x - y)); };
const hipass = (coef) => { let y = 0, last = 0; return (x) => { y = coef * (y + x - last); last = x; return y; }; };

// ---- drums
const kick = (at, g = 1) => { let ph = 0; put(at, .28, (t) => { ph += (2 * Math.PI * (48 + 120 * Math.exp(-t * 38))) / SR; return Math.sin(ph) * Math.exp(-t * 11); }, g); };
const hat = (at, g = .16, pan = .2) => { const h = hipass(.85); put(at, .05, (t) => h(rnd()) * Math.exp(-t * 90), g, pan); };
const snare = (at, g = .3) => { const h = hipass(.6); put(at, .17, (t) => (h(rnd()) * .8 + Math.sin(2 * Math.PI * 190 * t) * .4) * Math.exp(-t * 22), g); };
/** A tavil-like pitched hand drum, for the local colour. */
const tom = (at, f, g = .34, pan = 0) => { let ph = 0; put(at, .2, (t) => { ph += (2 * Math.PI * f * (1 + .35 * Math.exp(-t * 40))) / SR; return Math.sin(ph) * Math.exp(-t * 16); }, g, pan); };

// ---- melody: D minor pentatonic, plucked
const pluck = (at, f, g = .17, pan = 0, len = .42) => put(at, len, (t) => (Math.sin(2 * Math.PI * f * t) + .45 * Math.sin(4 * Math.PI * f * t) + .2 * Math.sin(6 * Math.PI * f * t)) * Math.exp(-t * 7.5), g, pan);
const bass = (at, f, g = .3, len = .4) => put(at, len, (t, k) => (Math.sin(2 * Math.PI * f * t) + .25 * Math.sin(4 * Math.PI * f * t)) * Math.min(1, t * 80) * (1 - k * k), g);

const BPM = 126, beat = 60 / BPM, bar = beat * 4;
const NOTE = { D: 293.66, F: 349.23, G: 392, A: 440, C: 523.25, d: 587.33, f: 698.46, g: 783.99, a: 880 };
const LOW = { D: 73.42, F: 87.31, G: 98, A: 110, C: 65.41 };
const riff = [["D", 0], ["F", .5], ["G", 1], ["A", 1.5], ["C", 2.5], ["A", 3], ["G", 3.5], ["A", 4], ["C", 4.5], ["d", 5], ["C", 6], ["A", 6.5], ["G", 7], ["F", 7.5]];
const bassLine = ["D", "D", "F", "G", "D", "D", "C", "A"];

const END = 28.6;
for (let t = 0, i = 0; t < END; t += beat, i++) {
  // Sparse at the very start, full from the first cut.
  if (t >= 3.3 || i % 2 === 0) kick(t, t < 3.3 ? .5 : .55);
  if (t >= 3.3) {
    hat(t + beat / 2);
    if (i % 2 === 1) snare(t);
    bass(t, LOW[bassLine[i % 8]], .3, beat * .9);
  }
  if (t >= 1.5) {
    // The tavil pattern between the beats.
    if (i % 4 === 2) { tom(t + beat * .25, 220, .2, -.3); tom(t + beat * .75, 165, .24, .3); }
    if (i % 8 === 7) { tom(t, 247, .22, -.2); tom(t + beat * .25, 220, .22, 0); tom(t + beat * .5, 196, .24, .2); tom(t + beat * .75, 165, .28, 0); }
  }
}
for (let b = 0; bar * 2 * b < END; b++) {
  const t0 = 3.33 + bar * 2 * b;
  for (const [n, off] of riff) {
    const at = t0 + off * beat;
    if (at < END - .4) pluck(at, NOTE[n], .15, n.charCodeAt(0) % 2 ? -.25 : .25);
  }
}

// ---- effects, cued to the picture (ad.html)
const whoosh = (at, g = .26) => { const f = lowpass(.2); put(at - .22, .46, (t, k) => f(rnd()) * Math.sin(Math.PI * k) ** 2 * (1 + 2 * k), g); };
const slam = (at, g = .9) => {
  let ph = 0;
  const f = lowpass(.35);
  put(at, .42, (t) => { ph += (2 * Math.PI * (42 + 95 * Math.exp(-t * 26))) / SR; return (Math.sin(ph) * 1.1 + f(rnd()) * Math.exp(-t * 24) * .8) * Math.exp(-t * 8); }, g);
};
/** Thermal printer: a fast chatter of narrow noise, in short bursts. */
const printer = (at, len, g = .2) => { const h = hipass(.92); put(at, len, (t, k) => h(rnd()) * (Math.sin(2 * Math.PI * 70 * t) > 0 ? 1 : .15) * (.8 + .2 * Math.sin(2 * Math.PI * 9 * t)) * Math.min(1, t * 30) * Math.min(1, (1 - k) * 30), g, .25); };
const keyTick = (at) => { const h = hipass(.7); put(at, .03, (t) => h(rnd()) * Math.exp(-t * 200), .14 + Math.abs(rnd()) * .05, -.2); };
const ding = (at, g = .3) => put(at, 1.1, (t) => (Math.sin(2 * Math.PI * 1318 * t) + .6 * Math.sin(2 * Math.PI * 1760 * t) + .3 * Math.sin(2 * Math.PI * 2637 * t)) * Math.exp(-t * 4.5), g);
const pop = (at, g = .36) => { let ph = 0; put(at, .12, (t) => { ph += (2 * Math.PI * (500 + 900 * (t / .12))) / SR; return Math.sin(ph) * Math.exp(-t * 28); }, g); };
const coin = (at, g = .22) => { put(at, .09, (t) => Math.sin(2 * Math.PI * 1760 * t) * Math.exp(-t * 18), g); put(at + .08, .5, (t) => Math.sin(2 * Math.PI * 2349 * t) * Math.exp(-t * 7), g); };
const riser = (at, len, g = .2) => { const f = lowpass(.35); put(at, len, (t, k) => f(rnd()) * k * k, g); };

for (const c of [3.4, 11.6, 14.2, 21.4, 24.6, 27]) whoosh(c);
// 1. two ways to sell
slam(.18); slam(1.55);
// 2. billing: typing, the bill printing, the stamp, the WhatsApp arrival
for (let t = 3.8; t < 8.2; t += .085 + Math.abs(rnd()) * .09) keyTick(t);
printer(3.4 + 4.6, 2);
slam(3.4 + 7, .95); coin(3.4 + 7.05, .24);
pop(3.4 + 7.45); pop(3.4 + 7.55, .24);
// 3. credit book
slam(11.7, .5); pop(13.2, .24);
// 4. store: each store cut, the order landing
slam(14.4, .7);
for (const c of [14.2 + 2.3, 14.2 + 4.6]) whoosh(c, .16);
for (let i = 0; i < 3; i++) pop(14.2 + 1.4 + i * 1.3, .2);
ding(14.2 + 5.5, .34);
// 5. one stock: a hit on each count
slam(21.5, .6); slam(22.4, .7); coin(22.42, .18); slam(23.4, .7); coin(23.42, .18);
// 6. Tamil
slam(24.7, .6);
// 7. end card
riser(25.9, 1.1, .16);
slam(27.1, 1); for (let i = 0; i < 3; i++) slam(27.55 + i * .32, .55);
ding(28.87, .3);

// ---- finish: fade the tail, gentle glue, and no clipping
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = t > 29 ? Math.max(0, 30 - t) : 1;
  const soft = (x) => Math.tanh(x * 1.15);
  L[i] = soft(L[i]) * fade;
  R[i] = soft(R[i]) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const scale = 0.72 / (peak || 1);
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(L[i] * scale * 32767), i * 4);
  data.writeInt16LE(Math.round(R[i] * scale * 32767), i * 4 + 2);
}
const head = Buffer.alloc(44);
head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40);
writeFileSync(join(OUT, "sound.wav"), Buffer.concat([head, data]));
console.log("sound.wav written, peak before scaling", peak.toFixed(3));
