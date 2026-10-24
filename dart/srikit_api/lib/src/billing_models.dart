// Counter-billing models: catalogue variants, counter resolve, customers, bills (invoices), till sessions.
// Shapes from apps/api/openapi.typed.json and the zod schemas in packages/catalogue/src/routes.ts,
// packages/invoices/src/{routes,service,till}.ts and apps/api/src/kit-verticals.ts. Money is paise (int).

import 'models.dart';
import 'pos_models.dart';

Json _map(Object? v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
List<Json> _list(Object? v) => v is List ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() : const [];
List<String> _strings(Object? v) => v is List ? v.whereType<String>().toList() : const [];
int _int(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? 0 : 0);
int? _intOrNull(Object? v) => v is num ? v.toInt() : null;
double _num(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) ?? 0 : 0);
String? _str(Object? v) => v is String ? v : null;
DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;

/// packages/catalogue/src/routes.ts `variantLookupSchema` (GET /v1/catalog/variants/lookup, /search items, and
/// `variant` of /v1/counter/resolve).
class Variant {
  const Variant({
    required this.id,
    required this.productId,
    required this.name,
    this.sku,
    this.barcode,
    this.hsn,
    required this.unit,
    required this.rate,
    required this.price,
    required this.taxInclusive,
    required this.gstRate,
    this.image,
    this.createdAt,
    this.categoryId,
    required this.productName,
    required this.title,
    this.optionValues = const {},
    this.mrp,
    this.cost,
    this.weightGrams,
    this.position = 0,
    this.isDefault = false,
    this.status = 'active',
    this.channels = const [],
  });

  final String id;
  final String productId;

  /// Variant name (e.g. "1 kg"); [title] is the display name ("Toor Dal 1 kg").
  final String name;
  final String? sku;
  final String? barcode;
  final String? hsn;
  final String unit;

  /// GST-exclusive paise per unit.
  final int rate;

  /// As stored on the variant: includes GST when [taxInclusive].
  final int price;
  final bool taxInclusive;
  final double gstRate;
  final String? image;
  final DateTime? createdAt;
  final String? categoryId;
  final String productName;
  final String title;
  final Map<String, dynamic> optionValues;
  final int? mrp;
  final int? cost;
  final int? weightGrams;
  final int position;
  final bool isDefault;

  /// `active`, `draft` or `archived`.
  final String status;
  final List<String> channels;

  factory Variant.fromJson(Json j) => Variant(
        id: _str(j['id']) ?? '',
        productId: _str(j['productId']) ?? '',
        name: _str(j['name']) ?? '',
        sku: _str(j['sku']),
        barcode: _str(j['barcode']),
        hsn: _str(j['hsn']),
        unit: _str(j['unit']) ?? 'pcs',
        rate: _int(j['rate']),
        price: _int(j['price']),
        taxInclusive: j['taxInclusive'] == true,
        gstRate: _num(j['gstRate']),
        image: _str(j['image']),
        createdAt: _date(j['createdAt']),
        categoryId: _str(j['categoryId']),
        productName: _str(j['productName']) ?? '',
        title: _str(j['title']) ?? _str(j['name']) ?? '',
        optionValues: _map(j['optionValues']),
        mrp: _intOrNull(j['mrp']),
        cost: _intOrNull(j['cost']),
        weightGrams: _intOrNull(j['weightGrams']),
        position: _int(j['position']),
        isDefault: j['isDefault'] == true,
        status: _str(j['status']) ?? 'active',
        channels: _strings(j['channels']),
      );
}

/// GET /v1/counter/resolve: the item behind a scale label (with [qty]) or a serial / IMEI (with [serial]), or a weigh
/// ticket (with [weighTicket] and no [variant]; any state: check `isOpen` / `expired` yourself).
class CounterResolve {
  const CounterResolve({this.variant, this.qty, this.serial, this.weighTicket});
  final Variant? variant;

