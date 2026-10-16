const LINE_SEPARATORS = new RegExp("[\\u2028\\u2029]", "g");

/** JSON-LD script; `<`, `>`, `&` and line separators are escaped so the payload can't close the tag. */
export function JsonLd({ data }: { data: unknown }) {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
