import 'billing_models.dart';
import 'books_models.dart';
import 'catalog_models.dart';
import 'client.dart';
import 'models.dart';
import 'pos_models.dart';

Json _obj(Object? v) {
  if (v is Map) return v.cast<String, dynamic>();
  throw const ApiException(0, ApiException.badResponseCode, 'The server sent an unexpected answer');
}

/// Typed endpoints over [ApiClient]. Paths are relative to `/v1`.
///
/// Every write takes an optional `idempotencyKey` (sent as `Idempotency-Key`; make it with `IdempotencyKeys.next()`
/// and reuse it for retries of the same action). Without one, the write is not deduplicated.
class SrikitApi {
  SrikitApi(this.client);
  final ApiClient client;

  // ---- mobile (apps/api/src/kit-mobile.ts)

  /// Minimum / latest app versions for the `x-client` app. Public; never answers 426.
  Future<MobileConfig> mobileConfig() async => MobileConfig.fromJson(_obj(await client.get('/mobile/config')));

  // ---- auth (packages/auth/src/routes.ts)

  Future<AuthClientConfig> authConfig() async => AuthClientConfig.fromJson(_obj(await client.get('/auth/config')));

  /// Sends a one-time code. [target] is E.164 (`+91…`) for sms / whatsapp, or an email.
  Future<OtpRequestResult> requestOtp(String target, {String channel = 'sms', String? idempotencyKey}) async =>
      OtpRequestResult.fromJson(
          _obj(await client.post('/auth/otp/request', {'target': target, 'channel': channel}, idempotencyKey)));

  Future<SignInResult> verifyOtp(String target, String code, {String? name, String? idempotencyKey}) async =>
      SignInResult.fromJson(_obj(await client.post(
          '/auth/otp/verify', {'target': target, 'code': code, if (name != null) 'name': name}, idempotencyKey)));

  /// Exchanges a Firebase Phone Authentication ID token for a srikit session.
  Future<SignInResult> firebaseSignIn(String idToken, {String? name, String? idempotencyKey}) async =>
      SignInResult.fromJson(_obj(
          await client.post('/auth/firebase', {'idToken': idToken, if (name != null) 'name': name}, idempotencyKey)));

  Future<Me> me() async => Me.fromJson(_obj(await client.get('/auth/me')));

  Future<Ok> logout({String? idempotencyKey}) => _ok('POST', '/auth/logout', const <String, Object?>{}, idempotencyKey);

  // ---- tenancy (packages/tenancy/src/routes.ts)

  Future<List<Membership>> myShops() async => Page.fromJson(await client.get('/tenancy/mine'), Membership.fromJson).items;

  // ---- features / branding (need x-tenant)

  Future<TenantFeatures> features() async => TenantFeatures.fromJson(_obj(await client.get('/features')));

  Future<Branding> branding() async => Branding.fromJson(_obj(await client.get('/branding')));

  // ---- invoices

  Future<DashboardSummary> invoiceSummary() async => DashboardSummary.fromJson(_obj(await client.get('/invoices/summary')));

  // ---- notify (packages/notify/src/routes.ts)

  /// [platform] is `android` or `ios`. Stored for the signed-in user and the current `x-tenant` shop (if any).
  Future<Ok> registerPushToken(String token, String platform, {String? idempotencyKey}) =>
      _ok('POST', '/notify/push-tokens', {'token': token, 'platform': platform}, idempotencyKey);

  Future<Ok> removePushToken(String token, {String? idempotencyKey}) =>
      _ok('DELETE', '/notify/push-tokens', {'token': token}, idempotencyKey);

  // ---- catalogue / counter (packages/catalogue/src/routes.ts, apps/api/src/kit-verticals.ts)

  /// Variant search for the counter (the web counter asks for 24).
  Future<Page<Variant>> searchVariants(String q, {int limit = 24}) async => Page.fromJson(
      await client.get('/catalog/variants/search', query: {'q': q, 'limit': '$limit'}), Variant.fromJson);

  /// Exact barcode / SKU match. 404 when nothing matches.
  Future<Variant> lookupVariant(String code) async =>
      Variant.fromJson(_obj(await client.get('/catalog/variants/lookup', query: {'code': code})));

  /// Codes no barcode matches: weighing-scale labels (qty) and serials / IMEIs (serial). 404 when nothing matches.
  Future<CounterResolve> counterResolve(String code) async =>
      CounterResolve.fromJson(_obj(await client.get('/counter/resolve', query: {'code': code})));

