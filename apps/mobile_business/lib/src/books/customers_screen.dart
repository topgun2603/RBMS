import 'dart:async';

import 'package:flutter/material.dart' hide Page;
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';
import 'books_rules.dart';
import 'books_text.dart';
import 'credit_book_screen.dart';
import 'credit_flows.dart';
import 'ledger_screen.dart';

/// More → Customers (customers.tsx): search, balance filter (all / has dues / advance / settled with the server's
/// counts), infinite scroll, add (customers.create).
class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});

  static const searchField = Key('customers.search');
  static const addButton = Key('customers.add');

  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  static const _pageSize = 50;
  static const _balances = [null, 'due', 'advance', 'settled'];
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;
  String? _balance;
  List<Customer> _items = const [];
  int _total = 0;
  Map<String, int> _counts = const {};
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _more();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  SrikitApi get _api => AppScope.read(context).api;

  Future<Page<Customer>> _fetch(int offset) =>
      _api.customers(q: _search.text, balance: _balance == null ? null : [_balance!], limit: _pageSize, offset: offset);

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final p = await _fetch(0);
      if (!mounted) return;
      final facets = p.facets?['balance'];
      setState(() {
        _items = p.items;
        _total = p.total ?? p.items.length;
        if (facets is Map) _counts = facets.map((k, v) => MapEntry('$k', v is num ? v.toInt() : 0));
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _more() async {
    if (_loading || _items.length >= _total) return;
    setState(() => _loading = true);
    try {
      final p = await _fetch(_items.length);
      if (mounted) setState(() => _items = [..._items, ...p.items]);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _add() async {
    final saved = await Navigator.of(context).push<Customer>(MaterialPageRoute(builder: (_) => const CustomerFormScreen()));
    if (saved != null && mounted) {
      _reload();
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => CustomerDetailScreen(customerId: saved.id, initial: saved)));
    }
  }

  String _chipLabel(AppLocalizations l, String? b) {
    final label = switch (b) {
      'due' => l.customersHasDues,
      'advance' => l.balanceAdvanceShort,
      'settled' => l.balanceSettledShort,
      _ => l.ordersAll,
    };
    final n = b == null ? null : _counts[b];
    return n == null || n == 0 ? label : '$label · $n';
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final access = BooksAccess(GateScope.of(context));
    return Scaffold(
      appBar: AppBar(
        title: Text(l.customersTitle),
        actions: [
          if (access.creditBook)
            IconButton(
              key: const Key('customers.creditBook'),
              tooltip: l.creditBookTitle,
              icon: const Icon(Icons.menu_book_outlined),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreditBookScreen())),
            ),
        ],
      ),
      floatingActionButton: access.editCustomers
          ? FloatingActionButton.extended(
              key: CustomersScreen.addButton,
              onPressed: _add,
              icon: const Icon(Icons.person_add_alt),
              label: Text(l.customersAdd),
            )
          : null,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: TextField(
            key: CustomersScreen.searchField,
            controller: _search,
            onChanged: (_) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 300), _reload);
            },
            decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.customersSearch),
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(children: [
            for (final b in _balances)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(
                  key: Key('customers.filter.${b ?? 'all'}'),
                  label: Text(_chipLabel(l, b)),
                  selected: _balance == b,
                  onSelected: (_) {
                    setState(() => _balance = b);
                    _reload();
                  },
                ),
              ),
          ]),
        ),
        if (_loading && _items.isEmpty) const LinearProgressIndicator(minHeight: 2),
        if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(errorText(l, _error), style: TextStyle(color: theme.colorScheme.error))),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _reload,
            child: _items.isEmpty && !_loading
                ? ListView(children: [
                    Padding(
                      padding: const EdgeInsets.all(32),
                      child: Center(child: Text(_search.text.isEmpty && _balance == null ? l.customersEmpty : l.customersNoMatch, textAlign: TextAlign.center)),
                    ),
                  ])
                : ListView.separated(
                    controller: _scroll,
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.only(bottom: 88),
                    itemCount: _items.length,
                    separatorBuilder: (_, i) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final c = _items[i];
                      final usage = creditUsage(c);
                      return ListTile(
                        key: Key('customers.row.$i'),
                        leading: CircleAvatar(child: Text(c.name.isEmpty ? '?' : c.name.characters.first.toUpperCase())),
                        title: Text(c.name),
                        subtitle: Text([
                          if (c.phone != null) prettyPhone(c.phone!),
                          if (c.lastBillDate != null) l.customersLastBill(dayLabel(c.lastBillDate!, l.localeName)),
                        ].join(' · ')),
                        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                          if (c.outstanding != 0)
                            Text(formatPaise(c.outstanding.abs()),
                                style: TextStyle(fontWeight: FontWeight.w600, color: sideColor(theme.colorScheme, balanceSide(c.outstanding)))),
                          if (usage != null && usage.over)
                            Text(l.customersOverLimit, style: TextStyle(color: theme.colorScheme.error, fontSize: 12))
                          else
                            SidePill(c.outstanding),
                        ]),
                        onTap: () => Navigator.of(context)
                            .push(MaterialPageRoute(builder: (_) => CustomerDetailScreen(customerId: c.id, initial: c)))
                            .then((_) => _reload()),
                      );
                    },
                  ),
          ),
        ),
      ]),
    );
  }
}

