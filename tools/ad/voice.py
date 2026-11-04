# Speaks the English ad's lines with Kokoro (open model, Apache 2.0) and writes out/voice/lines/NN.wav plus lines.json, which the
# ad's scene timing and the mix both read. Run with the venv in out/voice:
#   tools/ad/out/voice/.venv/Scripts/python.exe -I tools/ad/voice.py
import json
import pathlib
import sys

import soundfile
from kokoro_onnx import Kokoro

sys.stdout.reconfigure(encoding="utf-8")

VOICE_DIR = pathlib.Path(__file__).resolve().parent / "out" / "voice"
LINES = [
    "Run your whole shop from one place.",
    "R B M S gives you fast G S T billing at the counter,",
    "with stock, credit and reports that keep themselves up to date.",
    "And your own online store, in your colours, taking U P I, cards, and cash on delivery.",
    "Both share one product list and one stock, so you sell the same item, online and in the shop.",
    "It works in Tamil and English.",
    "R B M S. G S T billing. Online store. All in one.",
    "Start your fourteen-day free trial today.",
]
VOICE, SPEED = "af_heart", 1.08

kokoro = Kokoro(str(VOICE_DIR / "kokoro-v1.0.onnx"), str(VOICE_DIR / "voices-v1.0.bin"))
out = VOICE_DIR / "lines"
out.mkdir(exist_ok=True)
info = []
for i, text in enumerate(LINES):
    samples, rate = kokoro.create(text, voice=VOICE, speed=SPEED, lang="en-us")
    file = out / f"{i:02d}.wav"
    soundfile.write(file, samples, rate)
    info.append({"file": file.name, "text": text, "seconds": round(len(samples) / rate, 3), "rate": rate})
    print(f"{i} {info[-1]['seconds']:6.2f}s  {kokoro.tokenizer.phonemize(text, lang='en-us')}")
(out / "lines.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
print("total", round(sum(l["seconds"] for l in info), 2))
