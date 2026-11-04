# Sound in the RBMS ads

The ads use only material that can be used commercially without paying or crediting anyone. The downloads themselves live in
`out/` (not committed).

| What | Used for | Source | Licence |
|---|---|---|---|
| "Hooptie With The Windows Down", HoliznaCC0 (album City Slacker) | Music in both ads | [Internet Archive](https://archive.org/details/holizna-cc-0-hooptie-with-the-windows-down.mp-3) | CC0 1.0 |
| Kenney Interface Sounds | Effects in both ads | Kenney, via [this GitHub copy](https://github.com/Calinou/kenney-interface-sounds) | CC0 1.0, copy in `out/sounds/kenney-interface/` |
| Kenney UI Audio | Downloaded, not used in the mix | Kenney, via [this GitHub copy](https://github.com/Calinou/kenney-ui-audio) | CC0 1.0, copy in `out/sounds/kenney-ui/` |
| Kokoro v1.0, voice `af_heart`, run locally through kokoro-onnx | English voice-over | [Hugging Face](https://huggingface.co/hexgrad/Kokoro-82M) | Model Apache 2.0; kokoro-onnx MIT |
| AI4Bharat Indic Parler-TTS, speaker Jaya, run locally | Tamil voice-over | [Hugging Face](https://huggingface.co/ai4bharat/indic-parler-tts) (gated: needs a login that accepted its conditions) | Apache 2.0 |

The music's CC0 status rests on the uploader's own statement: Internet Archive doesn't check it, and HoliznaCC0's releases are
offered as CC0 on that basis. Confirm this before a paid campaign if it matters.

## Rebuilding

    tools/ad/out/voice/.venv/Scripts/python.exe -I tools/ad/voice.py    # English voice lines
    node tools/ad/capture-en.mjs                                        # film the screens (the API on :4000 must be running)
    node tools/ad/mix.mjs en                                            # or ta, which also makes the Tamil films
    node tools/ad/render.mjs en                                         # or `en stills` to check the layout quickly
