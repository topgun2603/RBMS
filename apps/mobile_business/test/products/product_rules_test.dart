import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_business/src/products/product_rules.dart';

void main() {
  group('stock adjust validation (inventory service.ts adjustSchema)', () {
    test('quantities: up to 3 decimals for any unit, never negative', () {
      expect(validateAdjust(AdjustMode.add, '2.5'), isNull);
      expect(validateAdjust(AdjustMode.add, '0.125'), isNull);
      expect(validateAdjust(AdjustMode.add, '0.1255'), AdjustError.tooManyDecimals);
      expect(validateAdjust(AdjustMode.add, ''), AdjustError.empty);
      expect(validateAdjust(AdjustMode.add, '-1'), AdjustError.invalid);
      expect(validateAdjust(AdjustMode.add, '1e3'), AdjustError.invalid);
      expect(validateAdjust(AdjustMode.add, '2000000000'), AdjustError.tooLarge);
    });

    test('add / remove need more than 0; set may be 0', () {
      expect(validateAdjust(AdjustMode.add, '0'), AdjustError.zero);
      expect(validateAdjust(AdjustMode.remove, '0.000'), AdjustError.zero);
      expect(validateAdjust(AdjustMode.set, '0'), isNull);
    });

    test('note at most 500 characters', () {
      expect(validateAdjust(AdjustMode.set, '3', note: 'x' * 500), isNull);
      expect(validateAdjust(AdjustMode.set, '3', note: 'x' * 501), AdjustError.noteTooLong);
    });

    test('stock after, and the negative warning (allowed, like the web)', () {
      expect(stockAfter(2.5, AdjustMode.add, 1.25), 3.75);
      expect(stockAfter(2.5, AdjustMode.remove, 3), -0.5);
      expect(stockAfter(2.5, AdjustMode.set, 10), 10);
      expect(goesNegative(2.5, AdjustMode.remove, 3), isTrue);
      expect(goesNegative(2.5, AdjustMode.remove, 2.5), isFalse);
      expect(parseQty('1.250'), 1.25);
      expect(parseQty('.5'), 0.5);
      expect(parseQty('.'), isNull);
    });

    test('location picker only with more than one location', () {
      expect(showLocationPicker(true, 2), isTrue);
      expect(showLocationPicker(true, 1), isFalse);
      expect(showLocationPicker(false, 3), isFalse);
    });
  });

  group('product rules', () {
    test('SKU / barcode: no spaces, at most 64', () {
      expect(validateCode(''), isNull);
      expect(validateCode('8901000000011'), isNull);
      expect(validateCode('RICE 5'), 'spaces');
      expect(validateCode('x' * 65), 'tooLong');
    });

    test('MRP above price shows a discount; no rule that MRP ≥ price', () {
      expect(discountPercent(32000, 35000), 9);
      expect(discountPercent(32000, 32000), isNull);
      expect(discountPercent(32000, 30000), isNull);
      expect(discountPercent(32000, null), isNull);
    });

    test('a simple product is sent like the web form: one variant, web defaults', () {
      final b = simpleProductBody(name: ' Sugar 1 kg ', price: 4800, mrp: 5200, barcode: ' 890100 ', categoryId: 'cat-grocery');
      expect(b['name'], 'Sugar 1 kg');
      expect(b['gstRate'], 5);
      expect(b['unit'], 'pcs');
      expect(b['taxInclusive'], isTrue);
      expect(b['status'], 'active');
      expect(b['channels'], ['store', 'billing']);
      expect(b['variants'], [
        {'sku': null, 'barcode': '890100', 'optionValues': <String, Object?>{}, 'title': null, 'price': 4800, 'mrp': 5200, 'position': 0},
      ]);
      expect(simpleProductBody(name: 'Ghee', price: 1, gstRate: 12, taxInclusive: false, unit: '')['unit'], 'pcs');
    });
  });
}
