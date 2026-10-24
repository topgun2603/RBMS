/// What goes on a printed receipt. Built by the app from the server's bill: every amount here is the server's
/// number (paise), never recomputed for printing.
class Receipt {
  const Receipt({
    required this.shopName,
    this.shopNameFallback,
    this.addressLines = const [],
    this.gstin,
    this.phone,
    this.title = 'TAX INVOICE',
    required this.billNumber,
    required this.issuedAt,
    this.customerName,
    this.customerNameFallback,
    this.customerGstin,
    required this.lines,
    required this.subtotal,
    this.discount = 0,
    required this.taxable,
    this.cgst = 0,
    this.sgst = 0,
    this.igst = 0,
    this.roundOff = 0,
    required this.total,
    this.taxBreakup = const [],
    this.payments = const [],
    this.change = 0,
    this.balanceDue = 0,
    this.footer = 'Thank you! Visit again.',
  });

  final String shopName;

  /// ASCII name to print when [shopName] has letters the printer can't print (e.g. Tamil).
  final String? shopNameFallback;
  final List<String> addressLines;
  final String? gstin;
  final String? phone;
  final String title;
  final String billNumber;

  /// When the bill was made (any zone; printed in IST).
  final DateTime issuedAt;
  final String? customerName;
  final String? customerNameFallback;
  final String? customerGstin;
  final List<ReceiptLine> lines;
  final int subtotal;
  final int discount;
  final int taxable;
  final int cgst;
  final int sgst;
  final int igst;
  final int roundOff;
  final int total;
  final List<ReceiptTax> taxBreakup;
  final List<ReceiptPayment> payments;

  /// Cash handed back (paise).
  final int change;

  /// Still to pay (bill on credit / part paid).
  final int balanceDue;
  final String? footer;
}

class ReceiptLine {
  const ReceiptLine({
    required this.name,
    this.nameFallback,
    required this.qty,
    this.unit,
    required this.rate,
    required this.amount,
    this.discount = 0,
    this.serials = const [],
  });

  final String name;

  /// ASCII name (SKU or English name) when [name] can't be printed.
  final String? nameFallback;
  final double qty;
  final String? unit;

  /// Per unit as charged, GST included (the line total ÷ qty, as the web counter's receipt shows it), paise.
  final int rate;

  /// Line total as on the bill, GST included (paise).
  final int amount;
  final int discount;
  final List<String> serials;
}

class ReceiptTax {
  const ReceiptTax({required this.gstRate, required this.taxable, this.cgst = 0, this.sgst = 0, this.igst = 0});
  final double gstRate;
  final int taxable;
  final int cgst;
  final int sgst;
  final int igst;
}

class ReceiptPayment {
  const ReceiptPayment({required this.method, required this.amount});

  /// Printed as is (`Cash`, `UPI`, `Card`).
  final String method;
  final int amount;
}

/// Paper widths: characters per line in the printer's font A.
enum PaperWidth {
  mm58(32),
  mm80(48);

  const PaperWidth(this.columns);
  final int columns;
}

/// Sends a formatted receipt to a printer.
///
/// TODO(bluetooth): implement over a Bluetooth / USB printer plugin (send [EscPosReceipt.bytes]). Until then the app
/// uses [PreviewReceiptPrinter], which only returns the preview text.
abstract interface class ReceiptPrinter {
  /// Prints [receipt]; returns the plain-text preview of what was (or would be) printed.
  Future<String> print(Receipt receipt);
}

/// A weigh ticket as printed (the server's ticket: lines and total are never recomputed).
class WeighTicketSlip {
  const WeighTicketSlip({
    required this.shopName,
    this.shopNameFallback,
    required this.terminalName,
    required this.code,
    required this.issuedAt,
    required this.lines,
    required this.total,
    this.note,
    this.title = 'WEIGH TICKET',
    this.footer = 'Pay at the counter. Valid today.',
  });

  final String shopName;
  final String? shopNameFallback;
  final String terminalName;

  /// "W" + 11 digits: printed as a Code 128 barcode and as text.
  final String code;
  final DateTime issuedAt;
  final List<WeighTicketSlipLine> lines;

  /// Paise.
  final int total;
  final String? note;
  final String title;
  final String? footer;
}

class WeighTicketSlipLine {
  const WeighTicketSlipLine({
    required this.name,
    this.nameFallback,
    required this.qty,
    required this.unit,
    required this.unitPrice,
    required this.amount,
    this.tareKg,
  });

  final String name;
  final String? nameFallback;

  /// Net weight (kg) or count.
  final double qty;
  final String unit;

  /// Paise per [unit].
  final int unitPrice;
  final int amount;
  final double? tareKg;
}
