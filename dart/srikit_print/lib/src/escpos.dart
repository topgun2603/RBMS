import 'dart:convert';

import 'receipt.dart';

enum _Align { left, center }

class _Row {
  const _Row(this.text, {this.align = _Align.left, this.bold = false, this.tall = false, this.barcode});
  final String text;

  /// Code 128 data printed as a barcode (GS k); [text] is then only the preview.
  final String? barcode;
  final _Align align;
  final bool bold;

  /// Double height (ESC/POS `GS ! 0x01`), for the shop name and total.
  final bool tall;
}

/// A receipt laid out for a [PaperWidth]: [text] is the plain preview (what the paper shows, one string per printed
/// line) and [bytes] the ESC/POS commands for the printer.
class EscPosReceipt {
  EscPosReceipt._(this.width, this._rows);
  final PaperWidth width;
  final List<_Row> _rows;

  /// Printed lines, already padded / aligned to [PaperWidth.columns].
  List<String> get lines => [for (final r in _rows) r.align == _Align.center ? _center(r.text, width.columns) : r.text];

  String get text => lines.join('\n');

  /// ESC/POS: initialise, the lines with alignment / bold / double height, feed, partial cut. Text is ASCII only.
  List<int> get bytes {
    final out = <int>[0x1B, 0x40]; // ESC @ initialise
    for (final r in _rows) {
      out.addAll([0x1B, 0x61, r.align == _Align.center ? 1 : 0]); // ESC a n: alignment
      if (r.bold) out.addAll([0x1B, 0x45, 1]); // ESC E 1: bold on
      if (r.barcode != null) {
        final data = ascii.encode('{B${r.barcode}');
        out.addAll([0x1D, 0x68, 80]); // GS h: bar height 80 dots
        out.addAll([0x1D, 0x77, 2]); // GS w: module width 2
        out.addAll([0x1D, 0x48, 0]); // GS H 0: no human-readable text (printed on its own row)
        out.addAll([0x1D, 0x6B, 73, data.length, ...data]); // GS k 73: Code 128
        out.add(0x0A);
        continue;
      }
      if (r.tall) out.addAll([0x1D, 0x21, 0x01]); // GS ! 1: double height
      out.addAll(ascii.encode(r.text));
      out.add(0x0A);
      if (r.tall) out.addAll([0x1D, 0x21, 0x00]);
      if (r.bold) out.addAll([0x1B, 0x45, 0]);
    }
    out.addAll([0x1B, 0x64, 4]); // ESC d 4: feed 4 lines
    out.addAll([0x1D, 0x56, 0x42, 0]); // GS V B 0: feed and partial cut
    return out;
  }
}

/// Formats [Receipt]s for ESC/POS thermal printers.
///
/// Most ESC/POS printers only have Latin code pages, so everything printed is ASCII: `Rs` instead of `₹`, and any
/// text with other letters (Tamil item or shop names) is replaced by its `...Fallback` (English name / SKU), or by
/// its ASCII characters only.
class EscPosFormatter {
  const EscPosFormatter(this.width);
  final PaperWidth width;

  int get _w => width.columns;