  /// Saved billing items (shops without the catalogue). Rates are GST-exclusive.
  Future<Page<BillingItem>> searchItems(String q, {int limit = 24}) async =>
      Page.fromJson(await client.get('/invoices/items', query: {'q': q, 'limit': '$limit'}), BillingItem.fromJson);

  // ---- customers

  Future<Page<Customer>> searchCustomers(String q, {int limit = 6}) async =>
      Page.fromJson(await client.get('/invoices/customers', query: {'q': q, 'limit': '$limit'}), Customer.fromJson);

  /// Needs `customers.create`. [phone] is E.164 (+91…) or null.
  Future<Written<Customer>> createCustomer(String name, {String? phone, String? idempotencyKey}) =>
      _written('POST', '/invoices/customers', {'name': name, 'phone': phone}, idempotencyKey, Customer.fromJson);

  /// The customer list (More → Customers). [balance]: `due`, `advance`, `settled`; [overLimit] true / false; [sort]:
  /// `name` (default), `balance`, `lastBill`, `billed`, `-` for descending. `facets.balance` counts per kind.
  Future<Page<Customer>> customers({
    String? q,
    List<String>? balance,
    bool? overLimit,
    String? sort,
    int limit = 50,
    int offset = 0,
  }) async =>
      Page.fromJson(
        await client.get('/invoices/customers', query: {
          if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
          if (balance != null && balance.isNotEmpty) 'balance': balance.join(','),
          if (overLimit != null) 'overLimit': '$overLimit',
          if (sort != null) 'sort': sort,
          'limit': '$limit',
          'offset': '$offset',
        }),
        Customer.fromJson,
      );

  Future<Customer> customer(String id) async =>
      Customer.fromJson(_obj(await client.get('/invoices/customers/${_seg(id)}')));

  /// Creates a customer with every field (needs `customers.create`): `name`, `phone`, `email`, `gstin`, `address`,
  /// `stateCode`, and with the credit book `openingBalance` (+ owes, − advance) and `creditLimit` (null = none).
  Future<Written<Customer>> addCustomer(Map<String, Object?> body, {String? idempotencyKey}) =>
      _written('POST', '/invoices/customers', body, idempotencyKey, Customer.fromJson);

  /// Changes the given fields (needs `customers.create`); `null` clears an optional one.
  Future<Written<Customer>> updateCustomer(String id, Map<String, Object?> patch, {String? idempotencyKey}) =>
      _written('PATCH', '/invoices/customers/${_seg(id)}', patch, idempotencyKey, Customer.fromJson);

  /// Bills, newest first by default; [customerId] for one customer's bills.
  Future<Page<InvoiceSummary>> invoices({String? customerId, String? q, List<String>? statuses, int limit = 20, int offset = 0, String? sort}) async =>
      Page.fromJson(
        await client.get('/invoices', query: {
          if (customerId != null) 'customerId': customerId,
          if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
          if (statuses != null && statuses.isNotEmpty) 'status': statuses.join(','),
          'limit': '$limit',
          'offset': '$offset',
          if (sort != null) 'sort': sort,
        }),
        InvoiceSummary.fromJson,
      );

  // ---- credit book (feature + permission `invoices.credit-book`)

  /// [filter]: `due`, `advance` or `all` (default); [age]: overdue buckets `current`, `1-30`, `31-60`, `61-90`,
  /// `90+`; [sort]: `due`, `oldestDue`, `lastPayment`, `name` (`-` for descending; the web's default is `-due`).
  Future<CreditBookPage> creditBook({String? q, String? filter, List<String>? age, String? sort, int limit = 50, int offset = 0}) async =>
      CreditBookPage.fromJson(_obj(await client.get('/invoices/credit-book', query: {
        if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
        if (filter != null) 'filter': filter,
        if (age != null && age.isNotEmpty) 'age': age.join(','),
        if (sort != null) 'sort': sort,
        'limit': '$limit',
        'offset': '$offset',
      })));

  /// A customer's running-balance statement for [from]..[to] (`YYYY-MM-DD`, both optional).
  Future<Ledger> ledger(String customerId, {String? from, String? to}) async => Ledger.fromJson(_obj(await client.get(
      '/invoices/customers/${_seg(customerId)}/ledger',
      query: {if (from != null) 'from': from, if (to != null) 'to': to})));