  /// A weigh-ticket code ("W" + 11 digits).
  final WeighTicket? weighTicket;

  /// Weight / quantity from a weighing-scale label.
  final double? qty;

  /// The unit's serial number or IMEI.
  final String? serial;

  factory CounterResolve.fromJson(Json j) => CounterResolve(
        variant: j['variant'] is Map ? Variant.fromJson(_map(j['variant'])) : null,
        weighTicket: j['weighTicket'] is Map ? WeighTicket.fromJson(_map(j['weighTicket'])) : null,
        qty: j['qty'] is num ? (j['qty'] as num).toDouble() : null,
        serial: _str(j['serial']),
      );
}

/// GET /v1/invoices/items row: a saved billing item (shops without the catalogue). [rate] is GST-exclusive.
class BillingItem {
  const BillingItem({
    required this.id,
    required this.name,
    this.hsn,
    required this.unit,
    required this.rate,
    required this.gstRate,
    this.createdAt,
    this.categoryId,
    this.active = true,
    this.stockQty,
    this.stockStatus,
  });

  final String id;
  final String name;
  final String? hsn;
  final String unit;
  final int rate;
  final double gstRate;
  final DateTime? createdAt;
  final String? categoryId;
  final bool active;
  final double? stockQty;
  final String? stockStatus;

  factory BillingItem.fromJson(Json j) => BillingItem(
        id: _str(j['id']) ?? '',
        name: _str(j['name']) ?? '',
        hsn: _str(j['hsn']),
        unit: _str(j['unit']) ?? 'pcs',
        rate: _int(j['rate']),
        gstRate: _num(j['gstRate']),
        createdAt: _date(j['createdAt']),
        categoryId: _str(j['categoryId']),
        active: j['active'] != false,
        stockQty: j['stockQty'] is num ? (j['stockQty'] as num).toDouble() : null,
        stockStatus: _str(j['stockStatus']),
      );
}

/// packages/invoices customer row (GET/POST /v1/invoices/customers).
class Customer {
  const Customer({
    required this.id,
    required this.name,
    this.phone,
    this.email,
    this.gstin,
    this.address,
    this.stateCode,
    this.openingBalance = 0,
    this.creditLimit,
    this.outstanding = 0,
    this.advance = 0,
    this.createdAt,
    this.lastBillDate,
    this.totalBilled = 0,
    this.overdue = 0,
  });

  final String id;
  final String name;
  final String? phone;
  final String? email;
  final String? gstin;
  final String? address;
  final String? stateCode;
  final int openingBalance;
  final int? creditLimit;
  final int outstanding;
  final int advance;
  final DateTime? createdAt;
  final String? lastBillDate;
  final int totalBilled;
  final int overdue;

  factory Customer.fromJson(Json j) => Customer(
        id: _str(j['id']) ?? '',
        name: _str(j['name']) ?? '',
        phone: _str(j['phone']),
        email: _str(j['email']),
        gstin: _str(j['gstin']),
        address: _str(j['address']),
        stateCode: _str(j['stateCode']),
        openingBalance: _int(j['openingBalance']),
        creditLimit: _intOrNull(j['creditLimit']),
        outstanding: _int(j['outstanding']),
        advance: _int(j['advance']),
        createdAt: _date(j['createdAt']),
        lastBillDate: _str(j['lastBillDate']),
        totalBilled: _int(j['totalBilled']),
        overdue: _int(j['overdue']),
      );
}

/// A line sent to POST /v1/invoices (packages/invoices `lineInputSchema`).
class InvoiceLineInput {
  const InvoiceLineInput({
    required this.description,
    required this.qty,
    required this.rate,
    required this.gstRate,
    this.hsn,
    this.unit,
    this.discount,
    this.itemId,
    this.inclusiveTotal,
    this.serials = const [],
  });

  final String description;
  final double qty;

