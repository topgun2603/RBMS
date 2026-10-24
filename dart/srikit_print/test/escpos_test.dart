import 'dart:io';

import 'package:srikit_print/srikit_print.dart';
import 'package:test/test.dart';

/// Golden receipts live in test/goldens/*.txt. Regenerate with `UPDATE_GOLDENS=1 dart test` and review the diff.
void expectGolden(String actual, String name) {
  final file = File('test/goldens/$name.txt');
  if (Platform.environment['UPDATE_GOLDENS'] == '1') {
    file.parent.createSync(recursive: true);
    file.writeAsStringSync('$actual\n');
  }
  expect(actual, file.readAsStringSync().replaceAll('\r\n', '\n').trimRight());
}

final sample = Receipt(
  shopName: 'Anna Stores',
  addressLines: const ['12 Car Street, Mylapore', 'Chennai 600004'],
  gstin: '33ABCDE1234F1Z5',
  phone: '+91 98765 43210',
  billNumber: 'INV-0042',
  issuedAt: DateTime.utc(2026, 10, 21, 8, 35), // 14:05 IST
  customerName: 'Walk-in',
  lines: const [
    ReceiptLine(name: 'Ponni Raw Rice 5kg', qty: 2, rate: 32000, amount: 64000),
    ReceiptLine(name: 'பால் 500ml', nameFallback: 'Milk 500ml', qty: 3, rate: 2700, amount: 8000, discount: 100),
    ReceiptLine(name: 'Toor Dal', qty: 1.25, unit: 'kg', rate: 14000, amount: 17500),
    ReceiptLine(
      name: 'Redmi 13C 4/128 Midnight Black with a very long name',
      qty: 1,
      rate: 1199900,
      amount: 1199900,
      serials: ['861234567890123'],
    ),
  ],
  subtotal: 1290500,
  discount: 100,
  taxable: 1101429,
  cgst: 94486,
  sgst: 94486,
  roundOff: -1,
  total: 1290400,
  taxBreakup: const [
    ReceiptTax(gstRate: 5, taxable: 85333, cgst: 2133, sgst: 2133),
    ReceiptTax(gstRate: 18, taxable: 1016096, cgst: 92353, sgst: 92353),
  ],
  payments: const [ReceiptPayment(method: 'Cash', amount: 1300000)],
  change: 9600,
);

void main() {
  test('58 mm receipt', () {
    final r = const EscPosFormatter(PaperWidth.mm58).format(sample);
    expect(r.lines.every((l) => l.length <= 32), isTrue, reason: r.lines.where((l) => l.length > 32).join('\n'));
    expectGolden(r.text, 'receipt_58mm');
  });

  test('80 mm receipt', () {
    final r = const EscPosFormatter(PaperWidth.mm80).format(sample);
    expect(r.lines.every((l) => l.length <= 48), isTrue);
    expectGolden(r.text, 'receipt_80mm');
  });

  test('IGST bill on credit, Tamil shop name with an English fallback', () {
    final r = const EscPosFormatter(PaperWidth.mm58).format(Receipt(
      shopName: 'அண்ணா ஸ்டோர்ஸ்',
      shopNameFallback: 'Anna Stores',
      billNumber: 'INV-0043',
      issuedAt: DateTime.utc(2026, 10, 20, 20, 0), // 01:30 IST the next day
      customerName: 'முருகன்', // unprintable, no fallback: the line is left out
      customerGstin: '29AAACB1234C1Z2',
      lines: const [ReceiptLine(name: 'Saree', qty: 1, rate: 100000, amount: 105000)],
      subtotal: 100000,
      taxable: 100000,
      igst: 5000,
      total: 105000,
      taxBreakup: const [ReceiptTax(gstRate: 5, taxable: 100000, igst: 5000)],
      payments: const [ReceiptPayment(method: 'UPI', amount: 50000)],
      balanceDue: 55000,
    ));
    expectGolden(r.text, 'receipt_igst_credit');
    expect(r.text, isNot(contains('அ')));
  });

  test('ESC/POS bytes: init, ASCII only, cut', () {
    final b = const EscPosFormatter(PaperWidth.mm58).format(sample).bytes;
    expect(b.take(2), [0x1B, 0x40]);
    expect(b.skip(b.length - 4), [0x1D, 0x56, 0x42, 0]);
    expect(b.every((x) => x >= 0 && x < 0x80), isTrue);
  });

  group('helpers', () {
    test('money', () {
      expect(money(12345678), '1,23,456.78');
      expect(money(5), '0.05');
      expect(money(-150), '-1.50');
      expect(money(-1, signed: true), '-0.01');
      expect(money(1, signed: true), '+0.01');
    });

    test('printable falls back to ASCII', () {
      expect(printable('Rice'), 'Rice');
      expect(printable('பால்', 'Milk'), 'Milk');
      expect(printable('பால் 1L'), '1L');
      expect(printable('பால்'), '?');
      expect(printable('₹10 off'), 'Rs 10 off');
    });

    test('IST date and quantities', () {
      expect(formatIst(DateTime.utc(2026, 12, 31, 18, 45)), '01-01-2027 00:15');
      expect(formatQty(2), '2');
      expect(formatQty(1.25), '1.25');
      expect(formatQty(0.5), '0.5');
    });

    test('preview printer returns the text', () async {
      expect(await const PreviewReceiptPrinter().print(sample), const EscPosFormatter(PaperWidth.mm58).format(sample).text);
    });
  });
}