  /// Money received on account (also needs `payments.receive`): settles the oldest bills first, the rest is advance.
  Future<Written<ReceiptResult>> receivePayment(
    String customerId, {
    required int amount,
    required String method,
    required String date,
    String? reference,
    String? note,
    String? idempotencyKey,
  }) =>
      _written(
        'POST',
        '/invoices/customers/${_seg(customerId)}/receipts',
        {
          'amount': amount,
          'method': method,
          'date': date,
          if (reference != null && reference.trim().isNotEmpty) 'reference': reference.trim(),
          if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        },
        idempotencyKey,
        ReceiptResult.fromJson,
      );

  /// The customer's public statement link (the same link every time).
  Future<Written<ShareLink>> shareStatement(String customerId, {String? idempotencyKey}) => _written('POST',
      '/invoices/customers/${_seg(customerId)}/statement/share', const <String, Object?>{}, idempotencyKey, ShareLink.fromJson);

  /// Sends a payment reminder from the shop's WhatsApp (feature `invoices.whatsapp`). 400 when nothing is due.
  Future<Written<RemindResult>> remindCustomer(String customerId, {String channel = 'whatsapp', String? locale, String? idempotencyKey}) =>
      _written('POST', '/invoices/customers/${_seg(customerId)}/remind', {'channel': channel, if (locale != null) 'locale': locale},
          idempotencyKey, RemindResult.fromJson);

  // ---- expenses (packages/expenses/src/routes.ts; feature `expenses`, permission `expenses.manage`)

  /// [statuses]: `recorded` (the server's default), `cancelled`, `all`. [from] / [to] `YYYY-MM-DD`.
  Future<ExpensePage> expenses({
    String? q,
    String? from,
    String? to,
    List<String>? categoryIds,
    List<String>? paymentMethods,
    List<String>? statuses,
    String sort = '-date',
    int limit = 50,
    int offset = 0,
  }) async =>
      ExpensePage.fromJson(_obj(await client.get('/expenses', query: {
        if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
        if (from != null) 'from': from,
        if (to != null) 'to': to,
        if (categoryIds != null && categoryIds.isNotEmpty) 'categoryId': categoryIds.join(','),
        if (paymentMethods != null && paymentMethods.isNotEmpty) 'paymentMethod': paymentMethods.join(','),
        if (statuses != null && statuses.isNotEmpty) 'status': statuses.join(','),
        'sort': sort,
        'limit': '$limit',
        'offset': '$offset',
      })));

  Future<Written<Expense>> createExpense(ExpenseInput input, {String? idempotencyKey}) =>
      _written('POST', '/expenses', input.toJson(), idempotencyKey, Expense.fromJson);

  Future<Written<Expense>> updateExpense(String id, ExpenseInput patch, {String? idempotencyKey}) =>
      _written('PATCH', '/expenses/${_seg(id)}', patch.toJson(), idempotencyKey, Expense.fromJson);

  /// Cancels (the expense stays on record, left out of totals); answers with the cancelled expense.
  Future<Written<Expense>> cancelExpense(String id, {String? idempotencyKey}) =>
      _written('DELETE', '/expenses/${_seg(id)}', const <String, Object?>{}, idempotencyKey, Expense.fromJson);

  /// Totals for [from]..[to] (the server's default: this month).
  Future<ExpenseSummary> expenseSummary({String? from, String? to}) async => ExpenseSummary.fromJson(
      _obj(await client.get('/expenses/summary', query: {if (from != null) 'from': from, if (to != null) 'to': to})));

  Future<List<ExpenseCategory>> expenseCategories() async =>
      Page.fromJson(await client.get('/expenses/categories'), ExpenseCategory.fromJson).items;

  /// 409 when the name exists.
  Future<Written<ExpenseCategory>> createExpenseCategory(String name, {String? idempotencyKey}) =>
      _written('POST', '/expenses/categories', {'name': name.trim()}, idempotencyKey, ExpenseCategory.fromJson);

  Future<Written<ExpenseCategory>> renameExpenseCategory(String id, String name, {String? idempotencyKey}) =>
      _written('PATCH', '/expenses/categories/${_seg(id)}', {'name': name.trim()}, idempotencyKey, ExpenseCategory.fromJson);