  /// GST-exclusive paise per unit.
  final int rate;
  final double gstRate;
  final String? hsn;
  final String? unit;

  /// Paise off the line, on the exclusive basis.
  final int? discount;

  /// Catalogue variant / billing item id (drives stock).
  final String? itemId;

  /// GST-inclusive amount charged (tax-inclusive prices): the server takes GST out of it.
  final int? inclusiveTotal;
  final List<String> serials;

  Map<String, Object?> toJson() => {
        'description': description,
        'qty': qty == qty.roundToDouble() ? qty.toInt() : qty,
        'rate': rate,
        'gstRate': gstRate == gstRate.roundToDouble() ? gstRate.toInt() : gstRate,
        if (hsn != null && hsn!.isNotEmpty) 'hsn': hsn,
        if (unit != null && unit!.isNotEmpty) 'unit': unit,
        if (discount != null && discount! > 0) 'discount': discount,
        if (itemId != null) 'itemId': itemId,
        if (inclusiveTotal != null) 'inclusiveTotal': inclusiveTotal,
        if (serials.isNotEmpty) 'serials': serials,
      };
}

/// The bill's customer: a saved one ([customerId]), a walk-in ([walkInName] / [walkInPhone]), or none.
class InvoiceInput {
  const InvoiceInput({
    required this.date,
    required this.lines,
    this.customerId,
    this.walkInName,
    this.walkInPhone,
    this.issue = true,
    this.tillSessionId,
    this.notes,
  });

  /// `YYYY-MM-DD`, IST.
  final String date;
  final List<InvoiceLineInput> lines;
  final String? customerId;
  final String? walkInName;
  final String? walkInPhone;

  /// Create and issue in one call (what the web counter does).
  final bool issue;
  final String? tillSessionId;
  final String? notes;

  Map<String, Object?> toJson() => {
        'date': date,
        'lines': [for (final l in lines) l.toJson()],
        'issue': issue,
        if (customerId != null) 'customerId': customerId,
        if (customerId == null && walkInName != null)
          'customer': {'name': walkInName, if (walkInPhone != null) 'phone': walkInPhone},
        if (tillSessionId != null) 'tillSessionId': tillSessionId,
        if (notes != null) 'notes': notes,
      };
}

/// A line of an issued bill, with the server's tax split.
class InvoiceLine {
  const InvoiceLine({
    required this.description,
    this.hsn,
    required this.qty,
    this.unit,
    required this.rate,
    this.discount,
    required this.gstRate,
    this.itemId,
    this.inclusiveTotal,
    this.serials = const [],
    required this.amount,
    required this.taxable,
    required this.cgst,
    required this.sgst,
    required this.igst,
    required this.total,
  });

  final String description;
  final String? hsn;
  final double qty;
  final String? unit;
  final int rate;
  final int? discount;
  final double gstRate;
  final String? itemId;
  final int? inclusiveTotal;
  final List<String> serials;
  final int amount;
  final int taxable;
  final int cgst;
  final int sgst;
  final int igst;

  /// What the line costs, GST included.
  final int total;

  factory InvoiceLine.fromJson(Json j) => InvoiceLine(
        description: _str(j['description']) ?? '',
        hsn: _str(j['hsn']),
        qty: _num(j['qty']),
        unit: _str(j['unit']),
        rate: _int(j['rate']),
        discount: _intOrNull(j['discount']),
        gstRate: _num(j['gstRate']),
        itemId: _str(j['itemId']),
        inclusiveTotal: _intOrNull(j['inclusiveTotal']),
        serials: _strings(j['serials']),
        amount: _int(j['amount']),
        taxable: _int(j['taxable']),
        cgst: _int(j['cgst']),
        sgst: _int(j['sgst']),
        igst: _int(j['igst']),
        total: _int(j['total']),
      );
}

class TaxBreakupRow {
  const TaxBreakupRow({required this.gstRate, required this.taxable, required this.cgst, required this.sgst, required this.igst});
  final double gstRate;
  final int taxable;
  final int cgst;
  final int sgst;
  final int igst;

