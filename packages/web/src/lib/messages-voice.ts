import type { Messages } from "@srirealtime/i18n/client";

/** web.voice.* strings: the mic + spoken-language chip on the AI panels. Keep en and ta key sets identical. */
export const enVoice: Messages = {
  "web.voice.start": "Speak",
  "web.voice.stop": "Stop",
  "web.voice.listening": "Listening… speak now",
  "web.voice.lang": "Language you will speak",
  "web.voice.err.denied": "The microphone is blocked. Allow it for this site in the browser settings.",
  "web.voice.err.noSpeech": "Didn't hear anything. Tap Speak and talk a little louder.",
  "web.voice.err.network": "Voice typing needs internet. Check the connection and try again.",
  "web.voice.err.lang": "This browser can't recognise that language. Try the other language or type instead.",
  "web.voice.err.failed": "Voice typing didn't start. Please type instead.",
};

export const taVoice: Messages = {
  "web.voice.start": "பேசுங்கள்",
  "web.voice.stop": "நிறுத்து",
  "web.voice.listening": "கேட்கிறது… இப்போது பேசுங்கள்",
  "web.voice.lang": "நீங்கள் பேசும் மொழி",
  "web.voice.err.denied": "மைக் தடுக்கப்பட்டுள்ளது. உலாவி அமைப்புகளில் இந்தத் தளத்துக்கு அனுமதி கொடுங்கள்.",
  "web.voice.err.noSpeech": "எதுவும் கேட்கவில்லை. 'பேசுங்கள்' தட்டி சற்று சத்தமாகப் பேசுங்கள்.",
  "web.voice.err.network": "குரல் தட்டச்சுக்கு இணையம் தேவை. இணைப்பைச் சரிபார்த்து மீண்டும் முயலுங்கள்.",
  "web.voice.err.lang": "இந்த உலாவியால் அந்த மொழியை அறிய முடியவில்லை. மற்ற மொழியை முயலுங்கள் அல்லது தட்டச்சு செய்யுங்கள்.",
  "web.voice.err.failed": "குரல் தட்டச்சு தொடங்கவில்லை. தட்டச்சு செய்யுங்கள்.",
};
