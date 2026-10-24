import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_business/src/counter/cart.dart';
import 'package:srikit_business/src/counter/tender.dart';
import 'package:srikit_kit/srikit_kit.dart';

const rice = CartProduct(itemId: 'v-rice', name: 'Ponni Rice 5 kg', price: 32000, taxInclusive: true, gstRate: 5, hsn: '1006');
const soap = CartProduct(itemId: 'v-soap', name: 'Soap', price: 4000, taxInclusive: false, gstRate: 18, unit: 'pcs');
const dal = CartProduct(itemId: 'v-dal', name: 'Toor Dal', price: 14000, taxInclusive: true, gstRate: 5, unit: 'kg');
const phone = CartProduct(itemId: 'v-phone', name: 'Redmi 13C', price: 1199900, taxInclusive: true, gstRate: 18);

void main() {
  group('GST helpers mirror packages/gst', () {
    test('lineAmount uses thousandths of qty', () {
      expect(lineAmount(1.005, 100), 101);
      expect(lineAmount(2, 32000), 64000);
      expect(lineAmount(1.25, 14000), 17500);
    });

    test('exclusiveOf takes GST out of inclusive prices only', () {
      expect(exclusiveOf(32000, 5, true), 30476); // 32000 × 100 / 105 = 30476.19
      expect(exclusiveOf(4000, 18, false), 4000);
      expect(exclusiveOf(4000, 0, true), 4000);
      expect(exclusiveOf(10000, 0.25, true), 9975); // basis points keep 0.25% exact
    });
  });

  group('cart rules (pos-ui cart.ts)', () {
    test('the same item merges; a discounted line does not', () {
      var c = const Cart().add(rice).add(rice);
      expect(c.count, 1);
      expect(c.lines.single.qty, 2);
      c = c.setDiscount(c.lines.single.key, 1000).add(rice);
      expect(c.count, 2);
    });

    test('weighed quantities keep 3 decimals and add up', () {
      var c = const Cart().add(dal, qty: 1.25).add(dal, qty: 1.25);
      expect(c.lines.single.qty, 2.5);
      c = c.setQty(c.lines.single.key, 0.3333);
      expect(c.lines.single.qty, 0.333);
      expect(c.setQty(c.lines.single.key, 0).lines.single.qty, 0.333); // ≤ 0 ignored
    });

    test('serial units: one per scan, never twice, trimmed with qty', () {
      var c = const Cart().add(phone, serial: 'IMEI-A').add(phone, serial: 'IMEI-A');
      expect(c.lines.single.qty, 1);
      c = c.add(phone, serial: 'IMEI-B');
      expect(c.lines.single.serials, ['IMEI-A', 'IMEI-B']);
      expect(c.lines.single.qty, 2);
      c = c.setQty(c.lines.single.key, 1);
      expect(c.lines.single.serials, ['IMEI-A']);
    });

    test('− stops at 1, + adds 1, remove drops the line', () {
      var c = const Cart().add(soap);
      final k = c.lines.single.key;
      expect(c.step(k, -1).lines.single.qty, 1);
      c = c.step(k, 1).step(k, 1);
      expect(c.lines.single.qty, 3);
      expect(c.remove(k).isEmpty, isTrue);
    });

    test('discounts are clamped to the line and re-clamped when qty drops', () {
      var c = const Cart().add(soap, qty: 2);
      final k = c.lines.single.key;
      c = c.setDiscount(k, 99999);
      expect(c.lines.single.discount, 8000);
      c = c.setQty(k, 1);
      expect(c.lines.single.discount, 4000);
      c = c.setDiscountPercent(k, 10);
      expect(c.lines.single.discount, 400);
    });
  });

  group('lines sent to the server (toLineInput)', () {
    test('inclusive price: exclusive rate, discount on the exclusive basis, inclusiveTotal = charged', () {
      var c = const Cart().add(rice, qty: 2);
      var l = toLineInput(c.lines.single);
      expect(l.rate, 30476);
      expect(l.discount, isNull);
      expect(l.inclusiveTotal, 64000);
      expect(l.itemId, 'v-rice');
      expect(l.hsn, '1006');
      c = c.setDiscount(c.lines.single.key, 1000);
      l = toLineInput(c.lines.single);
      expect(l.discount, 952); // 1000 × 100 / 105
      expect(l.inclusiveTotal, 63000);
      expect(l.toJson(), {
        'description': 'Ponni Rice 5 kg',
        'qty': 2,
        'rate': 30476,
        'gstRate': 5,
        'hsn': '1006',
        'unit': 'pcs',
        'discount': 952,
        'itemId': 'v-rice',
        'inclusiveTotal': 63000,
      });
    });

    test('exclusive price: rate as is, plain discount, no inclusiveTotal', () {
      final cart = const Cart().add(soap, qty: 3);
      final l = toLineInput(cart.setDiscount(cart.lines.single.key, 500).lines.single);
      expect(l.rate, 4000);
      expect(l.discount, 500);
      expect(l.inclusiveTotal, isNull);
    });

    test('serials go on the line', () {
      final l = toLineInput(const Cart().add(phone, serial: '861234567890123').lines.single);
      expect(l.toJson()['serials'], ['861234567890123']);
      expect(l.toJson()['qty'], 1);
    });
  });

  group('display (estimate only; the server totals the bill)', () {
    test('estimate adds GST to exclusive lines and rounds to the rupee', () {
      final c = const Cart().add(rice, qty: 2).add(soap, qty: 3);
      final soapKey = c.lines.last.key;
      final cart = c.setDiscount(soapKey, 500);
      // rice 640.00 (inclusive) + soap (120.00 − 5.00 = 115.00) + 18% (20.70) = 775.70 → ₹776
      expect(cart.estimateTotal, 77600);
      expect(formatPaise(cart.estimateTotal, decimals: false), '₹776');
      expect(formatPaise(cart.lines.first.net), '₹640.00');
      expect(cart.savings, 500);
      expect(cart.units, 5);
    });

    test('looksLikeCode', () {
      expect(looksLikeCode('8901000000011'), isTrue);
      expect(looksLikeCode('RICE5'), isTrue);
      expect(looksLikeCode('rice'), isFalse);
      expect(looksLikeCode('12'), isFalse);
    });
  });

  group('tender (pos-ui tender.ts)', () {
    test('cash over the bill gives change', () {
      final s = settle(49000, const Tenders(cash: 50000));
      expect(s.ok, isTrue);
      expect(s.change, 1000);
      expect(s.cashApplied, 49000);
    });

    test('split: UPI must be confirmed, non-cash may not exceed the bill, short is a problem', () {
      expect(settle(49000, const Tenders(upi: 20000, cash: 29000)).problems, [TenderProblem.upiUnconfirmed]);
      expect(settle(49000, const Tenders(upi: 20000, cash: 29000), upiConfirmed: true).ok, isTrue);
      expect(settle(49000, const Tenders(card: 50000)).problems, contains(TenderProblem.overNonCash));
      final short = settle(49000, const Tenders(cash: 40000));
      expect(short.problems, [TenderProblem.short]);
      expect(short.remaining, 9000);
    });

    test('credit needs the credit book and a saved customer', () {
      expect(settle(49000, const Tenders(credit: 49000)).problems,
          containsAll([TenderProblem.creditUnavailable, TenderProblem.creditNeedsCustomer]));
      expect(settle(49000, const Tenders(credit: 49000), creditAllowed: true, hasCustomer: true).ok, isTrue);
    });

    test('payments go UPI → card → cash and are capped at the server balance', () {
      const t = Tenders(upi: 20000, card: 10000, cash: 30000);
      final s = settle(49000, t, upiConfirmed: true);
      final plan = paymentsFor(s, t, upiRef: ' UTR1 ');
      expect(plan.map((p) => '${p.method}:${p.amount}'), ['upi:20000', 'card:10000', 'cash:19000']);
      expect(plan.first.reference, 'UTR1');
      // The server's total came out lower than the estimate: the last payment is trimmed.
      expect(fitPayments(plan, 45000).map((p) => '${p.method}:${p.amount}'), ['upi:20000', 'card:10000', 'cash:15000']);
    });

    test('quick notes and rupee input', () {
      expect(quickNotes(49000), [49000, 50000, 200000]);
      expect(quickNotes(12340), [12340, 13000, 15000, 20000, 50000]);
      expect(parseRupees('120'), 12000);
      expect(parseRupees('120.5'), 12050);
      expect(parseRupees('1,200.05'), 120005);
      expect(parseRupees(''), 0);
      expect(parseRupees('1.234'), isNull);
      expect(parseRupees('abc'), isNull);
    });

    test('bill date is today in IST', () {
      expect(todayIst(DateTime.utc(2026, 10, 20, 19, 0)), '2026-10-21'); // 00:30 IST
      expect(todayIst(DateTime.utc(2026, 10, 20, 18, 0)), '2026-10-20'); // 23:30 IST
    });
  });
}