  factory TaxBreakupRow.fromJson(Json j) => TaxBreakupRow(
        gstRate: _num(j['gstRate']),
        taxable: _int(j['taxable']),
        cgst: _int(j['cgst']),
        sgst: _int(j['sgst']),
        igst: _int(j['igst']),
      );
}

/// The server's bill totals (packages/gst `InvoiceTotals`).
class InvoiceTotals {
  const InvoiceTotals({
    required this.subtotal,
    required this.discount,
    required this.taxable,
    required this.cgst,
    required this.sgst,
    required this.igst,
    required this.roundOff,
    required this.total,
    required this.taxBreakup,
    this.loyaltyPoints,
    this.loyaltyDiscount,
  });

  final int subtotal;
  final int discount;
  final int taxable;
  final int cgst;
  final int sgst;
  final int igst;
  final int roundOff;
  final int total;
  final List<TaxBreakupRow> taxBreakup;
  final int? loyaltyPoints;
  final int? loyaltyDiscount;

  factory InvoiceTotals.fromJson(Json j) {
    final loyalty = j['loyalty'] is Map ? _map(j['loyalty']) : null;
    return InvoiceTotals(
      subtotal: _int(j['subtotal']),
      discount: _int(j['discount']),
      taxable: _int(j['taxable']),
      cgst: _int(j['cgst']),
      sgst: _int(j['sgst']),
      igst: _int(j['igst']),
      roundOff: _int(j['roundOff']),
      total: _int(j['total']),
      taxBreakup: _list(j['taxBreakup']).map(TaxBreakupRow.fromJson).toList(),
      loyaltyPoints: loyalty == null ? null : _int(loyalty['points']),
      loyaltyDiscount: loyalty == null ? null : _int(loyalty['discount']),
    );
  }
}

/// A payment recorded on a bill.
class InvoicePaymentRow {
  const InvoicePaymentRow({
    required this.id,
    required this.amount,
    required this.method,
    required this.date,
    this.reference,
    required this.source,
    this.creditNoteId,
    this.createdAt,
  });

  final String id;
  final int amount;

  /// `cash`, `upi`, `card`, `bank`, `cheque` or `other`.
  final String method;
  final String date;
  final String? reference;

  /// `manual`, `receipt`, `online` or `refund`.
  final String source;
  final String? creditNoteId;
  final DateTime? createdAt;

  factory InvoicePaymentRow.fromJson(Json j) => InvoicePaymentRow(
        id: _str(j['id']) ?? '',
        amount: _int(j['amount']),
        method: _str(j['method']) ?? 'other',
        date: _str(j['date']) ?? '',
        reference: _str(j['reference']),
        source: _str(j['source']) ?? 'manual',
        creditNoteId: _str(j['creditNoteId']),
        createdAt: _date(j['createdAt']),
      );
}

/// The customer printed on a bill.
class InvoiceParty {
  const InvoiceParty({required this.name, this.phone, this.email, this.gstin, this.address, this.stateCode});
  final String name;
  final String? phone;
  final String? email;
  final String? gstin;
  final String? address;
  final String? stateCode;

  factory InvoiceParty.fromJson(Json j) => InvoiceParty(
        name: _str(j['name']) ?? '',
        phone: _str(j['phone']),
        email: _str(j['email']),
        gstin: _str(j['gstin']),
        address: _str(j['address']),
        stateCode: _str(j['stateCode']),
      );
}

/// The seller profile on a bill (billing settings).
class SellerProfile {
  const SellerProfile({
    this.legalName,
    this.gstin,
    this.address,
    this.city,
    this.pincode,
    this.stateCode,
    this.phone,
    this.email,
    this.invoicePrefix,
    this.terms,
    this.bankName,
    this.accountNumber,
    this.ifsc,
    this.upiId,
    this.autoReminders = false,
    this.reminderDays = const [],
    this.sendPaymentReceipts = false,
  });