/// One customer (customer-detail.tsx): contact (call / WhatsApp), balance with the credit-limit meter, the credit-book
/// actions the user may take (receive, statement, reminder, ledger) and the latest bills.
class CustomerDetailScreen extends StatefulWidget {
  const CustomerDetailScreen({super.key, required this.customerId, this.initial});
  final String customerId;
  final Customer? initial;

  static const callButton = Key('customer.call');
  static const whatsappButton = Key('customer.whatsapp');
  static const editButton = Key('customer.edit');
  static const receiveButton = Key('customer.receive');
  static const shareButton = Key('customer.share');
  static const remindButton = Key('customer.remind');
  static const ledgerButton = Key('customer.ledger');

  @override
  State<CustomerDetailScreen> createState() => _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends State<CustomerDetailScreen> {
  Customer? _c;
  List<InvoiceSummary> _bills = const [];
  int _billsTotal = 0;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _c = widget.initial;
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final api = AppScope.read(context).api;
    try {
      final r = await Future.wait<Object>([api.customer(widget.customerId), api.invoices(customerId: widget.customerId, limit: 10)]);
      if (!mounted) return;
      final bills = r[1] as Page<InvoiceSummary>;
      setState(() {
        // The detail answer has no list fields (last bill, billed, overdue): keep them from the row.
        final fresh = r[0] as Customer;
        final row = widget.initial;
        _c = row == null
            ? fresh
            : Customer(
                id: fresh.id,
                name: fresh.name,
                phone: fresh.phone,
                email: fresh.email,
                gstin: fresh.gstin,
                address: fresh.address,
                stateCode: fresh.stateCode,
                openingBalance: fresh.openingBalance,
                creditLimit: fresh.creditLimit,
                outstanding: fresh.outstanding,
                advance: fresh.advance,
                createdAt: fresh.createdAt,
                lastBillDate: row.lastBillDate,
                totalBilled: row.totalBilled,
                overdue: row.overdue,
              );
        _bills = bills.items;
        _billsTotal = bills.total ?? bills.items.length;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _open(Uri url) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    if (!await AppScope.read(context).openUrl(url)) messenger.showSnackBar(SnackBar(content: Text(l.couldNotOpen)));
  }

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<Customer>(MaterialPageRoute(builder: (_) => CustomerFormScreen(customer: _c)));
    if (saved != null && mounted) _load();
  }

  Future<void> _receive() async {
    final done = await showReceiveSheet(context, _c!);
    if (done && mounted) _load();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final access = BooksAccess(GateScope.of(context));
    final c = _c;
    return Scaffold(
      appBar: AppBar(
        title: Text(c?.name ?? l.customersTitle),
        actions: [
          if (c != null && access.editCustomers)
            IconButton(key: CustomerDetailScreen.editButton, tooltip: l.customersEdit, icon: const Icon(Icons.edit_outlined), onPressed: _edit),
        ],
      ),
      body: c == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Column(mainAxisSize: MainAxisSize.min, children: [Text(errorText(l, _error)), TextButton(onPressed: _load, child: Text(l.retry))]),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                children: [
                  if (c.phone != null) ...[
                    Text(prettyPhone(c.phone!), style: theme.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Row(children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          key: CustomerDetailScreen.callButton,
                          onPressed: () => _open(Uri(scheme: 'tel', path: c.phone!.replaceAll(RegExp(r'[^0-9+]'), ''))),
                          icon: const Icon(Icons.call_outlined),
                          label: Text(l.customerCall),
                        ),
                      ),
                      if (whatsappNumber(c.phone) != null) ...[
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            key: CustomerDetailScreen.whatsappButton,
                            onPressed: () => _open(Uri.parse('https://wa.me/${whatsappNumber(c.phone)}')),
                            icon: const Icon(Icons.chat_outlined),
                            label: const Text('WhatsApp'),
                          ),
                        ),
                      ],
                    ]),
                  ],
                  if (c.email != null) ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.mail_outline), title: Text(c.email!)),
                  if (c.address != null) ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.place_outlined), title: Text(c.address!)),
                  if (c.gstin != null) Text('GSTIN ${c.gstin}', style: theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace')),
                  const SizedBox(height: 12),
                  _BalanceCard(customer: c, showLimit: access.creditFields),
                  const SizedBox(height: 12),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    if (access.receive)
                      FilledButton.icon(
                        key: CustomerDetailScreen.receiveButton,
                        onPressed: _busy ? null : _receive,
                        icon: const Icon(Icons.account_balance_wallet_outlined),
                        label: Text(l.receivePayment),
                      ),
                    if (access.creditBook)
                      OutlinedButton.icon(
                        key: CustomerDetailScreen.shareButton,
                        onPressed: _busy ? null : () => _run(() => shareStatement(context, c)),
                        icon: const Icon(Icons.share_outlined),
                        label: Text(l.shareStatement),
                      ),
                    if (access.remind && c.outstanding > 0)
                      OutlinedButton.icon(
                        key: CustomerDetailScreen.remindButton,
                        onPressed: _busy ? null : () => _run(() => sendReminder(context, c)),
                        icon: const Icon(Icons.notifications_active_outlined),
                        label: Text(l.sendReminder),
                      ),
                    if (access.creditBook)
                      OutlinedButton.icon(
                        key: CustomerDetailScreen.ledgerButton,
                        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LedgerScreen(customer: c))),
                        icon: const Icon(Icons.menu_book_outlined),
                        label: Text(l.ledgerTitle),
                      ),
                  ]),
                  const Divider(height: 32),
                  Text(l.customerBills, style: theme.textTheme.titleMedium),
                  if (_bills.isEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(l.customerNoBills)),
                  for (final b in _bills)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(b.number ?? l.dashDraft),
                      subtitle: Text(dayLabel(b.date, l.localeName)),
                      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(formatPaise(b.total), style: const TextStyle(fontWeight: FontWeight.w600)),
                        if (b.status == 'cancelled')
                          Text(l.orderStatusCancelled, style: theme.textTheme.bodySmall)
                        else if (b.balance > 0)
                          Text(l.billBalance(formatPaise(b.balance)),
                              style: TextStyle(fontSize: 12, color: b.isOverdue ? theme.colorScheme.error : Colors.orange.shade800))
                        else
                          Text(l.paymentPaid, style: TextStyle(fontSize: 12, color: Colors.green.shade700)),
                      ]),
                    ),
                  if (_billsTotal > _bills.length) Text(l.customerMoreBills(_billsTotal - _bills.length), style: theme.textTheme.bodySmall),
                ],
              ),
            ),
    );
  }
}

