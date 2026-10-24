import 'package:flutter/foundation.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../pos/catalog.dart';
import '../pos/weigh.dart';
import 'cart.dart';
import 'tender.dart';

/// Feature / permission keys the counter uses (the same as the web counter, packages/pos-ui/src/lib/access.ts).
abstract final class CounterKeys {
  static const invoices = 'invoices';
  static const catalogue = 'catalogue';
  static const creditBook = 'invoices.credit-book';
  static const create = 'invoices.create';
  static const discount = 'invoices.discount';
  static const till = 'pos.till';
  static const customersCreate = 'customers.create';
  static const weighing = 'pos.weighing';
}

/// What a scanned / typed code is: a product (with a scale label's [qty] or a unit's [serial]), or a weigh ticket.
class CodeHit {
  const CodeHit.product(CartProduct this.product, {this.qty, this.serial}) : ticket = null;
  const CodeHit.ticket(WeighTicket this.ticket)
      : product = null,
        qty = null,
        serial = null;

  final CartProduct? product;
  final double? qty;
  final String? serial;
  final WeighTicket? ticket;
}

/// A weigh ticket on the bill that could not be marked used (after the bill was made).
class TicketUseFailure {
  const TicketUseFailure(this.ticketId, this.code, this.error);
  final String ticketId;
  final String? code;
  final Object error;

  /// Another bill already used it (409): reported, never retried.
  bool get isFinal => error is ApiException && (error as ApiException).status == 409;
}

enum CustomerKind { none, walkIn, saved }

/// The bill's customer: nobody (nothing is sent), a walk-in (name + phone on the bill), or a saved customer.
class CounterCustomer {
  const CounterCustomer.none()
      : kind = CustomerKind.none,
        name = null,
        phone = null,
        saved = null;
  const CounterCustomer.walkIn({this.name, this.phone})
      : kind = CustomerKind.walkIn,
        saved = null;
  CounterCustomer.saved(Customer c)
      : kind = CustomerKind.saved,
        name = c.name,
        phone = c.phone,
        saved = c;

  final CustomerKind kind;
  final String? name;

  /// E.164.
  final String? phone;
  final Customer? saved;
}

/// What happened when the payments were sent.
class PaymentOutcome {
  const PaymentOutcome({required this.bill, required this.change, required this.unrecorded});

  /// The server's bill after the last recorded payment.
  final Invoice bill;

  /// Cash to hand back: cash tendered − the cash kept for the bill.
  final int change;

  /// Planned payments that were not recorded (the cashier chose to finish without them).
  final int unrecorded;
}