  EscPosReceipt format(Receipt r) {
    final rows = <_Row>[];
    void sep() => rows.add(_Row('-' * _w));
    void left(String s, {bool bold = false}) {
      for (final l in _wrap(s, _w)) {
        rows.add(_Row(l, bold: bold));
      }
    }

    void center(String s, {bool bold = false, bool tall = false}) {
      for (final l in _wrap(s, _w)) {
        rows.add(_Row(l, align: _Align.center, bold: bold, tall: tall));
      }
    }

    void pair(String label, String value, {bool bold = false}) => rows.add(_Row(_pair(label, value, _w), bold: bold));

    center(printable(r.shopName, r.shopNameFallback), bold: true, tall: true);
    for (final a in r.addressLines) {
      center(printable(a));
    }
    if (r.gstin != null) center('GSTIN: ${r.gstin}');
    if (r.phone != null) center('Ph: ${r.phone}');
    sep();
    center(r.title, bold: true);
    pair('Bill No: ${printable(r.billNumber)}', '');
    pair('Date: ${formatIst(r.issuedAt)}', '');
    final customer = r.customerName == null ? null : printable(r.customerName!, r.customerNameFallback);
    if (customer != null && customer != '?') left('Customer: $customer');
    if (r.customerGstin != null) left('GSTIN: ${r.customerGstin}');
    sep();
    pair('Item', 'Amount', bold: true);
    for (final l in r.lines) {
      left(printable(l.name, l.nameFallback));
      final qty = '${formatQty(l.qty)}${l.unit == null || l.unit!.isEmpty ? '' : ' ${printable(l.unit!)}'}';
      pair('  $qty x ${money(l.rate)}', money(l.amount));
      if (l.discount > 0) pair('  Discount', '-${money(l.discount)}');
      for (final s in l.serials) {
        left('  S/N: ${printable(s)}');
      }
    }
    sep();
    pair('Subtotal', money(r.subtotal));
    if (r.discount != 0) pair('Discount', '-${money(r.discount)}');
    pair('Taxable value', money(r.taxable));
    if (r.cgst != 0) pair('CGST', money(r.cgst));
    if (r.sgst != 0) pair('SGST', money(r.sgst));
    if (r.igst != 0) pair('IGST', money(r.igst));
    if (r.roundOff != 0) pair('Round off', money(r.roundOff, signed: true));
    rows.add(_Row(_pair('TOTAL', 'Rs ${money(r.total)}', _w), bold: true, tall: true));
    if (r.taxBreakup.isNotEmpty) {
      sep();
      final igst = r.taxBreakup.any((t) => t.igst != 0);
      rows.add(_Row(_columns(['GST%', 'Taxable', if (igst) 'IGST' else ...['CGST', 'SGST']], _w), bold: true));
      for (final t in r.taxBreakup) {
        rows.add(_Row(_columns([
          formatQty(t.gstRate),
          money(t.taxable),
          if (igst) money(t.igst) else ...[money(t.cgst), money(t.sgst)],
        ], _w)));
      }
    }
    if (r.payments.isNotEmpty || r.balanceDue > 0) {
      sep();
      for (final p in r.payments) {
        pair('Paid (${printable(p.method)})', money(p.amount));
      }
      if (r.change > 0) pair('Change', money(r.change));
      if (r.balanceDue > 0) pair('Balance due', money(r.balanceDue), bold: true);
    }
    if (r.footer != null && r.footer!.isNotEmpty) {
      sep();
      center(printable(r.footer!));
    }
    return EscPosReceipt._(width, rows);
  }

  /// A weighing station's ticket: shop, terminal, time, each line (name and amount, then "1.234 kg x 40.00/kg" and
  /// the tare when used), the total, the code as a Code 128 barcode with the code under it, and the footer.
  EscPosReceipt formatWeighTicket(WeighTicketSlip t) {
    final rows = <_Row>[];
    void sep() => rows.add(_Row('-' * _w));
    void center(String s, {bool bold = false, bool tall = false}) {
      for (final l in _wrap(s, _w)) {
        rows.add(_Row(l, align: _Align.center, bold: bold, tall: tall));
      }
    }

    void left(String s) {
      for (final l in _wrap(s, _w)) {
        rows.add(_Row(l));
      }
    }

    void pair(String label, String value, {bool bold = false, bool tall = false}) =>
        rows.add(_Row(_pair(label, value, _w), bold: bold, tall: tall));

    center(printable(t.shopName, t.shopNameFallback), bold: true, tall: true);
    center(t.title, bold: true);
    pair('Terminal: ${printable(t.terminalName)}', '');
    pair('Date: ${formatIst(t.issuedAt)}', '');
    sep();
    for (final l in t.lines) {
      final name = printable(l.name, l.nameFallback);
      final amount = money(l.amount);
      if (name.length + 1 + amount.length <= _w) {
        pair(name, amount);
      } else {
        left(name);
        pair('', amount);
      }
      final unit = printable(l.unit);
      pair('  ${formatWeight(l.qty, unit)} $unit x ${money(l.unitPrice)}/$unit', '');
      if (l.tareKg != null && l.tareKg! > 0) pair('  Tare ${formatWeight(l.tareKg!, 'kg')} kg', '');
    }
    sep();
    pair('TOTAL', 'Rs ${money(t.total)}', bold: true, tall: true);
    sep();
    rows.add(_Row(_barcodePreview(_w), align: _Align.center, barcode: t.code));
    center(t.code, bold: true);
    if (t.note != null && t.note!.trim().isNotEmpty) center(printable(t.note!));
    if (t.footer != null && t.footer!.isNotEmpty) center(printable(t.footer!));
    return EscPosReceipt._(width, rows);
  }
}

/// What the preview shows where the printer draws the barcode.
String _barcodePreview(int w) => '|' * (w >= 48 ? 36 : 28);