/// Balance due / advance / settled, and the credit-limit meter (customer-detail.tsx `BalanceCard`).
class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.customer, required this.showLimit});
  final Customer customer;
  final bool showLimit;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final c = customer;
    final side = balanceSide(c.outstanding);
    final usage = showLimit ? creditUsage(c) : null;
    final color = sideColor(theme.colorScheme, side);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text(switch (side) { BalanceSide.due => l.balanceDue, BalanceSide.advance => l.balanceAdvance, BalanceSide.settled => l.balanceSettled },
                  style: theme.textTheme.labelLarge),
            ),
            SidePill(c.outstanding),
          ]),
          Text(formatPaise(c.outstanding.abs()), key: const Key('customer.balance'), style: theme.textTheme.headlineMedium?.copyWith(color: color, fontWeight: FontWeight.bold)),
          Text(switch (side) {
            BalanceSide.due => l.balanceDueHint(c.name),
            BalanceSide.advance => l.balanceAdvanceHint(c.name),
            BalanceSide.settled => l.balanceSettledHint(c.name),
          }, style: theme.textTheme.bodySmall),
          if (c.overdue > 0) Text(l.overdueAmount(formatPaise(c.overdue)), style: TextStyle(color: theme.colorScheme.error)),
          if (usage != null) ...[
            const SizedBox(height: 12),
            Text('${l.creditLimit}: ${l.creditUsed(formatPaise(usage.used), formatPaise(usage.limit))}', style: theme.textTheme.bodySmall),
            const SizedBox(height: 4),
            LinearProgressIndicator(
              value: usage.fraction,
              color: usage.over ? theme.colorScheme.error : (usage.near ? Colors.orange.shade800 : null),
            ),
            const SizedBox(height: 4),
            Text(
              usage.over ? l.creditOver(formatPaise(usage.overBy)) : l.creditAvailable(formatPaise(usage.available)),
              key: const Key('customer.creditLimit'),
              style: TextStyle(fontSize: 12, color: usage.over ? theme.colorScheme.error : null),
            ),
          ],
        ]),
      ),
    );
  }
}