  /// Custom categories with no expenses only (400 built-in, 409 in use).
  Future<Ok> deleteExpenseCategory(String id, {String? idempotencyKey}) =>
      _ok('DELETE', '/expenses/categories/${_seg(id)}', const <String, Object?>{}, idempotencyKey);

  // ---- bills (packages/invoices/src/routes.ts)

  /// Creates a bill; with `issue: true` (the counter) it is numbered and issued in the same call.
  Future<Written<Invoice>> createInvoice(InvoiceInput input, {String? idempotencyKey}) =>
      _written('POST', '/invoices', input.toJson(), idempotencyKey, Invoice.fromJson);

  Future<Invoice> getInvoice(String id) async => Invoice.fromJson(_obj(await client.get('/invoices/${_seg(id)}')));

  /// Issues a draft (not needed after `createInvoice(issue: true)`).
  Future<Written<Invoice>> issueInvoice(String id, {String? idempotencyKey}) =>
      _written('POST', '/invoices/${_seg(id)}/issue', const <String, Object?>{}, idempotencyKey, Invoice.fromJson);

  /// Records money received on a bill (needs `payments.receive`). [date] is `YYYY-MM-DD` (IST).
  Future<Written<Invoice>> recordPayment(
    String invoiceId, {
    required int amount,
    required String method,
    required String date,
    String? reference,
    String? tillSessionId,
    String? idempotencyKey,
  }) =>
      _written(
        'POST',
        '/invoices/${_seg(invoiceId)}/payments',
        {
          'amount': amount,
          'method': method,
          'date': date,
          if (reference != null && reference.isNotEmpty) 'reference': reference,
          if (tillSessionId != null) 'tillSessionId': tillSessionId,
        },
        idempotencyKey,
        Invoice.fromJson,
      );

  Future<Written<Invoice>> cancelInvoice(String id, {String? reason, String? idempotencyKey}) =>
      _written('POST', '/invoices/${_seg(id)}/cancel', {'reason': reason}, idempotencyKey, Invoice.fromJson);

  /// A public link to the bill (for WhatsApp).
  Future<Written<ShareLink>> shareInvoice(String id, {String? idempotencyKey}) =>
      _written('POST', '/invoices/${_seg(id)}/share', const <String, Object?>{}, idempotencyKey, ShareLink.fromJson);

  // ---- till (packages/invoices/src/till.ts)

  Future<TillCurrent> tillCurrent(String register) async =>
      TillCurrent.fromJson(_obj(await client.get('/invoices/till/current', query: {'register': register})));

  /// Opens the day for [register] with [openingCash] paise in the drawer (needs `pos.till`).
  Future<Written<TillSession>> openTill(String register, {required int openingCash, String? actorName, String? idempotencyKey}) =>
      _written('POST', '/invoices/till/open', {'register': register, 'openingCash': openingCash, 'actorName': actorName},
          idempotencyKey, TillSession.fromJson);

  /// Cash in (positive [amount]) or out (negative).
  Future<Written<TillSession>> tillCash(String sessionId,
          {required int amount, required String reason, String? actorName, String? idempotencyKey}) =>
      _written('POST', '/invoices/till/${_seg(sessionId)}/cash', {'amount': amount, 'reason': reason, 'actorName': actorName},
          idempotencyKey, TillSession.fromJson);

  /// Closes the day with the counted cash; answers with the Z report.
  Future<Written<TillSessionReport>> closeTill(String sessionId,
          {required int countedCash, String? note, String? actorName, String? idempotencyKey}) =>
      _written('POST', '/invoices/till/${_seg(sessionId)}/close',
          {'countedCash': countedCash, 'note': note, 'actorName': actorName}, idempotencyKey, TillSessionReport.fromJson);

  /// The X report (so far today) of an open session.
  Future<TillSessionReport> tillX(String sessionId) async =>
      TillSessionReport.fromJson(_obj(await client.get('/invoices/till/${_seg(sessionId)}/x')));

  // ---- products (packages/catalogue/src/routes.ts)

  Future<Page<Category>> categories() async => Page.fromJson(await client.get('/catalog/categories'), Category.fromJson);