  final String? legalName;
  final String? gstin;
  final String? address;
  final String? city;
  final String? pincode;
  final String? stateCode;
  final String? phone;
  final String? email;
  final String? invoicePrefix;
  final String? terms;
  final String? bankName;
  final String? accountNumber;
  final String? ifsc;
  final String? upiId;
  final bool autoReminders;
  final List<int> reminderDays;
  final bool sendPaymentReceipts;

  factory SellerProfile.fromJson(Json j) => SellerProfile(
        legalName: _str(j['legalName']),
        gstin: _str(j['gstin']),
        address: _str(j['address']),
        city: _str(j['city']),
        pincode: _str(j['pincode']),
        stateCode: _str(j['stateCode']),
        phone: _str(j['phone']),
        email: _str(j['email']),
        invoicePrefix: _str(j['invoicePrefix']),
        terms: _str(j['terms']),
        bankName: _str(j['bankName']),
        accountNumber: _str(j['accountNumber']),
        ifsc: _str(j['ifsc']),
        upiId: _str(j['upiId']),
        autoReminders: j['autoReminders'] == true,
        reminderDays: j['reminderDays'] is List ? (j['reminderDays'] as List).whereType<num>().map((e) => e.toInt()).toList() : const [],
        sendPaymentReceipts: j['sendPaymentReceipts'] == true,
      );
}

/// packages/invoices `invoiceSchema`: a full bill (create, issue, payments, get, cancel all answer with it).
class Invoice {
  const Invoice({
    required this.id,
    this.number,
    this.branchId,
    required this.status,
    required this.date,
    this.dueDate,
    required this.customerName,
    required this.total,
    required this.paid,
    required this.credited,
    required this.balance,
    required this.isOverdue,
    this.customerId,
    required this.customer,
    required this.seller,
    required this.placeOfSupply,
    required this.interState,
    required this.lines,
    required this.totals,
    required this.amountInWords,
    this.notes,
    required this.payments,
    this.shareToken,
    this.cancelledAt,
    this.cancelReason,
    this.warnings = const [],
    this.messages = const [],
    this.creditNotes = const [],
    this.tillSessionId,
    this.createdAt,
    this.updatedAt,
  });

  final String id;

  /// Null while a draft.
  final String? number;
  final String? branchId;

  /// `draft`, `issued`, `partially_paid`, `paid` or `cancelled`.
  final String status;
  final String date;
  final String? dueDate;
  final String customerName;
  final int total;
  final int paid;
  final int credited;
  final int balance;
  final bool isOverdue;
  final String? customerId;
  final InvoiceParty customer;
  final SellerProfile seller;
  final String placeOfSupply;
  final bool interState;
  final List<InvoiceLine> lines;
  final InvoiceTotals totals;
  final String amountInWords;
  final String? notes;
  final List<InvoicePaymentRow> payments;
  final String? shareToken;
  final DateTime? cancelledAt;
  final String? cancelReason;

  /// e.g. `credit_limit_exceeded`.
  final List<String> warnings;

  /// Messages sent for the bill (raw; not used by the app yet).
  final List<Json> messages;

