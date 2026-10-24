# Supplier bills for the bill-scan eval

**Owner: please drop 20 real supplier bills in this folder.** We do not make up test bills: a made-up bill is always
cleaner than a real one, and the whole point of this eval is how the model copes with real shop paperwork.

What to put here
- 20 files, photos (`.jpg`, `.png`, `.webp`) or PDFs, of bills your shops actually receive.
- A mix: printed GST invoices, handwritten bills, thermal-printer slips, photos taken at an angle or in poor light,
  bills in Tamil, bills with discounts and round-offs, a bill with several GST rates, a credit note.
- Name them `01-vendor-short-name.jpg`, `02-...`.

Redact before you drop them (these files are for testing only, but treat them as sensitive)
- Cover or blur: bank account numbers, UPI IDs, phone numbers, email addresses, signatures, and any customer name that is
  not your own shop.
- Keep the supplier name, GSTIN, bill number and date, item lines, quantities, rates, HSN, tax lines and totals. Those are
  what the helper has to read.
- Do not commit the originals. `evals/bills/*` except this README is git-ignored.

Optional but very useful: next to each bill, a file with the same name and `.expected.json` holding what a person reads
from it: `{ "supplier": "...", "gstin": "...", "billNumber": "...", "date": "YYYY-MM-DD", "total": 12345.00,
"lines": [{ "name": "...", "qty": 1, "rate": 100.00 }] }`. With those the eval can score field by field instead of
needing a person to read every answer.

The bill-scan helper (listed as "coming soon" in Settings > AI) is built after these exist.
