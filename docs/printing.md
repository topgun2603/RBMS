# Direct thermal printing and cash drawer

Status: built and unit-tested (golden ESC/POS byte arrays, mock `navigator.usb` / `serial` / `bluetooth`, bridge HTTP
tests). **Nobody has run it against a physical printer or cash drawer yet.** Treat the first hour on real hardware as
the hardware test: use Settings, Printing, Test print, and look at the paper.

Without a direct printer set up on a computer, nothing changes: the counter keeps printing the thermal PDF through the
browser (and the in-page 80 mm receipt if that fails).

## How it fits together

| Piece | Where |
|---|---|
| ESC/POS builder, receipt formatter, transports, config | `packages/receipt-print` (no dependencies) |
| Settings, Printing page (English + Tamil) | `packages/pos-ui/src/pages/printing.tsx`, route `pos-printing` under Settings |
| Counter receipt screen: Print, auto-print, drawer on cash | `packages/pos-ui/src/components/receipt-view.tsx` |
| "No sale (open drawer)" | top bar of the counter (`components/drawer-button.tsx`) |
| Bill page "Print receipt" | `packages/billing-ui/src/pages/invoice-detail.tsx` (`lib/direct-print.ts`) |
| Local print bridge | `tools/print-bridge` |
| Shop defaults | settings namespace `printing` (`apps/api/src/app-settings.ts`) |

The receipt is laid out from the same invoice fields the thermal PDF uses (shop block, lines, taxable / CGST / SGST /
IGST, round off, payments, change, balance). It is built in the browser from the issued bill, not fetched from the PDF
renderer, so the two can differ in small layout details.

### Text and Tamil

Receipts that are plain ASCII (plus the rupee sign, printed as "Rs.", and common punctuation) go out as printer text:
fast, uses the printer's own font, `charsPerLine` columns (32 on 58 mm, 48 on 80 mm).
If any line has a character outside ASCII (Tamil item names, a Tamil receipt), the text part is drawn on a canvas with
the page fonts (Noto Sans Tamil first) and sent as a raster image, `printWidth` dots wide (384 on 58 mm, 576 on 80 mm).
QR codes, barcodes, the cut and the drawer pulse stay native commands. Without a canvas (not a browser) non-ASCII
characters print as "?".

### Transports

| Choice | Needs | Notes |
|---|---|---|
| USB (WebUSB) | Chrome / Edge, https or localhost | On Windows the printer must use the WinUSB driver (Zadig), otherwise Windows keeps the printer and the browser cannot claim it. Use the bridge instead if that is a problem. Linux / ChromeOS / Android usually work. |
| Serial (Web Serial) | Chrome / Edge | RS-232 and USB-to-serial; printers that appear as a COM port; Bluetooth printers paired in the OS as a serial port. Set the baud rate (9600 is the usual default, many Bluetooth ones use 115200). |
| Bluetooth LE | Chrome / Edge on Windows, Android, macOS, ChromeOS | Only BLE printers. The writable GATT characteristic is found automatically (common printer service ids are requested); writes go out in 100 byte pieces. Classic Bluetooth (SPP) printers are not reachable: use Serial or the bridge. Not available on iOS or Firefox. |
| Local print bridge | `tools/print-bridge` running on this PC | LAN printers (TCP 9100), printers installed in Windows, CUPS queues. |

If the browser lacks an API (or the page is not https/localhost) that choice is greyed out in the page, and a saved
choice that stops working prints through the browser with a short note.

The first connection needs a click: Settings, Printing, Connect printer (the browser shows its own picker). After that
the browser remembers the permission and the counter reconnects by itself. Auto-print right after a sale cannot open a
picker, so if the permission is gone it reports "printer isn't connected" and uses the browser print.

## Settings, Printing

Two layers, merged as built-in defaults, then shop defaults, then this computer:

- **This computer** (localStorage, key `sr_print:cfg:<shop>`): connection type, serial baud rate, bridge address,
  token and printer name, what was paired. These are never shop defaults (the token is a secret and the printer is
  plugged into one PC).
- **Layout**: paper width, characters per line, print width in dots, header and footer lines (up to 6 each), logo,
  UPI / e-invoice QR, paper cutter, auto-print after payment, open the drawer on cash, drawer connector pin.
  "Use for this computer" saves them locally; "Save as shop default" writes the `printing` settings namespace
  (owner / admin only, the API refuses others) and clears this computer's layout overrides; "Use the shop default here"
  clears them without saving anything to the shop.

Buttons: Connect printer (pairing), Test print (a ruler of your width, bold, right-aligned text, a QR and, for the Tamil
test, a Tamil line), Open drawer.

### What happens at the counter

- Print on the receipt screen (or the `P` key) and "Print receipt" on a bill page use the direct printer when this
  computer has one, otherwise the old behaviour.
