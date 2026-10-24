import 'package:flutter/material.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';
import 'package:srikit_print/srikit_print.dart';

import '../../l10n/app_localizations.dart';

/// [code] as a Code 128 barcode (srikit_print's encoder, the same bars as the web ticket), black on white with quiet
/// zones so a counter scanner reads it from the screen.
class Code128Barcode extends StatelessWidget {
  const Code128Barcode(this.code, {super.key, this.height = 96});
  final String code;
  final double height;

  @override
  Widget build(BuildContext context) => Container(
        color: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: SizedBox(
          height: height,
          width: double.infinity,
          child: Semantics(label: code, child: CustomPaint(painter: _Code128Painter(code))),
        ),
      );
}

class _Code128Painter extends CustomPainter {
  _Code128Painter(this.code) : bars = code128Bars(code);
  final String code;
  final ({List<Code128Bar> bars, int modules}) bars;

  /// Quiet zone on each side, in modules.
  static const quiet = 10;

  @override
  void paint(Canvas canvas, Size size) {
    final total = bars.modules + 2 * quiet;
    // Whole device pixels per module would be crisper; at phone widths a module is ~1.5–2 px either way.
    final m = size.width / total;
    final paint = Paint()..color = Colors.black;
    for (final b in bars.bars) {
      canvas.drawRect(Rect.fromLTWH((quiet + b.x) * m, 0, b.w * m, size.height), paint);
    }
  }

  @override
  bool shouldRepaint(_Code128Painter old) => old.code != code;
}

/// The printed form of a ticket (srikit_print's weigh-ticket layout).
WeighTicketSlip slipFor(WeighTicket t, {required String shopName, required String terminalName}) => WeighTicketSlip(
      shopName: shopName,
      terminalName: terminalName,
      code: t.code,
      issuedAt: t.createdAt ?? DateTime.now(),
      total: t.total,
      note: t.note,
      lines: [
        for (final l in t.lines)
          WeighTicketSlipLine(name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount, tareKg: l.tareKg),
      ],
    );

String _qty(WeighTicketLine l) => l.unit.toLowerCase().startsWith('kg') ? l.qty.toStringAsFixed(3) : formatQty(l.qty);

/// The issued ticket: code as a barcode and text, lines with the server's prices, total, Print (preview).
class TicketScreen extends StatelessWidget {
  const TicketScreen({super.key, required this.ticket, required this.shopName, required this.terminalName, this.paperWidth = 58});
  final WeighTicket ticket;
  final String shopName;
  final String terminalName;
  final int paperWidth;

  static const printButton = Key('ticket.print');
  static const nextButton = Key('ticket.next');

  Future<void> _print(BuildContext context) async {
    final l = AppLocalizations.of(context);
    final text = EscPosFormatter(paperWidth == 80 ? PaperWidth.mm80 : PaperWidth.mm58)
        .formatWeighTicket(slipFor(ticket, shopName: shopName, terminalName: terminalName))
        .text;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.printPreviewTitle),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l.printComingNext),
              const SizedBox(height: 12),
              Container(
                color: Colors.white,
                padding: const EdgeInsets.all(8),
                child: Text(text,
                    key: const Key('ticket.printText'),
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.black, height: 1.2)),
              ),
            ],
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l.closeLabel))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final t = ticket;
    return Scaffold(
      appBar: AppBar(title: Text(l.ticketTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(l.ticketHint, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          Code128Barcode(t.code),
          const SizedBox(height: 4),
          Text(t.code, key: const Key('ticket.code'), textAlign: TextAlign.center, style: theme.textTheme.headlineSmall?.copyWith(letterSpacing: 2)),
          const Divider(height: 24),
          for (final line in t.lines)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(line.name),
              subtitle: Text('${_qty(line)} ${line.unit} × ${formatPaise(line.unitPrice)}'
                  '${line.tareKg != null && line.tareKg! > 0 ? ' · ${l.tareLabel} ${line.tareKg!.toStringAsFixed(3)}' : ''}'),
              trailing: Text(formatPaise(line.amount), style: theme.textTheme.titleSmall),
            ),
          const Divider(),
          Row(children: [
            Expanded(child: Text(l.totalLabel, style: theme.textTheme.titleLarge)),
            Text(formatPaise(t.total), key: const Key('ticket.total'), style: theme.textTheme.titleLarge),
          ]),
          const SizedBox(height: 24),
          OutlinedButton.icon(key: printButton, onPressed: () => _print(context), icon: const Icon(Icons.print), label: Text(l.printTicket)),
          const SizedBox(height: 8),
          FilledButton.icon(
            key: nextButton,
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.navigate_next),
            label: Text(l.nextCustomer),
          ),
        ],
      ),
    );
  }
}
