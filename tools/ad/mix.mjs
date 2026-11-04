// Mixes an ad's sound from downloaded CC0 music and effects (out/sounds, see tools/ad/CREDITS.md), plus the voice for English:
//   node tools/ad/mix.mjs en     voice up front, music just under it: out/sound-en.wav
//   node tools/ad/mix.mjs ta     music and effects, no voice: out/sound-ta.wav, then new Tamil films made from the existing
//                                picture (no re-render), out/RBMS-ad-tamil-16x9.mp4 and -9x16.mp4
//   node tools/ad/mix.mjs tv     the same picture with the Tamil voice over quieter music: out/RBMS-ad-tamil-voice-*.mp4
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findFfmpeg } from "./ffmpeg.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const ffmpeg = findFfmpeg();
const SECONDS = 30;
const music = join(OUT, "sounds", "music", "hooptie.mp3");
const ui = (name) => join(OUT, "sounds", "kenney-interface", "kenney-interface-sounds-master", "addons", "kenney_interface_sounds", `${name}.wav`);
// The track's opening is sparse; the steady groove starts about 10 s in.
const MUSIC_FROM = 10;

// Named effects, each a real Kenney file. Nothing here is a true printer or whoosh, so the nearest fit is used.
const FX = { whoosh: "maximize_006", thud: "drop_002", pop: "pluck_001", tap: "click_002", tick: "tick_001", done: "confirmation_001", bell: "glass_001" };
const at = (t, fx, gain) => ({ t, fx, gain });

function enCues() {
  const cues = [2.15, 5.75, 9.25, 14.55, 20.15, 22.15].map((t) => at(t - .12, "whoosh", .1));
  // Words landing, as in ad-en.html.
  for (const s of [.5, 1.25]) cues.push(at(s, "thud", .16));
  for (const s of [5.75 + .17, 5.75 + .82, 5.75 + 1.21]) cues.push(at(s, "tap", .16));
  for (const s of [1.2, 2.75, 3.58, 4.1]) cues.push(at(9.25 + s, "pop", .2));
  cues.push(at(14.55 + 4.17, "bell", .22), at(14.55 + 4.9, "bell", .22));
  cues.push(at(22.15 + .15, "thud", .22));
  for (const s of [1.23, 2.63, 3.48]) cues.push(at(22.15 + s, "tap", .16));
  cues.push(at(22.15 + 4.2, "done", .3));
  return cues;
}
function taCues() {
  const cues = [3.4, 11.6, 14.2, 21.4, 24.6, 27].map((t) => at(t - .12, "whoosh", .3));
  cues.push(at(.18, "thud", .55), at(1.55, "thud", .55));
  // Billing: typing on the keys, the slip printing, the stamp, the WhatsApp arrival.
  for (let t = 3.9; t < 8.1; t += .26) cues.push(at(t, "tap", .22));
  for (let t = 8; t < 10; t += .07) cues.push(at(t, "tick", .14));
  cues.push(at(10.4, "thud", .85), at(10.46, "bell", .35), at(10.85, "pop", .5));
  cues.push(at(11.7, "thud", .4), at(13.2, "pop", .35));
  cues.push(at(14.4, "thud", .5), at(16.5, "whoosh", .2), at(18.8, "whoosh", .2));
  for (let i = 0; i < 3; i++) cues.push(at(15.6 + i * 1.3, "pop", .35));
  cues.push(at(19.7, "done", .6));
  cues.push(at(21.5, "thud", .45), at(22.4, "thud", .55), at(22.42, "bell", .3), at(23.4, "thud", .55), at(23.42, "bell", .3));
  cues.push(at(24.7, "thud", .45), at(27.1, "thud", .75));
  for (let i = 0; i < 3; i++) cues.push(at(27.55 + i * .32, "thud", .45));
  cues.push(at(28.87, "done", .6));
  return cues;
}

// Line starts match the scene times in ad-en.html.
const LINE_AT = [.3, 2.3, 5.82, 9.4, 14.7, 20.3, 22.3, 26.4];
// Tamil voice: start in the scene it belongs to, and level (dB, measured: the model's lines differ by up to 11 dB). The billing
// line waits so "the bill goes on WhatsApp" lands by the stamp; the last line is sped up 10% to end inside the 30 s.
const TAMIL_VOICE = [[.15, 6.3], [5.4, 7.5], [11.75, 17], [14.4, 5.5], [21.6, 15], [24.75, 7.7], [26.85, 6.8, 1.1]];
const lang = process.argv[2];
if (!["en", "ta", "tv"].includes(lang)) throw new Error("say which ad: en, ta or tv");

const inputs = ["-ss", String(MUSIC_FROM), "-t", String(SECONDS), "-i", music];
const parts = [];
const labels = [];
const add = (file, chain, label) => {
  inputs.push("-i", file);
  const n = inputs.filter((a) => a === "-i").length - 1;
  parts.push(`[${n}:a]aresample=44100,aformat=channel_layouts=stereo,${chain}[${label}]`);
  labels.push(`[${label}]`);
};
const delay = (t) => `adelay=${Math.round(t * 1000)}:all=1`;

// Measured at -29 LUFS: +13 dB puts it at about -16 for the Tamil film, where the music leads. Under a voice it sits about 16 dB lower.
const musicDb = lang === "ta" ? 13 : -2.5;
parts.push(`[0:a]aresample=44100,aformat=channel_layouts=stereo,afade=t=in:d=0.25,volume=${musicDb}dB,afade=t=out:st=${SECONDS - 1.6}:d=1.6[music]`);
labels.push("[music]");
if (lang === "en") LINE_AT.forEach((t, i) => add(join(OUT, "voice", "lines", `${String(i).padStart(2, "0")}.wav`), `volume=2,${delay(t)}`, `v${i}`));
if (lang === "tv") TAMIL_VOICE.forEach(([t, db, tempo], i) => add(join(OUT, "voice-ta", "lines", `${String(i).padStart(2, "0")}.wav`), `${tempo ? `atempo=${tempo},` : ""}volume=${db}dB,${delay(t)}`, `v${i}`));
// The Tamil cues were set for a film with no voice: quieter when there is one.
(lang === "en" ? enCues() : taCues()).forEach((c, i) => add(ui(FX[c.fx]), `volume=${lang === "tv" ? c.gain * .4 : c.gain},${delay(c.t)}`, `f${i}`));

const graph = `${parts.join(";")};${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest,alimiter=limit=0.89:level=false,atrim=0:${SECONDS}[out]`;
const wav = join(OUT, `sound-${lang}.wav`);
execFileSync(ffmpeg, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", "-ar", "44100", "-c:a", "pcm_s16le", wav], { stdio: "inherit" });
console.log("written", wav);

if (lang !== "en") {
  const name = lang === "tv" ? "RBMS-ad-tamil-voice" : "RBMS-ad-tamil";
  for (const f of ["16x9", "9x16"]) {
    const picture = join(OUT, `RBMS-ad-${f}.mp4`);
    if (!existsSync(picture)) throw new Error(`no picture yet: ${picture}`);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", picture, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", join(OUT, `${name}-${f}.mp4`)], { stdio: "inherit" });
    console.log("written", `${name}-${f}.mp4`);
  }
}