  /// Product list. [statuses] defaults to the server's (all but archived when not given); [stock] filters by
  /// `ok` / `low` / `out` / `untracked` (comma lists, like the web).
  Future<Page<ProductRow>> products({
    String? q,
    String? categoryId,
    List<String>? statuses,
    List<String>? stock,
    int limit = 30,
    int offset = 0,
    String? sort,
  }) async =>
      Page.fromJson(
        await client.get('/catalog/products', query: {
          if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
          if (categoryId != null) 'categoryId': categoryId,
          if (statuses != null && statuses.isNotEmpty) 'status': statuses.join(','),
          if (stock != null && stock.isNotEmpty) 'stock': stock.join(','),
          'limit': '$limit',
          'offset': '$offset',
          if (sort != null) 'sort': sort,
        }),
        ProductRow.fromJson,
      );

  Future<Product> product(String id) async => Product.fromJson(_obj(await client.get('/catalog/products/${_seg(id)}')));

  /// Creates a product (`catalogue.manage`). A simple product passes `price` / `sku` / `barcode` / `mrp` at the top
  /// level and gets one default variant.
  Future<Written<Product>> createProduct(Map<String, Object?> body, {String? idempotencyKey}) =>
      _written('POST', '/catalog/products', body, idempotencyKey, Product.fromJson);

  /// Product fields (name, category, tax, status…). Prices live on variants.
  Future<Written<Product>> updateProduct(String id, Map<String, Object?> patch, {String? idempotencyKey}) =>
      _written('PATCH', '/catalog/products/${_seg(id)}', patch, idempotencyKey, Product.fromJson);

  /// Price / MRP / SKU / barcode of a variant.
  Future<Written<ProductVariant>> updateVariant(String id, Map<String, Object?> patch, {String? idempotencyKey}) =>
      _written('PATCH', '/catalog/variants/${_seg(id)}', patch, idempotencyKey, ProductVariant.fromJson);

  /// The price of a simple product when the shop lacks `catalogue.variants` (the web editor's fallback): the
  /// billing-item facade over the variant, with a GST-exclusive [rate].
  Future<Written<BillingItem>> updateItemRate(String variantId, int rate, {String? idempotencyKey}) =>
      _written('PATCH', '/invoices/items/${_seg(variantId)}', {'rate': rate}, idempotencyKey, BillingItem.fromJson);

  // ---- stock (packages/inventory/src/routes.ts)

  /// Stock rows. [statuses]: `in`, `low`, `out`, `untracked`. [locationId]: a location id or `all`.
  Future<StockPage> stock({String? q, List<String>? statuses, String? locationId, int limit = 30, int offset = 0}) async =>
      StockPage.fromJson(_obj(await client.get('/inventory/stock', query: {
        if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
        if (statuses != null && statuses.isNotEmpty) 'status': statuses.join(','),
        if (locationId != null) 'locationId': locationId,
        'limit': '$limit',
        'offset': '$offset',
      })));

  Future<StockItem> stockItem(String itemId, {String? locationId}) async => StockItem.fromJson(_obj(await client.get(
      '/inventory/stock/${_seg(itemId)}',
      query: {if (locationId != null) 'locationId': locationId})));

  /// `mode`: `add`, `remove` or `set`; [qty] up to 3 decimals; [unitCost] paise (for added stock).
  Future<Written<StockItem>> adjustStock(
    String itemId, {
    required String mode,
    required double qty,
    String? note,
    int? unitCost,
    String? locationId,
    String? idempotencyKey,
  }) =>
      _written(
        'POST',
        '/inventory/stock/${_seg(itemId)}/adjust',
        {
          'mode': mode,
          'qty': qty == qty.roundToDouble() ? qty.toInt() : qty,
          if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
          if (unitCost != null) 'unitCost': unitCost,
          if (locationId != null) 'locationId': locationId,
        },
        idempotencyKey,
        StockItem.fromJson,
      );

  /// Tracking on / off and the low-stock level.
  Future<Written<StockItem>> updateStockSettings(String itemId,
          {bool? track, double? reorderLevel, String? locationId, String? idempotencyKey}) =>
      _written(
        'PATCH',
        '/inventory/stock/${_seg(itemId)}',
        {
          if (track != null) 'track': track,
          if (reorderLevel != null) 'reorderLevel': reorderLevel,
          if (locationId != null) 'locationId': locationId,
        },
        idempotencyKey,
        StockItem.fromJson,
      );

  Future<Page<StockMovement>> stockMovements(String itemId, {String? locationId, int limit = 30, int offset = 0}) async =>
      Page.fromJson(
        await client.get('/inventory/stock/${_seg(itemId)}/movements', query: {
          if (locationId != null) 'locationId': locationId,
          'limit': '$limit',
          'offset': '$offset',
        }),
        StockMovement.fromJson,
      );

