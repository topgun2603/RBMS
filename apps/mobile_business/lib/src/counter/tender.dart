// Split tender, ported from the web counter (packages/pos-ui/src/lib/tender.ts). Money is paise.

/// What the customer handed over. [credit] is left on the bill (credit book), never sent as a payment.
class Tenders {
  const Tenders({this.cash = 0, this.upi = 0, this.card = 0, this.credit = 0});
  final int cash;
  final int upi;
  final int card;
  final int credit;
}

enum TenderProblem { nothingToPay, overNonCash, short, upiUnconfirmed, creditUnavailable, creditNeedsCustomer }

class Settlement {
  const Settlement({
    required this.payable,
    required this.nonCash,
    required this.cashApplied,
    required this.change,
    required this.remaining,
    required this.credit,
    required this.problems,
  });

  final int payable;
  final int nonCash;

  /// Cash kept (the change already handed back).
  final int cashApplied;
  final int change;
  final int remaining;
  final int credit;
  final List<TenderProblem> problems;

  int get received => cashApplied + nonCash;
  bool get ok => problems.isEmpty;
}

int _nonNeg(int n) => n < 0 ? 0 : n;

/// tender.ts `settle`: only cash may exceed what is due (the rest is change); UPI + card + credit may not exceed the
/// bill; UPI needs a "received" confirmation; credit needs a saved customer and the credit-book feature; otherwise
/// the bill must be fully covered.
Settlement settle(int payable, Tenders t, {bool upiConfirmed = false, bool hasCustomer = false, bool creditAllowed = false}) {
  final due = _nonNeg(payable);
  final cash = _nonNeg(t.cash);
  final upi = _nonNeg(t.upi);
  final card = _nonNeg(t.card);
  final credit = _nonNeg(t.credit);
  final nonCash = upi + card;
  final problems = <TenderProblem>[];
  if (due == 0) problems.add(TenderProblem.nothingToPay);
  if (nonCash + credit > due) problems.add(TenderProblem.overNonCash);
  final cashDue = due - nonCash - credit > 0 ? due - nonCash - credit : 0;
  final cashApplied = cash < cashDue ? cash : cashDue;
  final change = cash - cashDue > 0 ? cash - cashDue : 0;
  final remaining = cashDue - cashApplied > 0 ? cashDue - cashApplied : 0;
  if (remaining > 0) problems.add(TenderProblem.short);
  if (upi > 0 && !upiConfirmed) problems.add(TenderProblem.upiUnconfirmed);
  if (credit > 0 && !creditAllowed) problems.add(TenderProblem.creditUnavailable);
  if (credit > 0 && !hasCustomer) problems.add(TenderProblem.creditNeedsCustomer);
  return Settlement(
    payable: due,
    nonCash: nonCash,
    cashApplied: cashApplied,
    change: change,
    remaining: remaining,
    credit: credit,
    problems: problems,
  );
}

class PlannedPayment {
  const PlannedPayment(this.method, this.amount, {this.reference});

  /// `cash`, `upi` or `card`.
  final String method;
  final int amount;
  final String? reference;

  PlannedPayment withAmount(int a) => PlannedPayment(method, a, reference: reference);
}

/// tender.ts `paymentsFor`: UPI, then card, then the cash kept.
List<PlannedPayment> paymentsFor(Settlement s, Tenders t, {String? upiRef, String? cardRef}) => [
      if (_nonNeg(t.upi) > 0) PlannedPayment('upi', _nonNeg(t.upi), reference: _ref(upiRef)),
      if (_nonNeg(t.card) > 0) PlannedPayment('card', _nonNeg(t.card), reference: _ref(cardRef)),
      if (s.cashApplied > 0) PlannedPayment('cash', s.cashApplied),
    ];

String? _ref(String? r) {
  final t = r?.trim() ?? '';
  return t.isEmpty ? null : (t.length > 100 ? t.substring(0, 100) : t);
}

/// tender.ts `fitPayments`: caps each payment at what the server says is still due, in order; the rest is dropped.
List<PlannedPayment> fitPayments(List<PlannedPayment> planned, int balance) {
  var left = _nonNeg(balance);
  final out = <PlannedPayment>[];
  for (final p in planned) {
    if (left <= 0) break;
    final a = _nonNeg(p.amount) < left ? _nonNeg(p.amount) : left;
    if (a > 0) out.add(p.withAmount(a));
    left -= a;
  }
  return out;
}

/// tender.ts `quickNotes`: the exact amount, then the next ₹10 / ₹50 / ₹100 / ₹500 / ₹2000 above it.
List<int> quickNotes(int due, {int max = 5}) {
  final d = _nonNeg(due);
  if (d == 0) return const [];
  final out = <int>{d};
  for (final step in const [1000, 5000, 10000, 50000, 200000]) {
    final up = (d / step).ceil() * step;
    if (up > d) out.add(up);
  }
  return (out.toList()..sort()).take(max).toList();
}

/// Rupees typed by the cashier ("120", "120.5") → paise; null when not a non-negative amount with ≤ 2 decimals.
int? parseRupees(String input) {
  final s = input.trim().replaceAll(',', '');
  if (s.isEmpty) return 0;
  if (!RegExp(r'^\d+(\.\d{0,2})?$').hasMatch(s)) return null;
  final parts = s.split('.');
  final paise = parts.length == 1 ? 0 : int.parse(parts[1].padRight(2, '0'));
  return int.parse(parts[0]) * 100 + paise;
}

/// Today's date in IST as `YYYY-MM-DD` (what the web counter sends as the bill date).
String todayIst([DateTime? now]) {
  final t = (now ?? DateTime.now()).toUtc().add(const Duration(hours: 5, minutes: 30));
  String two(int n) => n.toString().padLeft(2, '0');
  return '${t.year}-${two(t.month)}-${two(t.day)}';
}
