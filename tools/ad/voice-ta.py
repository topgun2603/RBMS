# Speaks the Tamil ad's lines with AI4Bharat's Indic Parler-TTS (Apache 2.0, gated: needs a Hugging Face login that has accepted
# its conditions) and writes out/voice-ta/lines/NN.wav plus lines.json. English letters are spelled in Tamil so they're said right.
#   tools/ad/out/voice-ta/.venv/Scripts/python.exe -I tools/ad/voice-ta.py [line numbers...]
import json
import pathlib
import sys

import soundfile
import torch
from parler_tts import ParlerTTSForConditionalGeneration
from transformers import AutoTokenizer

sys.stdout.reconfigure(encoding="utf-8")
OUT = pathlib.Path(__file__).resolve().parent / "out" / "voice-ta" / "lines"
OUT.mkdir(parents=True, exist_ok=True)
MODEL = "ai4bharat/indic-parler-tts"
# Jaya is the speaker the model page recommends for Tamil.
STYLE = "Jaya speaks at a fast pace with an upbeat, expressive tone, in a clear, close-sounding recording of very high quality with no background noise."
LINES = [
    "கவுண்டரிலும் விற்கலாம். ஆன்லைனிலும் விற்கலாம்.",
    "வேகமான ஜி.எஸ்.டி பில்லிங். வரி தானாகவே கணக்கிடப்படும். பில் உடனே வாட்ஸ்அப்பில் போகும்.",
    "கடன் கணக்கும், வாட்ஸ்அப் நினைவூட்டலும்.",
    "உங்கள் பெயரில், உங்கள் நிறங்களில், உங்கள் சொந்த ஆன்லைன் ஸ்டோர். யூ.பி.ஐ, கார்டு, டெலிவரியில் பணம், எல்லாம் உண்டு.",
    "கடைக்கும் ஆன்லைனுக்கும் ஒரே இருப்பு.",
    "தமிழிலும் ஆங்கிலத்திலும் பயன்படுத்தலாம்.",
    "ஆர்.பி.எம்.எஸ். எல்லாம் ஒன்றில். பதினான்கு நாள் இலவச சோதனை.",
]

only = {int(a) for a in sys.argv[1:]}
model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL)
tokenizer = AutoTokenizer.from_pretrained(MODEL)
style_tokenizer = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)
style = style_tokenizer(STYLE, return_tensors="pt")
rate = model.config.sampling_rate

info_file = OUT / "lines.json"
info = {l["file"]: l for l in json.loads(info_file.read_text(encoding="utf-8"))} if info_file.exists() else {}
for i, text in enumerate(LINES):
    if only and i not in only:
        continue
    torch.manual_seed(42 + i)
    prompt = tokenizer(text, return_tensors="pt")
    audio = model.generate(input_ids=style.input_ids, attention_mask=style.attention_mask, prompt_input_ids=prompt.input_ids, prompt_attention_mask=prompt.attention_mask)
    samples = audio.cpu().numpy().squeeze()
    name = f"{i:02d}.wav"
    soundfile.write(OUT / name, samples, rate)
    info[name] = {"file": name, "text": text, "seconds": round(len(samples) / rate, 3), "rate": rate}
    print(f"{i} {info[name]['seconds']:6.2f}s  {text}", flush=True)
info_file.write_text(json.dumps(sorted(info.values(), key=lambda l: l["file"]), ensure_ascii=False, indent=1), encoding="utf-8")
print("total", round(sum(l["seconds"] for l in info.values()), 2))