  /// Stock locations (feature `inventory.locations`).
  Future<Page<StockLocation>> stockLocations() async =>
      Page.fromJson(await client.get('/inventory/locations'), StockLocation.fromJson);

  Future<StockSummary> stockSummary({String? locationId}) async => StockSummary.fromJson(
      _obj(await client.get('/inventory/summary', query: {if (locationId != null) 'locationId': locationId})));

  // ---- orders (packages/orders/src/routes.ts)

  Future<OrderPage> orders({String? q, List<String>? statuses, int limit = 30, int offset = 0, String sort = '-placed'}) async =>
      OrderPage.fromJson(_obj(await client.get('/orders', query: {
        if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
        if (statuses != null && statuses.isNotEmpty) 'status': statuses.join(','),
        'limit': '$limit',
        'offset': '$offset',
        'sort': sort,
      })));

  Future<OrderSummary> orderSummary() async => OrderSummary.fromJson(_obj(await client.get('/orders/summary')));

  Future<Order> order(String id) async => Order.fromJson(_obj(await client.get('/orders/${_seg(id)}')));

  /// Moves an order (confirm, pack, ship, deliver, cancel, return). [note] is the cancel reason when cancelling.
  Future<Written<Order>> setOrderStatus(String id, String status,
          {String? note, Fulfillment? fulfillment, String? idempotencyKey}) =>
      _written(
        'POST',
        '/orders/${_seg(id)}/status',
        {
          'status': status,
          if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
          if (fulfillment != null && !fulfillment.isEmpty) 'fulfillment': fulfillment.toJson(),
        },
        idempotencyKey,
        Order.fromJson,
      );

  Future<Written<Order>> updateFulfillment(String id, Fulfillment f, {String? idempotencyKey}) =>
      _written('POST', '/orders/${_seg(id)}/fulfillment', f.toJson(), idempotencyKey, Order.fromJson);

  Future<Written<Order>> recordOrderPayment(String id,
          {required int amount, required String method, String? reference, String? date, String? idempotencyKey}) =>
      _written(
        'POST',
        '/orders/${_seg(id)}/payments',
        {
          'amount': amount,
          'method': method,
          if (reference != null && reference.trim().isNotEmpty) 'reference': reference.trim(),
          if (date != null) 'date': date,
        },
        idempotencyKey,
        Order.fromJson,
      );

  Future<Written<Order>> addOrderNote(String id, String message, {String? idempotencyKey}) =>
      _written('POST', '/orders/${_seg(id)}/notes', {'message': message}, idempotencyKey, Order.fromJson);

  /// Makes (or retries) the order's invoice. Idempotent on the server: an invoiced order is returned as is.
  Future<Written<Order>> invoiceOrder(String id, {String? idempotencyKey}) =>
      _written('POST', '/orders/${_seg(id)}/invoice', const <String, Object?>{}, idempotencyKey, Order.fromJson);

  // ---- POS terminals (packages/pos/src/routes.ts, docs/pos-terminals.md)

  /// The shop's terminals (staff session with `pos.devices`).
  Future<PosTerminalList> posTerminals() async => PosTerminalList.fromJson(_obj(await client.get('/pos/terminals')));

  /// A new pairing code for a terminal (the old code stops working; a paired device keeps working until a new one
  /// pairs). Staff session with `pos.devices`.
  Future<Written<PosPairing>> posPairingCode(String terminalId, {String? idempotencyKey}) => _written(
      'POST', '/pos/terminals/${_seg(terminalId)}/pairing-code', const <String, Object?>{}, idempotencyKey, PosPairing.fromJson);

  /// Pairs this device with the terminal behind [code] (public; case-insensitive, dash optional). 400
  /// `pairing_code_invalid`, 429 `too_many_attempts` (`details.retryAfterSeconds`), 403 `feature_disabled`.
  Future<Written<PosPairResult>> posPair(String code, PosDeviceDescription device, {String? idempotencyKey}) =>
      _written('POST', '/pos/pair', {'code': code, 'device': device.toJson()}, idempotencyKey, PosPairResult.fromJson);

  /// The paired terminal, its shop and the shop's enabled features (`x-device-token`).
  Future<PosDeviceInfo> posDevice() async => PosDeviceInfo.fromJson(_obj(await client.get('/pos/device')));

