# Print bridge

A tiny local service that lets the web counter print to a receipt printer that the browser can't reach directly
(a LAN printer on TCP 9100, or a USB printer installed in Windows / CUPS). It receives raw ESC/POS bytes from the app
and forwards them, unchanged, to the printer named in its config. Full setup guide: `docs/printing.md`.

- Node 18+ only, no `npm install`.
- Listens on `127.0.0.1` (this PC only).
- Needs the bearer token from the config; browser requests must come from `allowedOrigins`.
- Only `GET /health` and `POST /print?printer=<name>`. The printer is looked up by name in the config, so the page can't
  choose a host, a command or a file. Max 512 KB per job.

## Install (Windows)

1. Install Node 22 LTS (nodejs.org).
2. Copy this folder to the counter PC, e.g. `C:\srikit-print-bridge`.
3. `node bridge.mjs --new-token` and paste the output as `token` in a copy of `config.example.json` saved as `config.json`.
4. Set `allowedOrigins` to the address you open the counter on (e.g. `https://acme.yourapp.com`), and `printers`:
   - Windows queue: `{ "type": "windows", "printer": "<exact name in Devices and Printers>" }`
   - LAN: `{ "type": "tcp", "host": "192.168.1.50", "port": 9100 }`
   - Linux / macOS: `{ "type": "cups", "queue": "<lpstat -p name>" }`
5. `node bridge.mjs` and keep it running. To start with Windows: Task Scheduler, "At log on", action
   `node C:\srikit-print-bridge\bridge.mjs`.
6. In the app: Settings, Printing, Printer = "Local print bridge", paste the token, Test print.

## Safety notes

- Keep `config.json` private (it holds the token). Use a different token per PC.
- The bridge never runs anything the browser sends. The Windows path runs the fixed `raw-print.ps1` with the configured
  printer name; the CUPS path runs `lp` with the configured queue; both without a shell.
- It does not use TLS: it is bound to the loopback address, and browsers treat `http://127.0.0.1` as a secure origin.

## Test

`npx vitest run tools/print-bridge` from the repo root.