/// Add or edit a customer (customer-dialog.tsx): name, phone, email, GSTIN, address and, with the credit book, the
/// opening balance (owes / advance) and credit limit. Edits send only the changed fields.
class CustomerFormScreen extends StatefulWidget {
  const CustomerFormScreen({super.key, this.customer});
  final Customer? customer;

  static const nameField = Key('customerForm.name');
  static const phoneField = Key('customerForm.phone');
  static const emailField = Key('customerForm.email');
  static const gstinField = Key('customerForm.gstin');
  static const addressField = Key('customerForm.address');
  static const openingField = Key('customerForm.opening');
  static const limitField = Key('customerForm.limit');
  static const saveButton = Key('customerForm.save');

  @override
  State<CustomerFormScreen> createState() => _CustomerFormScreenState();
}

class _CustomerFormScreenState extends State<CustomerFormScreen> {
  late final _name = TextEditingController(text: widget.customer?.name ?? '');
  late final _phone = TextEditingController(text: widget.customer?.phone ?? '');
  late final _email = TextEditingController(text: widget.customer?.email ?? '');
  late final _gstin = TextEditingController(text: widget.customer?.gstin ?? '');
  late final _address = TextEditingController(text: widget.customer?.address ?? '');
  late final _opening = TextEditingController(
      text: (widget.customer?.openingBalance ?? 0) == 0 ? '' : paiseToInput(widget.customer!.openingBalance.abs()));
  late final _limit = TextEditingController(text: widget.customer?.creditLimit == null ? '' : paiseToInput(widget.customer!.creditLimit!));
  late bool _openingAdvance = (widget.customer?.openingBalance ?? 0) < 0;
  Set<CustomerField> _errors = const {};
  String? _serverError;
  bool _busy = false;

