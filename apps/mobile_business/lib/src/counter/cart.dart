// Counter cart, ported from the web counter (packages/pos-ui/src/lib/cart.ts) so a phone bill is built exactly like a
// web one. The GST helpers mirror packages/gst/src/gst.ts. Money is paise.
//
// Totals: the server is the final word. The cart only shows an *estimate* (estimateTotal) before the bill is made;
// after POST /v1/invoices the app shows the server's totals.

import 'package:srikit_api/srikit_api.dart';

/// Half away from zero (packages/gst `round`).
int roundHalfAway(num n) => n < 0 ? -((-n) + 0.5).floor() : (n + 0.5).floor();

/// qty × rate in paise using thousandths of qty (packages/gst `lineAmount`).
int lineAmount(double qty, int rate) => roundHalfAway((qty * 1000).round() * rate / 1000);

/// The GST-exclusive rate of a catalogue price (packages/gst `exclusiveOf`).
int exclusiveOf(int price, double gstRate, bool taxInclusive) {
  if (!taxInclusive || gstRate == 0) return price;
  final bp = (gstRate * 100).round();
  return roundHalfAway(price * 10000 / (10000 + bp));
}

/// Quantities keep 3 decimals (cart.ts `roundQty`).
double roundQty(double q) => (q * 1000).round() / 1000;

/// Something that can go on a bill: a catalogue variant or a saved billing item.
class CartProduct {
  const CartProduct({
    required this.itemId,
    required this.name,
    this.sku,
    this.barcode,
    this.hsn,
    this.unit = 'pcs',
    required this.price,
    required this.taxInclusive,
    required this.gstRate,
    this.byWeight = false,
  });

  /// Sold by weight (POS catalogue `soldBy: weight`): the counter asks for the weight in kg (3 decimals).
  final bool byWeight;

  /// Variant id (catalogue) or item id (billing items): sent as the line's `itemId`.
  final String itemId;
  final String name;
  final String? sku;
  final String? barcode;
  final String? hsn;
  final String unit;

  /// Paise per unit as sold (includes GST when [taxInclusive]).
  final int price;
  final bool taxInclusive;
  final double gstRate;

  /// products.ts `fromLookup`.
  factory CartProduct.fromVariant(Variant v) => CartProduct(
        itemId: v.id,
        name: v.title.isNotEmpty ? v.title : v.name,
        sku: v.sku,
        barcode: v.barcode,
        hsn: v.hsn,
        unit: v.unit.isEmpty ? 'pcs' : v.unit,
        price: v.price,
        taxInclusive: v.taxInclusive,
        gstRate: v.gstRate,
      );

  /// An item of the POS catalogue cache (catalog-sync.ts `fromPosItem`).
  factory CartProduct.fromPosItem(PosItem i) => CartProduct(
        itemId: i.itemId,
        name: i.variantTitle.isNotEmpty && !i.name.contains(i.variantTitle) ? '${i.name} ${i.variantTitle}' : i.name,
        sku: i.sku,
        barcode: i.barcodes.firstOrNull,
        hsn: i.hsn,
        unit: i.unit.isNotEmpty ? i.unit : (i.byWeight ? 'kg' : 'pcs'),
        price: i.price,
        taxInclusive: i.taxInclusive,
        gstRate: i.gstRate,
        byWeight: i.byWeight,
      );

  /// A weigh-ticket line: the server's price per unit as the catalogue sells it.
  factory CartProduct.fromTicketLine(WeighTicketLine l) => CartProduct(
        itemId: l.itemId,
        name: l.name,
        hsn: l.hsn,
        unit: l.unit.isEmpty ? 'kg' : l.unit,
        price: l.unitPrice,
        taxInclusive: l.taxInclusive,
        gstRate: l.gstRate,
      );

  /// Billing items carry a GST-exclusive rate.
  factory CartProduct.fromItem(BillingItem i) => CartProduct(
        itemId: i.id,
        name: i.name,
        hsn: i.hsn,
        unit: i.unit.isEmpty ? 'pcs' : i.unit,
        price: i.rate,
        taxInclusive: false,
        gstRate: i.gstRate,
      );
}