- After payment: if auto-print is on (this switch, the terminal's setting or the Printing page) the receipt prints
  automatically, and the drawer pulse is sent with it when a cash payment was part of the bill and "open the drawer on
  cash" is on. With auto-print off, the drawer alone opens for cash bills. Reprints never open the drawer.
- "No sale (open drawer)" in the counter's top bar and menu: shown only when this computer has a direct printer and the
  signed-in cashier has the till permission (`pos.till`, "open and close the POS cash drawer").
- Audit: each drawer opening (cash sale, no sale, test) is recorded in a device log (`sr_print:drawer-log`, last 200,
  and the console). There is **no server audit entry** for "No sale" yet: it is not an API call, and adding a route
  means touching the permissions map. If you need it, add a small `POST /v1/pos/drawer-open` (permission `pos.till`);
  the host's audit hook records every successful mutating request on its own.

## Printer set-up notes

All of these are from the manufacturers' usual defaults and public documentation, not from a test here.

**Epson TM-T82 / TM-T20 (USB, 80 mm).** Paper 80 mm, 48 characters, 576 dots, partial cut, drawer pin 2. On Windows, keep
the Epson driver and use the bridge with `{ "type": "windows", "printer": "<name in Devices and Printers>" }`; or
replace the driver with WinUSB (Zadig) and use USB. The drawer plugs into the printer's RJ11 DK port.
TM-T82X / T82III on Ethernet: use the bridge `tcp` printer on port 9100.

**TVS RP3160 Gold (USB / serial / LAN variants, 80 mm).** Same settings as the Epson (ESC/POS compatible). Install the
TVS driver and use the bridge with the Windows printer name, or use the LAN model with `tcp`. For the serial model use
Web Serial; 9600 baud is common but check the printer's self-test sheet (hold FEED while powering on).

**Posiflex (PP-8800, PP-6900 and similar).** ESC/POS, 80 mm, 48 characters. Serial or USB-virtual-COM models work with
Web Serial; Ethernet models with the bridge. If the drawer does not move, switch the drawer connector to pin 5.

**Generic 58 mm Bluetooth printer (MTP-II, PT-210, Goojprt and the like).** Paper 58 mm, 32 characters, 384 dots, no
cutter (set "No cutter"). Most are BLE: choose Bluetooth LE, Connect printer, pick the printer in the browser list. If
it is not listed, or only appears in the phone's own Bluetooth settings as a classic device, pair it in the OS and use
Serial (it appears as a COM port) or the bridge. Android Chrome works, iOS does not. Bluetooth printers do not drive a
cash drawer.

**Cash drawers.** The drawer connects to the printer (RJ11 / RJ12), never to the PC. The pulse is `ESC p 0 25 250`
(pin 2, 50 ms on, 500 ms off); the Printing page can switch to pin 5. 12 V and 24 V drawers both exist: use the one your
printer supplies.

If the receipt prints but wraps early or runs off the edge, adjust "characters per line" (try 42 on 80 mm Font B
printers, 30 on narrow 58 mm heads) and for Tamil receipts the print width in dots (512 on many 72 mm printable areas).

## The print bridge

For printers the browser cannot reach directly. A small Node 18+ script, no packages to install, that listens on
`127.0.0.1` and forwards raw ESC/POS bytes to a printer you named in its config.

1. Install Node 22 LTS on the counter PC and copy `tools/print-bridge` to it.
2. `node bridge.mjs --new-token`, put the result in `config.json` (copy `config.example.json`), set `allowedOrigins`
   to the address the counter is opened on (bare origin, e.g. `https://acme.yourapp.com`) and the printers:
   `windows` (exact Windows printer name; uses the spooler's RAW mode through the fixed `raw-print.ps1`),
   `tcp` (host and port, usually 9100) or `cups` (queue name).
3. `node bridge.mjs`; to start with Windows, make a Task Scheduler task "at log on" that runs it.
4. In Settings, Printing: connection "Local print bridge", address `http://127.0.0.1:9101`, the token, the printer name
   from the config (`default` if you used that), then Test print.

Safety properties (covered by `tools/print-bridge/bridge.test.mjs`): loopback only; bearer token on every request;
browser requests must come from `allowedOrigins` (any other Origin gets 403 and no CORS headers); only `GET /health`
and `POST /print?printer=<name>`; the printer is looked up by name in the config, so a request cannot choose a host, a
file or a command; body is never interpreted and limited to 512 KB; the Windows and CUPS paths run fixed programs with
arguments from the config, without a shell. It is plain http on the loopback address (browsers allow that from https
pages). Keep `config.json` private (it is in `.gitignore`).

## Tests

```
cd packages/receipt-print && npx vitest run --maxWorkers=2     # builder goldens, formatter, canvas, transports, config, shop
cd packages/pos-ui && npx vitest run --maxWorkers=2            # Printing form, page wiring, en/ta messages
npx vitest run tools/print-bridge                              # from the repo root
```

What the tests prove: exact ESC/POS bytes for init, text, align, bold, size, feed, cut, drawer pulse, QR, CODE128 and
EAN13, raster bands; line wrapping and column alignment; 58 mm vs 80 mm; the Tamil image path switch; transport
selection and the pairing / chunking / error mapping against mock `navigator` objects; config layering; the bridge's
auth, origin and body rules.

What they do not prove: that any real printer accepts these bytes (code page, raster band size, QR model support and
cutter variants differ between models), that WebUSB can claim your printer on your OS, BLE MTU and characteristic
choice on real devices, canvas text quality of Tamil fonts at 24 px, or the Windows RAW script against a real spooler.

## Known limits

- Server audit for "No sale" is not implemented (device log only); see above.
- No status read-back (paper out, cover open, drawer state); a successful write only means the bytes were sent.
- Text uses the printer's default ASCII table; any other script is sent as an image, which is slower (a long Tamil
  receipt is a few hundred KB over Bluetooth).
- One printer per computer and shop. Kitchen / label printers are not covered (the barcode label printer is separate).
- The Flutter app keeps its own ESC/POS text printing (`counter_text.dart`) and does not use this package.
- Shop logo printing loads the shop's logo URL on a canvas; a logo served without CORS headers is skipped silently.