  /// Credit notes against the bill (raw; not used by the app yet).
  final List<Json> creditNotes;
  final String? tillSessionId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory Invoice.fromJson(Json j) => Invoice(
        id: _str(j['id']) ?? '',
        number: _str(j['number']),
        branchId: _str(j['branchId']),
        status: _str(j['status']) ?? 'draft',
        date: _str(j['date']) ?? '',
        dueDate: _str(j['dueDate']),
        customerName: _str(j['customerName']) ?? '',
        total: _int(j['total']),
        paid: _int(j['paid']),
        credited: _int(j['credited']),
        balance: _int(j['balance']),
        isOverdue: j['isOverdue'] == true,
        customerId: _str(j['customerId']),
        customer: InvoiceParty.fromJson(_map(j['customer'])),
        seller: SellerProfile.fromJson(_map(j['seller'])),
        placeOfSupply: _str(j['placeOfSupply']) ?? '',
        interState: j['interState'] == true,
        lines: _list(j['lines']).map(InvoiceLine.fromJson).toList(),
        totals: InvoiceTotals.fromJson(_map(j['totals'])),
        amountInWords: _str(j['amountInWords']) ?? '',
        notes: _str(j['notes']),
        payments: _list(j['payments']).map(InvoicePaymentRow.fromJson).toList(),
        shareToken: _str(j['shareToken']),
        cancelledAt: _date(j['cancelledAt']),
        cancelReason: _str(j['cancelReason']),
        warnings: _strings(j['warnings']),
        messages: _list(j['messages']),
        creditNotes: _list(j['creditNotes']),
        tillSessionId: _str(j['tillSessionId']),
        createdAt: _date(j['createdAt']),
        updatedAt: _date(j['updatedAt']),
      );
}

/// A write that may have been replayed (`idempotent-replayed: true`): [replayed] means the server had already done
/// it and answered with the stored result. Treat it as success.
class Written<T> {
  const Written(this.value, {this.replayed = false});
  final T value;
  final bool replayed;
}

/// POST /v1/invoices/:id/share: a public link to the bill.
class ShareLink {
  const ShareLink({required this.token, required this.url});
  final String token;
  final String url;

  factory ShareLink.fromJson(Json j) => ShareLink(token: _str(j['token']) ?? '', url: _str(j['url']) ?? '');
}

/// `{ method, amount, count }` of a till report.
class TillMethodTotal {
  const TillMethodTotal({required this.method, required this.amount, required this.count});
  final String method;
  final int amount;
  final int count;

  factory TillMethodTotal.fromJson(Json j) =>
      TillMethodTotal(method: _str(j['method']) ?? 'other', amount: _int(j['amount']), count: _int(j['count']));
}

/// packages/invoices till `TillReport` (the X report; the Z report on close).
class TillReport {
  const TillReport({
    required this.billCount,
    required this.billTotal,
    required this.billsCancelled,
    required this.payments,
    required this.refunds,
    required this.creditNoteCount,
    required this.creditNoteTotal,
    required this.onCredit,
    required this.collected,
    required this.refunded,
    required this.cashOpening,
    required this.cashSales,
    required this.cashRefunds,
    required this.cashIn,
    required this.cashOut,
    required this.cashExpected,
  });

  final int billCount;
  final int billTotal;
  final int billsCancelled;
  final List<TillMethodTotal> payments;
  final List<TillMethodTotal> refunds;
  final int creditNoteCount;
  final int creditNoteTotal;
  final int onCredit;
  final int collected;
  final int refunded;
  final int cashOpening;
  final int cashSales;
  final int cashRefunds;
  final int cashIn;
  final int cashOut;
  final int cashExpected;

  factory TillReport.fromJson(Json j) {
    final bills = _map(j['bills']);
    final notes = _map(j['creditNotes']);
    final cash = _map(j['cash']);
    return TillReport(
      billCount: _int(bills['count']),
      billTotal: _int(bills['total']),
      billsCancelled: _int(bills['cancelled']),
      payments: _list(j['payments']).map(TillMethodTotal.fromJson).toList(),
      refunds: _list(j['refunds']).map(TillMethodTotal.fromJson).toList(),
      creditNoteCount: _int(notes['count']),
      creditNoteTotal: _int(notes['total']),
      onCredit: _int(j['onCredit']),
      collected: _int(j['collected']),
      refunded: _int(j['refunded']),
      cashOpening: _int(cash['opening']),
      cashSales: _int(cash['sales']),
      cashRefunds: _int(cash['refunds']),
      cashIn: _int(cash['cashIn']),
      cashOut: _int(cash['cashOut']),
      cashExpected: _int(cash['expected']),
    );
  }
}