/// Weights keep 3 decimals (`1.230`); other units as [formatQty].
String formatWeight(double q, String unit) {
  final u = unit.toLowerCase();
  return u == 'kg' || u == 'kgs' ? q.toStringAsFixed(3) : formatQty(q);
}

/// [text] when it is printable ASCII; else [fallback] when that is; else [text] with everything else dropped
/// (`?` when nothing is left).
String printable(String text, [String? fallback]) {
  bool ok(String s) => s.runes.every((c) => c >= 0x20 && c < 0x7F);
  final t = text.replaceAll('₹', 'Rs ').trim();
  if (ok(t)) return t;
  if (fallback != null && fallback.trim().isNotEmpty && ok(fallback.trim())) return fallback.trim();
  final stripped = String.fromCharCodes(t.runes.where((c) => c >= 0x20 && c < 0x7F)).replaceAll(RegExp(r'\s+'), ' ').trim();
  return stripped.isEmpty ? '?' : stripped;
}

/// Paise → `1,23,456.78` (Indian grouping, no symbol). [signed] adds `+` to positive values.
String money(int paise, {bool signed = false}) {
  final neg = paise < 0;
  final abs = paise.abs();
  var rupees = (abs ~/ 100).toString();
  if (rupees.length > 3) {
    final last3 = rupees.substring(rupees.length - 3);
    var rest = rupees.substring(0, rupees.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    rupees = '${parts.join(',')},$last3';
  }
  final sign = neg ? '-' : (signed && abs > 0 ? '+' : '');
  return '$sign$rupees.${(abs % 100).toString().padLeft(2, '0')}';
}

/// `2` → `2`, `1.25` → `1.25`, `0.5` → `0.5` (up to 3 decimals).
String formatQty(double q) {
  if (q == q.roundToDouble()) return q.toInt().toString();
  return q.toStringAsFixed(3).replaceFirst(RegExp(r'0+$'), '');
}

/// `dd-MM-yyyy HH:mm` in India Standard Time (UTC+05:30, no daylight saving).
String formatIst(DateTime t) {
  final ist = t.toUtc().add(const Duration(hours: 5, minutes: 30));
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(ist.day)}-${two(ist.month)}-${ist.year} ${two(ist.hour)}:${two(ist.minute)}';
}

String _pair(String label, String value, int w) {
  if (value.isEmpty) return label.length > w ? label.substring(0, w) : label;
  final room = w - value.length - 1;
  final l = label.length > room ? label.substring(0, room < 0 ? 0 : room) : label;
  return '$l${' ' * (w - l.length - value.length)}$value';
}

/// First column left (narrow), the rest right-aligned; the second column (taxable value) takes the spare width.
/// Cells are never cut: a value wider than its column pushes the line out by a space.
String _columns(List<String> cells, int w) {
  final firstW = w >= 48 ? 10 : 6;
  final rest = cells.length - 1;
  final colW = (w - firstW) ~/ rest;
  final widths = [firstW, colW + (w - firstW - colW * rest), for (var i = 2; i < cells.length; i++) colW];
  final b = StringBuffer(cells.first.padRight(firstW));
  for (var i = 1; i < cells.length; i++) {
    final c = cells[i];
    b.write(c.length >= widths[i] ? ' $c' : c.padLeft(widths[i]));
  }
  return b.toString();
}

String _center(String s, int w) {
  if (s.length >= w) return s;
  final pad = (w - s.length) ~/ 2;
  return '${' ' * pad}$s';
}

/// Word wrap to [w] columns (long words are cut).
List<String> _wrap(String s, int w) {
  final out = <String>[];
  var line = '';
  for (var word in s.split(RegExp(r'\s+')).where((x) => x.isNotEmpty)) {
    while (word.length > w) {
      if (line.isNotEmpty) {
        out.add(line);
        line = '';
      }
      out.add(word.substring(0, w));
      word = word.substring(w);
    }
    if (line.isEmpty) {
      line = word;
    } else if (line.length + 1 + word.length <= w) {
      line = '$line $word';
    } else {
      out.add(line);
      line = word;
    }
  }
  if (line.isNotEmpty || out.isEmpty) out.add(line);
  return out;
}

/// Preview-only printer (no Bluetooth yet): returns the receipt text.
class PreviewReceiptPrinter implements ReceiptPrinter {
  const PreviewReceiptPrinter([this.width = PaperWidth.mm58]);
  final PaperWidth width;

  @override
  Future<String> print(Receipt receipt) async => EscPosFormatter(width).format(receipt).text;
}
