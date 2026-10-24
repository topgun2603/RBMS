import 'package:srikit_print/srikit_print.dart';
import 'package:test/test.dart';

import 'escpos_test.dart' show expectGolden;

final slip = WeighTicketSlip(
  shopName: 'Murugan Stores',
  terminalName: 'Weighing 1',
  code: 'W26102200017',
  issuedAt: DateTime.utc(2026, 10, 22, 5, 0), // 10:30 IST
  lines: const [
    WeighTicketSlipLine(name: 'Tomato', qty: 1.234, unit: 'kg', unitPrice: 4000, amount: 4936, tareKg: 0.05),
    WeighTicketSlipLine(name: 'தக்காளி நாட்டு', nameFallback: 'Country Tomato', qty: 0.5, unit: 'kg', unitPrice: 6000, amount: 3000),
    WeighTicketSlipLine(name: 'Basmati Rice Premium Long Grain Loose', qty: 2.75, unit: 'kg', unitPrice: 12850, amount: 35338),
    WeighTicketSlipLine(name: 'Coconut', qty: 2, unit: 'pcs', unitPrice: 3500, amount: 7000),
  ],
  total: 50274,
);

int _indexOf(List<int> hay, List<int> needle) {
  for (var i = 0; i + needle.length <= hay.length; i++) {
    var ok = true;
    for (var j = 0; j < needle.length; j++) {
      if (hay[i + j] != needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

void main() {
  test('weigh ticket 58 mm', () {
    final r = const EscPosFormatter(PaperWidth.mm58).formatWeighTicket(slip);
    expect(r.lines.every((l) => l.length <= 32), isTrue, reason: r.lines.where((l) => l.length > 32).join('\n'));
    expectGolden(r.text, 'weigh_ticket_58mm');
  });

  test('weigh ticket 80 mm', () {
    final r = const EscPosFormatter(PaperWidth.mm80).formatWeighTicket(slip);
    expect(r.lines.every((l) => l.length <= 48), isTrue);
    expectGolden(r.text, 'weigh_ticket_80mm');
  });

  test('the ticket bytes carry the code as an ESC/POS Code 128 barcode (code set B), ASCII only', () {
    final bytes = const EscPosFormatter(PaperWidth.mm58).formatWeighTicket(slip).bytes;
    final data = '{BW26102200017'.codeUnits;
    expect(_indexOf(bytes, [0x1D, 0x6B, 73, data.length, ...data]), greaterThan(0));
    expect(bytes.every((b) => b < 0x80), isTrue);
    expect(bytes.sublist(bytes.length - 4), [0x1D, 0x56, 0x42, 0]);
  });

  group('Code 128', () {
    test('a ticket code uses set B with the modulo-103 check (same values as the web)', () {
      expect(code128Values('W26102200017'), [104, 55, 18, 22, 17, 16, 18, 18, 16, 16, 16, 17, 23, 96, 106]);
    });

    test('an even run of digits uses set C', () {
      expect(code128Values('12345678'), [105, 12, 34, 56, 78, 47, 106]);
    });

    test('every symbol is 11 modules, the stop 13; bars alternate', () {
      final b = code128Bars('W26102200017');
      expect(b.modules, 14 * 11 + 13);
      expect(code128Widths('W26102200017').length, 14 * 6 + 7);
      expect(b.bars.first.x, 0);
      expect(b.bars.last.x + b.bars.last.w, b.modules);
    });

    test('non-ASCII cannot be encoded', () {
      expect(() => code128Values('₹10'), throwsArgumentError);
    });
  });
}