/// A cash in (+) / out (−) entry of a till session.
class TillCashEntry {
  const TillCashEntry({required this.id, required this.amount, required this.reason, this.by, this.byName, this.at});
  final String id;
  final int amount;
  final String reason;
  final String? by;
  final String? byName;
  final DateTime? at;

  factory TillCashEntry.fromJson(Json j) => TillCashEntry(
        id: _str(j['id']) ?? '',
        amount: _int(j['amount']),
        reason: _str(j['reason']) ?? '',
        by: _str(j['by']),
        byName: _str(j['byName']),
        at: _date(j['at']),
      );
}

/// packages/invoices till `TillSession`: one register's day.
class TillSession {
  const TillSession({
    required this.id,
    this.branchId,
    required this.register,
    required this.status,
    required this.date,
    required this.openingCash,
    this.openingCount,
    this.openedBy,
    this.openedByName,
    this.openedAt,
    this.cashEntries = const [],
    this.closingCount,
    this.expectedCash,
    this.countedCash,
    this.difference,
    this.note,
    this.closedBy,
    this.closedByName,
    this.closedAt,
    this.summary,
  });

  final String id;
  final String? branchId;
  final String register;

  /// `open` or `closed`.
  final String status;
  final String date;
  final int openingCash;

  /// Denomination counts (`{"500": 3}`), raw.
  final Json? openingCount;
  final String? openedBy;
  final String? openedByName;
  final DateTime? openedAt;
  final List<TillCashEntry> cashEntries;
  final Json? closingCount;
  final int? expectedCash;
  final int? countedCash;

  /// Counted − expected (negative = short).
  final int? difference;
  final String? note;
  final String? closedBy;
  final String? closedByName;
  final DateTime? closedAt;

  /// The Z report, once closed.
  final TillReport? summary;

  bool get isOpen => status == 'open';

  factory TillSession.fromJson(Json j) => TillSession(
        id: _str(j['id']) ?? '',
        branchId: _str(j['branchId']),
        register: _str(j['register']) ?? '',
        status: _str(j['status']) ?? 'open',
        date: _str(j['date']) ?? '',
        openingCash: _int(j['openingCash']),
        openingCount: j['openingCount'] is Map ? _map(j['openingCount']) : null,
        openedBy: _str(j['openedBy']),
        openedByName: _str(j['openedByName']),
        openedAt: _date(j['openedAt']),
        cashEntries: _list(j['cashEntries']).map(TillCashEntry.fromJson).toList(),
        closingCount: j['closingCount'] is Map ? _map(j['closingCount']) : null,
        expectedCash: _intOrNull(j['expectedCash']),
        countedCash: _intOrNull(j['countedCash']),
        difference: _intOrNull(j['difference']),
        note: _str(j['note']),
        closedBy: _str(j['closedBy']),
        closedByName: _str(j['closedByName']),
        closedAt: _date(j['closedAt']),
        summary: j['summary'] is Map ? TillReport.fromJson(_map(j['summary'])) : null,
      );
}

/// GET /v1/invoices/till/current: `{ session }` (null when this register has no open day).
class TillCurrent {
  const TillCurrent({this.session});
  final TillSession? session;

  factory TillCurrent.fromJson(Json j) =>
      TillCurrent(session: j['session'] is Map ? TillSession.fromJson(_map(j['session'])) : null);
}

/// GET /v1/invoices/till/:id/x and POST /v1/invoices/till/:id/close: `{ session, report }`.
class TillSessionReport {
  const TillSessionReport({required this.session, required this.report});
  final TillSession session;
  final TillReport report;

  factory TillSessionReport.fromJson(Json j) =>
      TillSessionReport(session: TillSession.fromJson(_map(j['session'])), report: TillReport.fromJson(_map(j['report'])));
}