/// One phone counter: cart, customer, till, and the bill being made.
///
/// The bill is made the way the web counter makes it: `POST /v1/invoices` with `issue: true` (numbered and issued in
/// one call), then one `POST /v1/invoices/:id/payments` per tender, UPI → card → cash, each capped at the server's
/// balance. Unlike the web, the bill is created *before* the money screen, so the cashier collects against the
/// server's total, not an estimate.
///
/// Every write carries an Idempotency-Key made once per user action ([_once]) and reused when that action is retried,
/// so a retry after a dropped connection never makes a second bill or payment. A replayed answer
/// (`idempotent-replayed: true`) is the stored result of the first try and is treated as success.
class CounterController extends ChangeNotifier {
  CounterController({
    required this.api,
    required this.session,
    required this.gates,
    this.actorName,
    this.catalog,
    this.fixedRegister,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  /// A paired terminal's on-device catalogue: search and scans look here first, then ask the API.
  final PosCatalog? catalog;

  /// A paired terminal's till register (its name); the cashier can't change it.
  final String? fixedRegister;
  final DateTime Function() _now;

  bool get registerFixed => fixedRegister != null;

  final SrikitApi api;
  final SessionStore session;
  final Gates gates;

  /// Cashier name for till entries.
  final String? actorName;

  Cart cart = const Cart();
  CounterCustomer customer = const CounterCustomer.none();
  int _cartVersion = 0;

  /// Register (counter) name on this device; the web's default is "Counter 1".
  String register = defaultRegister;
  static const defaultRegister = 'Counter 1';

  TillSession? till;
  bool tillLoaded = false;
  Object? tillError;

  /// The issued bill waiting for (or done with) payment.
  Invoice? bill;
  List<PlannedPayment>? _plan;
  final Set<int> _recorded = {};
  int _cashTendered = 0;

  late final ActionKeys _actions = ActionKeys(session);

  bool get usesCatalogue => gates.feature(CounterKeys.catalogue);
  bool get canDiscount => gates.can(CounterKeys.discount);
  bool get canTill => gates.can(CounterKeys.till);
  bool get canCreateCustomer => gates.can(CounterKeys.customersCreate);
  bool get creditAllowed => gates.feature(CounterKeys.creditBook);
  bool get dayOpen => till?.isOpen ?? false;

  /// Idempotency keys currently waiting for their action to succeed (for tests and diagnostics).
  Map<String, String> get pendingKeys => _actions.pending;

  /// Runs [run] with the key for [action], made on first use and reused until the action succeeds.
  Future<T> _once<T>(String action, Future<T> Function(String key) run) => _actions.once(action, run);

  // ---------------------------------------------------------------- start

  Future<void> init() async {
    if (fixedRegister != null) {
      register = cleanRegister(fixedRegister!);
    } else {
      final saved = await session.store.read(registerKey);
      if (saved != null && saved.trim().isNotEmpty) register = saved;
    }
    await refreshTill();
  }

  static const registerKey = 'srikit.counter.register';

  /// trims, collapses spaces, max 40 chars (till.ts).
  static String cleanRegister(String s) {
    final t = s.trim().replaceAll(RegExp(r'\s+'), ' ');
    return t.isEmpty ? defaultRegister : (t.length > 40 ? t.substring(0, 40) : t);
  }

  Future<void> refreshTill() async {
    try {
      till = (await api.tillCurrent(register)).session;
      tillError = null;
    } catch (e) {
      tillError = e;
    }
    tillLoaded = true;
    notifyListeners();
  }

  // ---------------------------------------------------------------- items

  void _cart(Cart next) {
    if (identical(next, cart)) return;
    cart = next;
    _cartVersion++;
    notifyListeners();
  }

  void addProduct(CartProduct p, {double qty = 1, String? serial}) => _cart(cart.add(p, qty: qty, serial: serial));
  void step(String key, int by) => _cart(cart.step(key, by));
  void setQty(String key, double qty) => _cart(cart.setQty(key, qty));
  void remove(String key) => _cart(cart.remove(key));
  void clearCart() => _cart(const Cart());

  void setPrice(String key, int price) {
    if (canDiscount) _cart(cart.setPrice(key, price));
  }

  void setDiscount(String key, int paise) {
    if (canDiscount) _cart(cart.setDiscount(key, paise));
  }

  void setDiscountPercent(String key, double pct) {
    if (canDiscount) _cart(cart.setDiscountPercent(key, pct));
  }

  /// Search: the catalogue's variants, or saved billing items when the catalogue is off.
  Future<List<CartProduct>> search(String q) async {
    final t = q.trim();
    if (t.isEmpty) return const [];
    final local = catalog;
    if (local != null && local.ready) {
      final hits = local.index.search(t, limit: 40);
      if (hits.isNotEmpty) return hits.map(CartProduct.fromPosItem).toList();
    }
    if (usesCatalogue) return (await api.searchVariants(t)).items.map(CartProduct.fromVariant).toList();
    return (await api.searchItems(t)).items.map(CartProduct.fromItem).toList();
  }

  /// A scanned or typed code, without adding it: a weigh-ticket code (`by-code`), the terminal's cached catalogue
  /// (barcode → SKU → PLU), then the API as before — catalogue lookup, and only on 404 the counter resolver (scale
  /// labels set the qty, IMEI / serial labels carry the serial, ticket codes answer the ticket). Without the
  /// catalogue: billing items, if exactly one matches. Null when nothing matched; throws [TicketProblem] for a ticket
  /// that can't be billed.
  Future<CodeHit?> lookupCode(String code) async {
    final c = code.trim();
    if (c.length < 3) return null;
    if (isTicketCode(c) && gates.feature(CounterKeys.weighing)) {
      final norm = normalizeTicketCode(c);
      try {
        return _checkedTicket(await api.weighTicketByCode(norm));
      } on ApiException catch (e) {
        final p = ticketProblemOf(e, norm);
        if (p != null) throw p;
        if (e.status != 403) rethrow;
      }
    }
    final cached = catalog != null && catalog!.ready ? catalog!.index.findByCode(c) : null;
    if (cached != null) return CodeHit.product(CartProduct.fromPosItem(cached));
    if (!usesCatalogue) {
      final items = (await api.searchItems(c, limit: 2)).items;
      return items.length == 1 ? CodeHit.product(CartProduct.fromItem(items.single)) : null;
    }
    try {
      return CodeHit.product(CartProduct.fromVariant(await api.lookupVariant(c)));
    } on ApiException catch (e) {
      if (e.status != 404) rethrow;
    }
    try {
      final hit = await api.counterResolve(c);
      if (hit.weighTicket != null) return _checkedTicket(hit.weighTicket!);
      if (hit.variant == null) return null;
      return CodeHit.product(CartProduct.fromVariant(hit.variant!), qty: hit.qty, serial: hit.serial);
    } on ApiException catch (e) {
      if (e.status == 404 || e.status == 403) return null;
      rethrow;
    }
  }

  CodeHit _checkedTicket(WeighTicket t) {
    final problem = ticketStateProblem(t, _now());
    if (problem != null) throw problem;
    if (cart.hasTicket(t.id)) throw TicketProblem(TicketProblemKind.duplicate, t.code);
    return CodeHit.ticket(t);
  }

  /// Puts a weigh ticket's lines on the bill as fixed lines (removable only as a group).
  void addTicket(WeighTicket t) {
    if (cart.hasTicket(t.id)) throw TicketProblem(TicketProblemKind.duplicate, t.code);
    _cart(cart.addTicket(t));
  }

  /// [lookupCode] and add what it found (a weight item without a scale label gets qty 1; the Bill tab asks for the
  /// weight instead). Returns false when nothing matched.
  Future<bool> addByCode(String code) async {
    final hit = await lookupCode(code);
    if (hit == null) return false;
    if (hit.ticket != null) {
      addTicket(hit.ticket!);
    } else {
      addProduct(hit.product!, qty: hit.qty ?? 1, serial: hit.serial);
    }
    return true;
  }

  // ---------------------------------------------------------------- customer

  void setCustomer(CounterCustomer c) {
    customer = c;
    _cartVersion++;
    notifyListeners();
  }

  Future<List<Customer>> searchCustomers(String q) async =>
      q.trim().length < 3 ? const [] : (await api.searchCustomers(q.trim())).items;

  /// Quick add (customer-bar.tsx): name, optional Indian mobile.
  Future<Customer> createCustomer(String name, String? phone) async {
    final n = name.trim();
    final c = await _once('customer:$n:$phone', (k) => api.createCustomer(n, phone: phone, idempotencyKey: k));
    setCustomer(CounterCustomer.saved(c.value));
    return c.value;
  }

  // ---------------------------------------------------------------- bill

  /// Estimate for the Charge button (not charged: the server's total is).
  int get estimate => cart.estimateTotal;

  InvoiceInput _input() => InvoiceInput(
        date: todayIst(),
        lines: cart.toLineInputs(),
        customerId: customer.kind == CustomerKind.saved ? customer.saved!.id : null,
        walkInName: customer.kind == CustomerKind.walkIn ? (customer.name?.trim().isNotEmpty ?? false ? customer.name!.trim() : walkInDefaultName) : null,
        walkInPhone: customer.kind == CustomerKind.walkIn ? customer.phone : null,
        issue: true,
        tillSessionId: dayOpen ? till!.id : null,
      );

  /// The walk-in name when the cashier gave none (the web's "Walk-in Customer").
  String walkInDefaultName = 'Walk-in Customer';

  /// POST /v1/invoices with `issue: true`. The same cart retried after a failure reuses its key, so it is made once.
  Future<Invoice> createBill() async {
    if (cart.isEmpty) throw StateError('The cart is empty');
    final input = _input();
    final r = await _once('create:$_cartVersion', (k) => api.createInvoice(input, idempotencyKey: k));
    bill = r.value;
    _plan = null;
    _recorded.clear();
    _ticketsToUse = cart.ticketIds;
    ticketUseFailures = const [];
    notifyListeners();
    await useTickets();
    return r.value;
  }

  // ---------------------------------------------------------------- weigh tickets on the bill

  List<String> _ticketsToUse = const [];

  /// Tickets of the current bill not marked used (a failed or lost answer); [useTickets] retries them.
  List<TicketUseFailure> ticketUseFailures = const [];

  /// POST /weigh-tickets/:id/use { invoiceId } for each ticket on the bill, one Idempotency-Key per (bill, ticket)
  /// reused on retries (the server answers a repeat with the ticket again). Never throws: the bill stands; failures
  /// are kept in [ticketUseFailures] (409 = used by another bill: reported, not retried).
  Future<void> useTickets() async {
    final b = bill;
    if (b == null || _ticketsToUse.isEmpty) return;
    final failures = <TicketUseFailure>[];
    final left = <String>[];
    for (final id in _ticketsToUse) {
      final action = 'ticket.use:${b.id}:$id';
      try {
        await _once(action, (k) => api.useWeighTicket(id, b.id, idempotencyKey: k));
      } catch (e) {
        final code = cart.lines.where((l) => l.ticketId == id).firstOrNull?.ticketCode;
        final f = TicketUseFailure(id, code, e);
        failures.add(f);
        if (f.isFinal) {
          _actions.forget(action);
        } else {
          left.add(id);
        }
      }
    }
    _ticketsToUse = left;
    ticketUseFailures = failures;
    notifyListeners();
  }

  /// Plans the payments for [t] against the server's balance (the plan is kept for retries) and records them in
  /// order. Throws on the first failure; call again (the same tenders) to retry from there with the same keys, or
  /// [finishWithout] to stop.
  Future<PaymentOutcome> pay(Tenders t, {String? upiRef, String? cardRef}) async {
    final b = bill;
    if (b == null) throw StateError('Make the bill first');
    if (_ticketsToUse.isNotEmpty) await useTickets();
    final hasCustomer = customer.kind == CustomerKind.saved;
    if (_plan == null) {
      final s = settle(b.balance, t, upiConfirmed: true, hasCustomer: hasCustomer, creditAllowed: creditAllowed);
      _plan = fitPayments(paymentsFor(s, t, upiRef: upiRef, cardRef: cardRef), b.balance);
      _cashTendered = t.cash;
      _recorded.clear();
    }
    final plan = _plan!;
    for (var i = 0; i < plan.length; i++) {
      if (_recorded.contains(i)) continue;
      final p = plan[i];
      final r = await _once(
        'pay:${b.id}:$i:${p.method}:${p.amount}',
        (k) => api.recordPayment(
          b.id,
          amount: p.amount,
          method: p.method,
          date: todayIst(),
          reference: p.reference,
          tillSessionId: dayOpen ? till!.id : null,
          idempotencyKey: k,
        ),
      );
      bill = r.value;
      _recorded.add(i);
      notifyListeners();
    }
    return _outcome();
  }

  /// Stops after a failed payment (the web counter's behaviour): the bill stays, the missing amount is reported.
  PaymentOutcome finishWithout() => _outcome();

  PaymentOutcome _outcome() {
    final plan = _plan ?? const <PlannedPayment>[];
    var cashKept = 0;
    var unrecorded = 0;
    for (var i = 0; i < plan.length; i++) {
      if (plan[i].method == 'cash') cashKept += plan[i].amount;
      if (!_recorded.contains(i)) unrecorded += plan[i].amount;
    }
    // Change is what was handed over beyond the cash kept for the bill, whether or not that cash payment could be
    // recorded (the web counter subtracts only recorded cash, which would hand back cash that was received).
    final change = _cashTendered - cashKept;
    return PaymentOutcome(bill: bill!, change: change > 0 ? change : 0, unrecorded: unrecorded);
  }

  /// The money screen was left without paying: cancel the issued bill.
  Future<void> cancelBill(String reason) async {
    final b = bill;
    if (b == null) return;
    await _once('cancel:${b.id}', (k) => api.cancelInvoice(b.id, reason: reason, idempotencyKey: k));
    bill = null;
    _plan = null;
    _recorded.clear();
    notifyListeners();
  }

  Future<ShareLink> share() async {
    final b = bill!;
    return (await _once('share:${b.id}', (k) => api.shareInvoice(b.id, idempotencyKey: k))).value;
  }

  /// After the done screen: an empty counter (the till stays).
  void newBill() {
    cart = const Cart();
    customer = const CounterCustomer.none();
    bill = null;
    _plan = null;
    _recorded.clear();
    _cashTendered = 0;
    _ticketsToUse = const [];
    ticketUseFailures = const [];
    _cartVersion++;
    notifyListeners();
  }

  // ---------------------------------------------------------------- till

  Future<void> openTill(String registerName, int openingCash) async {
    final reg = cleanRegister(fixedRegister ?? registerName);
    final r = await _once('till.open:$reg:$openingCash',
        (k) => api.openTill(reg, openingCash: openingCash, actorName: actorName, idempotencyKey: k));
    register = reg;
    if (fixedRegister == null) await session.store.write(registerKey, reg);
    till = r.value;
    notifyListeners();
  }

  /// [amount] positive = cash in, negative = cash out.
  Future<void> cashInOut(int amount, String reason) async {
    final t = till!;
    final note = reason.trim().length > 120 ? reason.trim().substring(0, 120) : reason.trim();
    final r = await _once('till.cash:${t.id}:$amount:$note',
        (k) => api.tillCash(t.id, amount: amount, reason: note, actorName: actorName, idempotencyKey: k));
    till = r.value;
    notifyListeners();
  }

  Future<TillSessionReport> xReport() => api.tillX(till!.id);

  /// Closes the day with the counted cash; returns the Z report. The till is then closed.
  Future<TillSessionReport> closeTill(int countedCash, String? note) async {
    final t = till!;
    final n = note?.trim();
    final r = await _once(
      'till.close:${t.id}:$countedCash',
      (k) => api.closeTill(t.id,
          countedCash: countedCash,
          note: n == null || n.isEmpty ? null : (n.length > 300 ? n.substring(0, 300) : n),
          actorName: actorName,
          idempotencyKey: k),
    );
    till = r.value.session;
    notifyListeners();
    return r.value;
  }
}
