/** Wording of the preview banner (shown when the preview is opened in its own tab, not inside the editor). */
export const previewEn = {
  banner: "Preview — you're seeing unpublished changes. Shoppers still see the live store.",
  exit: "Exit preview",
  expires: "Link valid until {time}",
} as const;

export const previewTa: Record<keyof typeof previewEn, string> = {
  banner: "முன்னோட்டம் — வெளியிடப்படாத மாற்றங்களைப் பார்க்கிறீர்கள். வாடிக்கையாளர்கள் நேரடி கடையையே பார்க்கிறார்கள்.",
  exit: "முன்னோட்டத்திலிருந்து வெளியேறு",
  expires: "{time} வரை செல்லும்",
};

export const previewMessages = (locale: string): Record<keyof typeof previewEn, string> => (locale === "ta" ? previewTa : previewEn);