  /// The device forgets itself (its token stops working).
  Future<Ok> posUnpairDevice({String? idempotencyKey}) =>
      _ok('POST', '/pos/device/unpair', const <String, Object?>{}, idempotencyKey);

  /// Unlocks the terminal with a staff PIN. 401 `pin_invalid` (`details.remaining`), 429 `pin_locked`
  /// (`details.retryAfterSeconds`), 403 `pin_not_allowed`.
  Future<PosPinSession> posSession(String pin) async =>
      PosPinSession.fromJson(_obj(await client.post('/pos/session', {'pin': pin})));

  /// Ends the PIN session (Lock / Switch cashier).
  Future<Ok> posLock({String? idempotencyKey}) => _ok('POST', '/pos/session/lock', const <String, Object?>{}, idempotencyKey);

  /// Names for the lock screen.
  Future<List<PosStaffEntry>> posStaff() async =>
      PosList.fromJson(_obj(await client.get('/pos/staff')), PosStaffEntry.fromJson).items;

  /// One page of the POS catalogue. Send [since] (the last sync's cursor) *or* [after] (a page token), not both.
  /// With [etag] (the page's last ETag) a 304 comes back as [PosCatalogPage.unchanged].
  Future<PosCatalogPage> posCatalog({String? since, String? after, int? limit, String? etag}) async {
    final res = await client.request('GET', '/pos/catalog',
        query: {
          if (after != null) 'after': after else if (since != null) 'since': since,
          if (limit != null) 'limit': '$limit',
        },
        headers: {if (etag != null) 'if-none-match': etag});
    if (res.status == 304) return PosCatalogPage.unchanged;
    return PosCatalogPage.fromJson(_obj(res.data), etag: res.headers['etag']);
  }

  Future<List<PosCategory>> posCategories() async =>
      PosList.fromJson(_obj(await client.get('/pos/catalog/categories')), PosCategory.fromJson).items;

  /// Issues a weigh ticket (weighing terminal + PIN session with `pos.weigh`). The server prices every line.
  Future<Written<WeighTicket>> createWeighTicket(List<WeighTicketLineInput> lines, {String? note, String? idempotencyKey}) =>
      _written(
        'POST',
        '/pos/weigh-tickets',
        {
          'lines': [for (final l in lines) l.toJson()],
          if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        },
        idempotencyKey,
        WeighTicket.fromJson,
      );

  /// Today's tickets of this terminal ([status]: `open`, `used`, `cancelled`).
  Future<WeighTicketPage> weighTickets({String? status, int? limit}) async {
    final query = {if (status != null) 'status': status, if (limit != null) 'limit': '$limit'};
    return WeighTicketPage.fromJson(_obj(await client.get('/pos/weigh-tickets', query: query)));
  }

  /// 404 `ticket_not_found`, 409 `ticket_used` / `ticket_cancelled`, 410 `ticket_expired`.
  Future<WeighTicket> weighTicketByCode(String code) async =>
      WeighTicket.fromJson(_obj(await client.get('/pos/weigh-tickets/by-code/${_seg(code)}')));

  /// Marks the ticket used by a bill; repeated with the same [invoiceId] it answers the ticket again.
  Future<Written<WeighTicket>> useWeighTicket(String id, String invoiceId, {String? idempotencyKey}) =>
      _written('POST', '/pos/weigh-tickets/${_seg(id)}/use', {'invoiceId': invoiceId}, idempotencyKey, WeighTicket.fromJson);

  Future<Written<WeighTicket>> cancelWeighTicket(String id, {String? idempotencyKey}) => _written(
      'POST', '/pos/weigh-tickets/${_seg(id)}/cancel', const <String, Object?>{}, idempotencyKey, WeighTicket.fromJson);

  static String _seg(String id) => Uri.encodeComponent(id);

  Future<Written<T>> _written<T>(String method, String path, Object body, String? idempotencyKey, T Function(Json) parse) async {
    final res = await client.request(method, path, body: body, idempotencyKey: idempotencyKey);
    return Written(parse(_obj(res.data)), replayed: res.replayed);
  }

  Future<Ok> _ok(String method, String path, Object body, String? idempotencyKey) async {
    final res = await client.request(method, path, body: body, idempotencyKey: idempotencyKey);
    return Ok.fromJson(res.data is Map ? _obj(res.data) : const {}, replayed: res.replayed);
  }
}