  @override
  void dispose() {
    for (final t in [_name, _phone, _email, _gstin, _address, _opening, _limit]) {
      t.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final l = AppLocalizations.of(context);
    final app = AppScope.read(context);
    final creditFields = BooksAccess(app.gates).creditFields;
    final errors = validateCustomer(
      name: _name.text,
      phone: _phone.text,
      email: _email.text,
      gstin: _gstin.text,
      address: _address.text,
      opening: creditFields ? _opening.text : '',
      creditLimit: creditFields ? _limit.text : '',
    );
    setState(() {
      _errors = errors;
      _serverError = null;
    });
    if (errors.isNotEmpty) return;
    final body = customerBody(
      before: widget.customer,
      name: _name.text,
      phone: _phone.text,
      email: _email.text,
      gstin: _gstin.text,
      address: _address.text,
      opening: _opening.text,
      openingAdvance: _openingAdvance,
      creditLimit: _limit.text,
      creditFields: creditFields,
    );
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    if (body.isEmpty) return navigator.pop(widget.customer);
    setState(() => _busy = true);
    try {
      final saved = await app.booksActions().saveCustomer(widget.customer?.id, body);
      messenger.showSnackBar(SnackBar(content: Text(widget.customer == null ? l.customerCreated(saved.name) : l.customerUpdated)));
      navigator.pop(saved);
    } on ApiException catch (e) {
      if (mounted) setState(() => _serverError = errorText(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final creditFields = BooksAccess(GateScope.of(context)).creditFields;
    String? err(CustomerField f, String text) => _errors.contains(f) ? text : null;
    final money = [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))];
    return Scaffold(
      appBar: AppBar(title: Text(widget.customer == null ? l.customersAdd : l.customersEdit)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(l.customerFormHint, style: theme.textTheme.bodySmall),
          TextField(
            key: CustomerFormScreen.nameField,
            controller: _name,
            autofocus: widget.customer == null,
            maxLength: 120,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(labelText: l.customerName, errorText: err(CustomerField.name, l.requiredField)),
          ),
          TextField(
            key: CustomerFormScreen.phoneField,
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(labelText: l.customerPhone, errorText: err(CustomerField.phone, l.phoneInvalid)),
          ),
          TextField(
            key: CustomerFormScreen.emailField,
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(labelText: l.customerEmail, errorText: err(CustomerField.email, l.emailInvalid)),
          ),
          TextField(
            key: CustomerFormScreen.gstinField,
            controller: _gstin,
            maxLength: 15,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(labelText: 'GSTIN', hintText: '33ABCDE1234F1Z5', errorText: err(CustomerField.gstin, l.gstinInvalid)),
          ),
          TextField(
            key: CustomerFormScreen.addressField,
            controller: _address,
            maxLines: 2,
            maxLength: 300,
            decoration: InputDecoration(labelText: l.customerAddress, errorText: err(CustomerField.address, l.tooLong)),
          ),
          if (creditFields) ...[
            const SizedBox(height: 8),
            Text(l.creditBookTitle, style: theme.textTheme.titleSmall),
            TextField(
              key: CustomerFormScreen.openingField,
              controller: _opening,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: money,
              decoration: InputDecoration(
                labelText: l.openingBalance,
                prefixText: '₹',
                helperText: l.openingBalanceHint,
                errorText: err(CustomerField.opening, l.amountInvalid),
              ),
            ),
            const SizedBox(height: 8),
            SegmentedButton<bool>(
              segments: [
                ButtonSegment(value: false, label: Text(l.openingOwes)),
                ButtonSegment(value: true, label: Text(l.openingAdvance)),
              ],
              selected: {_openingAdvance},
              onSelectionChanged: (v) => setState(() => _openingAdvance = v.first),
            ),
            TextField(
              key: CustomerFormScreen.limitField,
              controller: _limit,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: money,
              decoration: InputDecoration(
                labelText: l.creditLimit,
                prefixText: '₹',
                helperText: l.creditLimitHint,
                helperMaxLines: 2,
                errorText: err(CustomerField.creditLimit, l.amountInvalid),
              ),
            ),
          ],
          if (_serverError != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_serverError!, style: TextStyle(color: theme.colorScheme.error))),
          const SizedBox(height: 16),
          FilledButton(key: CustomerFormScreen.saveButton, onPressed: _busy ? null : _save, child: Text(l.save)),
        ],
      ),
    );
  }
}
