# srikit_print

Receipts for thermal printers. Pure Dart, no dependencies.

- `Receipt`: what goes on paper (shop, bill number, IST date, lines, GST summary, total, paid / change / balance,
  footer). The app builds it from the **server's** bill; nothing is recomputed for printing.
- `EscPosFormatter(PaperWidth.mm58 | mm80).format(receipt)` gives `text` (the preview, 32 or 48 columns) and `bytes`
  (ESC/POS: initialise, alignment, bold, double height, feed, partial cut).
- `ReceiptPrinter`: the interface a Bluetooth / USB printer will implement. Today only `PreviewReceiptPrinter`
  exists (it returns the text); the app shows that preview with "Bluetooth printers come next".

**Tamil and other non-Latin text.** Most ESC/POS printers only have Latin code pages and no Tamil font, so the
formatter prints ASCII only: `Rs` instead of `₹`, and any text with other letters is replaced by its fallback
(`shopNameFallback`, `customerNameFallback`, `ReceiptLine.nameFallback`: the English name or the SKU), or by its
ASCII characters, or left out (an unprintable customer name). Printing Tamil needs raster printing (render the
receipt to an image and send it as `GS v 0`); that comes with the Bluetooth printer work.

**Weigh tickets**: `EscPosFormatter.formatWeighTicket(WeighTicketSlip)` prints shop, terminal, time, each line (name and
amount, `1.234 kg x 40.00/kg`, tare), the total and the code as an ESC/POS Code 128 barcode (`GS k 73`, code set B) with
the code under it. `code128Values` / `code128Widths` / `code128Bars` (ported from pos-ui `code128.ts`) let the app draw
the same barcode on screen.

Golden receipts are in `test/goldens/*.txt`. After an intentional layout change: `UPDATE_GOLDENS=1 dart test`, then
review the diff.

Tests: `dart test`.