class CartLine {
  const CartLine({
    required this.key,
    required this.product,
    required this.qty,
    required this.price,
    this.discount = 0,
    this.serials = const [],
    this.ticketId,
    this.ticketCode,
  });

  final String key;

  /// The weigh ticket this line came from: a fixed line (no qty / price / discount changes), removed only with the
  /// rest of its ticket.
  final String? ticketId;
  final String? ticketCode;
  bool get fixed => ticketId != null;
  final CartProduct product;
  final double qty;

  /// Price per unit on this line (the catalogue price unless changed with `invoices.discount`).
  final int price;

  /// Paise off the whole line, on the price basis (inclusive when the product is).
  final int discount;
  final List<String> serials;

  int get listPrice => product.price;
  bool get priceChanged => price != product.price;

  /// qty × price, before the line discount.
  int get gross => lineAmount(qty, price);

  /// What the customer pays for the line on the price basis (gross − discount); GST is added on top for exclusive
  /// prices (see [estimateTotal]).
  int get net => gross - clampDiscount(discount, gross);

  CartLine copyWith({double? qty, int? price, int? discount, List<String>? serials}) => CartLine(
        key: key,
        product: product,
        qty: qty ?? this.qty,
        price: price ?? this.price,
        discount: discount ?? this.discount,
        serials: serials ?? this.serials,
        ticketId: ticketId,
        ticketCode: ticketCode,
      );
}

int clampDiscount(int d, int gross) => d < 0 ? 0 : (d > gross ? gross : d);

/// An immutable cart. Every change returns a new cart.
class Cart {
  const Cart([this.lines = const []]);
  final List<CartLine> lines;

  static int _seq = 0;
  static String _newKey() => 'l${DateTime.now().microsecondsSinceEpoch}-${_seq++}';

  bool get isEmpty => lines.isEmpty;
  int get count => lines.length;
  double get units => roundQty(lines.fold(0.0, (s, l) => s + l.qty));

  /// What the line discounts save the customer.
  int get savings => lines.fold(0, (s, l) => s + clampDiscount(l.discount, l.gross));

  CartLine? line(String key) => lines.where((l) => l.key == key).firstOrNull;

  /// cart.ts `addProduct`: merge into a line with the same item, price and no discount; a serial unit is added once
  /// (one unit per scan, the same serial never twice).
  Cart add(CartProduct p, {double qty = 1, String? serial}) {
    final same =
        lines.where((l) => !l.fixed && l.product.itemId == p.itemId && l.price == p.price && l.discount == 0).firstOrNull;
    if (serial != null && serial.isNotEmpty) {
      if (lines.any((l) => l.serials.contains(serial))) return this;
      if (same != null) {
        return _replace(same.copyWith(qty: roundQty(same.qty + 1), serials: [...same.serials, serial]));
      }
      return Cart([...lines, CartLine(key: _newKey(), product: p, qty: 1, price: p.price, serials: [serial])]);
    }
    final q = qty > 0 ? roundQty(qty) : 1.0;
    if (same != null) return _replace(same.copyWith(qty: roundQty(same.qty + q)));
    return Cart([...lines, CartLine(key: _newKey(), product: p, qty: q, price: p.price)]);
  }

  /// Ignores quantities ≤ 0; serials are trimmed to ceil(qty); the discount is re-clamped.
  Cart setQty(String key, double qty) {
    final l = line(key);
    final q = roundQty(qty);
    if (l == null || l.fixed || q <= 0) return this;
    final serials = l.serials.length > q.ceil() ? l.serials.sublist(0, q.ceil()) : l.serials;
    final next = l.copyWith(qty: q, serials: serials);
    return _replace(next.copyWith(discount: clampDiscount(next.discount, next.gross)));
  }

  /// +1 / −1; never below 1 (the web's − button stops at 1).
  Cart step(String key, int by) {
    final l = line(key);
    if (l == null || l.fixed) return this;
    final q = roundQty(l.qty + by);
    return q < 1 ? this : setQty(key, q);
  }

  Cart setPrice(String key, int price) {
    final l = line(key);
    if (l == null || l.fixed || price < 0) return this;
    final next = l.copyWith(price: price);
    return _replace(next.copyWith(discount: clampDiscount(next.discount, next.gross)));
  }

