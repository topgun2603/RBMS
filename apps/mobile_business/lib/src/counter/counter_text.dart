import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_print/srikit_print.dart';

import '../../l10n/app_localizations.dart';
import 'cart.dart';

/// Display name of a payment method.
String methodLabel(AppLocalizations l, String method) => switch (method) {
      'cash' => l.methodCash,
      'upi' => l.methodUpi,
      'card' => l.methodCard,
      'bank' => l.methodBank,
      'cheque' => l.methodCheque,
      _ => l.methodOther,
    };

/// `1`, `1.5`, `0.25` (up to 3 decimals).
String qtyText(double q) => formatQty(q);

/// Local `HH:mm`.
String clock(DateTime? t) {
  if (t == null) return '';
  final x = t.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(x.hour)}:${two(x.minute)}';
}

/// Paise → the text a cashier types (`120`, `120.50`).
String rupeesInput(int paise) => paise % 100 == 0 ? '${paise ~/ 100}' : (paise / 100).toStringAsFixed(2);

/// The server's bill as a printable [Receipt]. Every amount is the server's; nothing is recomputed. Item names that
/// the printer can't print (Tamil) fall back to the SKU from the cart; payment methods print in English (ESC/POS
/// printers have no Tamil font).
Receipt receiptFor(Invoice bill, {required String shopName, required int change, List<CartLine> cart = const []}) {
  final s = bill.seller;
  final skuById = {for (final l in cart) l.product.itemId: l.product.sku};
  String method(String m) => switch (m) {
        'cash' => 'Cash',
        'upi' => 'UPI',
        'card' => 'Card',
        'bank' => 'Bank',
        'cheque' => 'Cheque',
        _ => 'Other',
      };
  final cityLine = [s.city, s.pincode].whereType<String>().where((x) => x.isNotEmpty).join(' ');
  return Receipt(
    shopName: s.legalName?.isNotEmpty ?? false ? s.legalName! : shopName,
    shopNameFallback: shopName,
    addressLines: [if (s.address?.isNotEmpty ?? false) s.address!, if (cityLine.isNotEmpty) cityLine],
    gstin: s.gstin,
    phone: s.phone,
    title: s.gstin == null ? 'BILL' : 'TAX INVOICE',
    billNumber: bill.number ?? bill.id.substring(0, 8),
    issuedAt: bill.createdAt ?? DateTime.now(),
    customerName: bill.customerName.isEmpty ? null : bill.customerName,
    customerGstin: bill.customer.gstin,
    lines: [
      for (final l in bill.lines)
        ReceiptLine(
          name: l.description,
          nameFallback: skuById[l.itemId],
          qty: l.qty,
          unit: l.unit,
          // As the web counter's receipt: the charged amount per unit (total ÷ qty).
          rate: l.qty == 0 ? l.total : roundHalfAway(l.total / l.qty),
          amount: l.total,
          serials: l.serials,
        ),
    ],
    subtotal: bill.totals.subtotal,
    discount: bill.totals.discount,
    taxable: bill.totals.taxable,
    cgst: bill.totals.cgst,
    sgst: bill.totals.sgst,
    igst: bill.totals.igst,
    roundOff: bill.totals.roundOff,
    total: bill.totals.total,
    taxBreakup: [
      for (final t in bill.totals.taxBreakup)
        ReceiptTax(gstRate: t.gstRate, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst),
    ],
    payments: [for (final p in bill.payments) ReceiptPayment(method: method(p.method), amount: p.amount)],
    change: change,
    balanceDue: bill.balance,
  );
}
