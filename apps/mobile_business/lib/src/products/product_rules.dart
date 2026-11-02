// Product and stock rules, as the web enforces them (packages/commerce-ui, packages/billing-ui) and the server
// validates them (packages/catalogue/src/service.ts, packages/inventory/src/service.ts).

/// Feature / permission keys.
abstract final class CatalogKeys {
  static const catalogue = 'catalogue';
  static const variants = 'catalogue.variants';
  static const manage = 'catalogue.manage';
  static const inventory = 'inventory';
  static const locations = 'inventory.locations';
  static const adjust = 'inventory.adjust';
}

/// GST rates the web picker offers (COMMON_GST_RATES of packages/gst/src/rates.ts: 5 / 18 / 40 from 22 Sep 2025).
/// The server accepts every rate in GST_RATES; a product that already has another one keeps it.
const gstRates = <double>[0, 5, 18, 40];

/// The picker's options: [gstRates] plus [current] when the product already has a rate outside them.
List<double> gstRateOptions(double current) => gstRates.contains(current) ? gstRates : ([...gstRates, current]..sort());

/// "5%", "0.25%", "1.5%".
String gstRateLabel(double r) => r == r.roundToDouble() ? '${r.toInt()}%' : '$r%';

/// Unit suggestions from the web product form.
const unitSuggestions = ['pcs', 'nos', 'pair', 'set', 'box', 'pack', 'kg', 'g', 'm', 'l', 'ml', 'dozen'];

/// SKU / barcode: 1–64 characters, no spaces. Empty means "none". Returns an error key or null.
String? validateCode(String s) {
  final t = s.trim();
  if (t.isEmpty) return null;
  if (t.length > 64) return 'tooLong';
  if (!RegExp(r'^\S+$').hasMatch(t)) return 'spaces';
  return null;
}

/// Whole-paise money, 0 to ₹2 crore (service.ts `money`).
const maxPaise = 2000000000;

/// MRP above the price shows as a discount (format.ts); the server doesn't require MRP ≥ price.
int? discountPercent(int price, int? mrp) => mrp == null || mrp <= price || mrp == 0 ? null : ((mrp - price) * 100 / mrp).round();

/// The body the web form sends for a new simple product (commerce-ui model.ts `createPayload`): one variant, the
/// web's defaults (5% GST, pcs, tax-inclusive, active, store + billing).
Map<String, Object?> simpleProductBody({
  required String name,
  String? categoryId,
  required int price,
  int? mrp,
  String? barcode,
  String? sku,
  bool taxInclusive = true,
  double gstRate = 5,
  String unit = 'pcs',
  String? hsn,
}) =>
    {
      'name': name.trim(),
      'categoryId': categoryId,
      if (hsn != null && hsn.trim().isNotEmpty) 'hsn': hsn.trim(),
      'gstRate': gstRate == gstRate.roundToDouble() ? gstRate.toInt() : gstRate,
      'unit': unit.trim().isEmpty ? 'pcs' : unit.trim(),
      'taxInclusive': taxInclusive,
      'status': 'active',
      'channels': const ['store', 'billing'],
      'variants': [
        {
          'sku': sku == null || sku.trim().isEmpty ? null : sku.trim(),
          'barcode': barcode == null || barcode.trim().isEmpty ? null : barcode.trim(),
          'optionValues': const <String, Object?>{},
          'title': null,
          'price': price,
          'mrp': mrp,
          'position': 0,
        },
      ],
    };

// ---------------------------------------------------------------- stock

enum AdjustMode { add, remove, set }

enum AdjustError { empty, invalid, tooManyDecimals, zero, tooLarge, noteTooLong }

/// Quantities: digits with up to 3 decimals, any unit (the web's `/^\d*\.?\d{0,3}$/`).
double? parseQty(String s) {
  final t = s.trim();
  if (t.isEmpty || t == '.') return null;
  if (!RegExp(r'^\d*\.?\d{0,3}$').hasMatch(t)) return null;
  return double.tryParse(t);
}

/// inventory service.ts `adjustSchema`: qty ≥ 0 with ≤ 3 decimals, at most 1e9; `add` / `remove` need more than 0
/// (`set` may be 0); note ≤ 500.
AdjustError? validateAdjust(AdjustMode mode, String qty, {String note = ''}) {
  final t = qty.trim();
  if (t.isEmpty) return AdjustError.empty;
  if (RegExp(r'^\d*\.\d{4,}$').hasMatch(t)) return AdjustError.tooManyDecimals;
  final q = parseQty(t);
  if (q == null) return AdjustError.invalid;
  if (q > 1e9) return AdjustError.tooLarge;
  if (q == 0 && mode != AdjustMode.set) return AdjustError.zero;
  if (note.trim().length > 500) return AdjustError.noteTooLong;
  return null;
}

/// Stock after the adjustment (the server doesn't clamp: `remove` can go below zero).
double stockAfter(double current, AdjustMode mode, double qty) => switch (mode) {
      AdjustMode.add => current + qty,
      AdjustMode.remove => current - qty,
      AdjustMode.set => qty,
    };

/// The web warns (but allows) when an adjustment leaves negative stock.
bool goesNegative(double current, AdjustMode mode, double qty) => stockAfter(current, mode, qty) < 0;

/// The web shows a location picker only with more than one active location.
bool showLocationPicker(bool locationsFeature, int activeLocations) => locationsFeature && activeLocations > 1;
