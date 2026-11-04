// Where ffmpeg is: winget doesn't always put it on PATH.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const base = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  if (existsSync(base)) {
    for (const d of readdirSync(base).filter((n) => n.startsWith("Gyan.FFmpeg"))) {
      for (const v of readdirSync(join(base, d)).filter((n) => n.startsWith("ffmpeg-"))) {
        const exe = join(base, d, v, "bin", "ffmpeg.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return "ffmpeg";
}