  /// Paise off the line (clamped to 0..gross).
  Cart setDiscount(String key, int paise) {
    final l = line(key);
    if (l == null || l.fixed) return this;
    return _replace(l.copyWith(discount: clampDiscount(paise, l.gross)));
  }

  /// cart.ts: percent of the line's gross, rounded.
  Cart setDiscountPercent(String key, double pct) {
    final l = line(key);
    if (l == null) return this;
    return setDiscount(key, roundHalfAway(l.gross * pct.clamp(0, 100) / 100));
  }

  /// Removes the line; a weigh-ticket line takes the whole ticket with it (weigh-ticket.ts `removeLineOrTicket`).
  Cart remove(String key) {
    final l = line(key);
    if (l == null) return this;
    if (l.fixed) return removeTicket(l.ticketId!);
    return Cart(lines.where((x) => x.key != key).toList());
  }

  Cart removeTicket(String ticketId) => Cart(lines.where((l) => l.ticketId != ticketId).toList());

  /// Ticket ids on the bill, each once, in cart order.
  List<String> get ticketIds => [...{for (final l in lines) if (l.ticketId != null) l.ticketId!}];

  bool hasTicket(String ticketId) => lines.any((l) => l.ticketId == ticketId);

  /// A weigh ticket's lines as fixed lines (never merged with others). Unchanged if the ticket is already in.
  Cart addTicket(WeighTicket t) {
    if (hasTicket(t.id) || t.lines.isEmpty) return this;
    return Cart([
      ...lines,
      for (final l in t.lines)
        CartLine(
          key: _newKey(),
          product: CartProduct.fromTicketLine(l),
          qty: l.qty,
          price: l.unitPrice,
          ticketId: t.id,
          ticketCode: t.code,
        ),
    ]);
  }

  Cart _replace(CartLine l) => Cart([for (final x in lines) x.key == l.key ? l : x]);

  /// The bill lines to send (cart.ts `toLineInput`).
  List<InvoiceLineInput> toLineInputs() => [for (final l in lines) toLineInput(l)];

  /// A rough total for the button before the bill is made: Σ inclusive charged amounts + exclusive amounts with GST
  /// added, rounded to the rupee. **Only an estimate**: the server's total (after create) is the one charged.
  int get estimateTotal {
    var sum = 0;
    for (final l in lines) {
      if (l.product.taxInclusive || l.product.gstRate == 0) {
        sum += l.net;
      } else {
        sum += l.net + roundHalfAway(l.net * l.product.gstRate / 100);
      }
    }
    return roundHalfAway(sum / 100) * 100;
  }
}

/// cart.ts `toLineInput`: the exclusive rate, the discount on the exclusive basis, and for tax-inclusive prices the
/// charged amount as `inclusiveTotal` (so ₹999 stays ₹999.00).
InvoiceLineInput toLineInput(CartLine l) {
  final gstRate = l.product.gstRate;
  final rate = exclusiveOf(l.price, gstRate, l.product.taxInclusive);
  final amount = lineAmount(l.qty, rate);
  final gross = l.gross;
  final d = clampDiscount(l.discount, gross);
  int? discount;
  int? inclusiveTotal;
  if (l.product.taxInclusive && gstRate != 0) {
    final x = exclusiveOf(d, gstRate, true);
    discount = x < amount ? x : amount;
    inclusiveTotal = gross - d;
  } else if (d > 0) {
    discount = d < amount ? d : amount;
  }
  return InvoiceLineInput(
    description: l.product.name,
    qty: l.qty,
    rate: rate,
    gstRate: gstRate,
    itemId: l.product.itemId,
    discount: discount != null && discount > 0 ? discount : null,
    inclusiveTotal: inclusiveTotal,
    hsn: l.product.hsn,
    unit: l.product.unit,
    serials: l.serials,
  );
}

/// Typed text that looks like a barcode / SKU rather than a search (products.ts `looksLikeCode`).
bool looksLikeCode(String s) => RegExp(r'^[A-Za-z0-9._/-]{4,64}$').hasMatch(s.trim()) && RegExp(r'\d').hasMatch(s);
