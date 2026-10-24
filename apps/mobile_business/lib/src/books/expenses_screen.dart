import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../counter/tender.dart';
import '../errors.dart';
import 'books_rules.dart';
import 'books_text.dart';

enum ExpensePeriod { thisMonth, lastMonth, custom }

/// More → Expenses (expenses.tsx; feature `expenses`, permission `expenses.manage`): a period (this month by default)
/// and category filter, the period's summary (spent, GST, entries, by category), the list with cancelled ones struck
/// through (the web lists recorded and cancelled), add / edit / cancel, and categories.
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key, this.today});

  /// For tests: "today" in IST.
  final String? today;

  static const addButton = Key('expenses.add');
  static const categoriesButton = Key('expenses.categories');
  static const categoryFilter = Key('expenses.categoryFilter');

  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> {
  static const _pageSize = 50;
  final _scroll = ScrollController();
  ExpensePeriod _period = ExpensePeriod.thisMonth;
  late DateRange _range = thisMonth(widget.today);
  String? _categoryId;
  List<ExpenseCategory> _categories = const [];
  ExpenseSummary? _summary;
  ExpensePage? _page;
  List<Expense> _items = const [];
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _more();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadCategories();
      _reload();
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  SrikitApi get _api => AppScope.read(context).api;

  Future<void> _loadCategories() async {
    try {
      final c = await _api.expenseCategories();
      if (mounted) setState(() => _categories = c);
    } catch (_) {}
  }

  Future<ExpensePage> _fetch(int offset) => _api.expenses(
        from: _range.from,
        to: _range.to,
        categoryIds: _categoryId == null ? null : [_categoryId!],
        statuses: const ['all'],
        limit: _pageSize,
        offset: offset,
      );

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await Future.wait<Object>([_fetch(0), _api.expenseSummary(from: _range.from, to: _range.to)]);
      if (!mounted) return;
      setState(() {
        _page = r[0] as ExpensePage;
        _items = _page!.items;
        _summary = r[1] as ExpenseSummary;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _more() async {
    final p = _page;
    if (_loading || p == null || _items.length >= p.total) return;
    setState(() => _loading = true);
    try {
      final next = await _fetch(_items.length);
      if (mounted) setState(() => _items = [..._items, ...next.items]);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pick(ExpensePeriod p) async {
    DateRange? range = switch (p) {
      ExpensePeriod.thisMonth => thisMonth(widget.today),
      ExpensePeriod.lastMonth => lastMonth(widget.today),
      ExpensePeriod.custom => null,
    };
    if (range == null) {
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(2000),
        lastDate: DateTime.parse(widget.today ?? todayIst()),
        initialDateRange: DateTimeRange(start: DateTime.parse(_range.from), end: DateTime.parse(_range.to)),
      );
      if (picked == null) return;
      range = (from: isoDate(picked.start), to: isoDate(picked.end));
    }
    setState(() {
      _period = p;
      _range = range!;
    });
    _reload();
  }

  Future<void> _open([Expense? e]) async {
    if (_categories.isEmpty) await _loadCategories();
    if (!mounted) return;
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => ExpenseFormScreen(expense: e, categories: _categories, today: widget.today)),
    );
    if (changed == true && mounted) _reload();
  }

  String _catLabel(AppLocalizations l, String id, String name) {
    final c = _categories.where((x) => x.id == id).firstOrNull;
    return categoryName(l, c?.name ?? name, builtin: c?.builtin ?? true);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final s = _summary;
    final p = _page;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.expensesTitle),
        actions: [
          IconButton(
            key: ExpensesScreen.categoriesButton,
            tooltip: l.expenseCategories,
            icon: const Icon(Icons.folder_outlined),
            onPressed: () async {
              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ExpenseCategoriesScreen()));
              if (mounted) {
                _loadCategories();
                _reload();
              }
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: ExpensesScreen.addButton,
        onPressed: () => _open(),
        icon: const Icon(Icons.add),
        label: Text(l.expenseAdd),
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 88),
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Row(children: [
                for (final pp in ExpensePeriod.values)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      key: Key('expenses.period.${pp.name}'),
                      label: Text(switch (pp) {
                        ExpensePeriod.thisMonth => l.periodThisMonth,
                        ExpensePeriod.lastMonth => l.periodLastMonth,
                        ExpensePeriod.custom => l.periodCustom,
                      }),
                      selected: _period == pp,
                      onSelected: (_) => _pick(pp),
                    ),
                  ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: DropdownButton<String?>(
                key: ExpensesScreen.categoryFilter,
                isExpanded: true,
                value: _categoryId,
                items: [
                  DropdownMenuItem(value: null, child: Text(l.allCategories)),
                  for (final c in _categories) DropdownMenuItem(value: c.id, child: Text(categoryName(l, c.name, builtin: c.builtin))),
                ],
                onChanged: (v) {
                  setState(() => _categoryId = v);
                  _reload();
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(l.summaryFor(dayLabel(_range.from, l.localeName), dayLabel(_range.to, l.localeName)), style: theme.textTheme.bodySmall),
            ),
            if (s != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
                child: Row(children: [
                  _Tile(label: l.expensesSpent, value: formatPaise(s.total, decimals: false), valueKey: const Key('expenses.spent')),
                  _Tile(label: l.expensesGst, value: formatPaise(s.gst, decimals: false)),
                  _Tile(label: l.expensesEntries, value: '${s.count}', valueKey: const Key('expenses.count')),
                ]),
              ),
            if (s != null && s.byCategory.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(l.expensesByCategory, style: theme.textTheme.titleSmall),
                  for (final c in s.byCategory.take(5))
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(_catLabel(l, c.categoryId, c.name))),
                          Text(formatPaise(c.total), key: Key('expenses.byCategory.${c.categoryId}')),
                        ]),
                        LinearProgressIndicator(value: s.total == 0 ? 0 : c.total / s.total, minHeight: 4),
                      ]),
                    ),
                ]),
              ),
            if (_loading) const LinearProgressIndicator(minHeight: 2),
            if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(errorText(l, _error), style: TextStyle(color: theme.colorScheme.error))),
            if (p != null && p.total > 0)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Text(l.expensesListTotals(p.total, formatPaise(p.totals.amount), formatPaise(p.totals.gst)), style: theme.textTheme.bodySmall),
              ),
            if (p != null && _items.isEmpty)
              Padding(padding: const EdgeInsets.all(32), child: Text(l.expensesEmpty, textAlign: TextAlign.center)),
            for (final (i, e) in _items.indexed) ...[
              ListTile(
                key: Key('expenses.row.$i'),
                title: Text(e.vendorName ?? _catLabel(l, e.categoryId, e.categoryName)),
                subtitle: Text([
                  dayLabel(e.date, l.localeName),
                  _catLabel(l, e.categoryId, e.categoryName),
                  methodLabel(l, e.paymentMethod),
                  if (e.note != null) e.note!,
                ].join(' · '), maxLines: 2, overflow: TextOverflow.ellipsis),
                trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text(formatPaise(e.amount),
                      style: e.cancelled
                          ? TextStyle(decoration: TextDecoration.lineThrough, color: theme.colorScheme.outline)
                          : const TextStyle(fontWeight: FontWeight.w600)),
                  if (e.cancelled) Text(l.expenseCancelledBadge, style: theme.textTheme.bodySmall),
                ]),
                onTap: () => _open(e),
              ),
              const Divider(height: 1),
            ],
          ],
        ),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.label, required this.value, this.valueKey});
  final String label;
  final String value;
  final Key? valueKey;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Card(
        margin: const EdgeInsets.only(right: 6),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: theme.textTheme.bodySmall),
            Text(value, key: valueKey, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          ]),
        ),
      ),
    );
  }
}

/// Add or edit an expense (expense-dialog.tsx, the fields that matter on a phone): amount incl. GST, date (IST, not
/// after today), category, paid by, note, reference. A cancelled expense is read-only; a recorded one can be
/// cancelled. Pops true when something changed.
class ExpenseFormScreen extends StatefulWidget {
  const ExpenseFormScreen({super.key, this.expense, required this.categories, this.today});
  final Expense? expense;
  final List<ExpenseCategory> categories;
  final String? today;

  static const amountField = Key('expenseForm.amount');
  static const noteField = Key('expenseForm.note');
  static const referenceField = Key('expenseForm.reference');
  static const categoryField = Key('expenseForm.category');
  static const dateButton = Key('expenseForm.date');
  static const saveButton = Key('expenseForm.save');
  static const cancelExpenseButton = Key('expenseForm.cancelExpense');

  @override
  State<ExpenseFormScreen> createState() => _ExpenseFormScreenState();
}

class _ExpenseFormScreenState extends State<ExpenseFormScreen> {
  late final _amount = TextEditingController(text: widget.expense == null ? '' : paiseToInput(widget.expense!.amount));
  late final _note = TextEditingController(text: widget.expense?.note ?? '');
  late final _reference = TextEditingController(text: widget.expense?.reference ?? '');
  late String _date = widget.expense?.date ?? widget.today ?? todayIst();
  late String? _categoryId = widget.expense?.categoryId ?? defaultExpenseCategory(widget.categories);
  late String _method = widget.expense?.paymentMethod ?? 'cash';
  bool _busy = false;
  String? _error;

  bool get _readOnly => widget.expense?.cancelled ?? false;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    _reference.dispose();
    super.dispose();
  }

  String _message(AppLocalizations l, ExpenseError e) => switch (e) {
        ExpenseError.amount => l.amountRequired,
        ExpenseError.amountTooLarge => l.amountInvalid,
        ExpenseError.date || ExpenseError.dateInFuture => l.dateNotFuture,
        ExpenseError.category => l.expensePickCategory,
        ExpenseError.noteTooLong || ExpenseError.referenceTooLong => l.tooLong,
      };

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.parse(_date),
      firstDate: DateTime(2000),
      lastDate: DateTime.parse(widget.today ?? todayIst()),
    );
    if (picked != null) setState(() => _date = isoDate(picked));
  }

  Future<void> _save() async {
    final l = AppLocalizations.of(context);
    final err = validateExpense(
      amount: _amount.text,
      date: _date,
      categoryId: _categoryId,
      note: _note.text,
      reference: _reference.text,
      today: widget.today,
    );
    if (err != null) return setState(() => _error = _message(l, err));
    final input = expenseInput(
      before: widget.expense,
      amount: parseRupees(_amount.text)!,
      date: _date,
      categoryId: _categoryId!,
      paymentMethod: _method,
      note: _note.text,
      reference: _reference.text,
    );
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    if (input.toJson().isEmpty) return navigator.pop(false);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final saved = await AppScope.read(context).booksActions().saveExpense(widget.expense?.id, input);
      messenger.showSnackBar(SnackBar(content: Text(widget.expense == null ? l.expenseCreated(formatPaise(saved.amount)) : l.expenseUpdated)));
      navigator.pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancelExpense() async {
    final l = AppLocalizations.of(context);
    final app = AppScope.read(context);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.expenseCancelTitle),
        content: Text(l.expenseCancelBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.keepIt)),
          FilledButton(key: const Key('expenseForm.confirmCancel'), onPressed: () => Navigator.pop(ctx, true), child: Text(l.expenseCancel)),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await app.booksActions().cancelExpense(widget.expense!.id);
      messenger.showSnackBar(SnackBar(content: Text(l.expenseCancelled)));
      navigator.pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final e = widget.expense;
    final cats = widget.categories;
    final readOnly = _readOnly;
    return Scaffold(
      appBar: AppBar(title: Text(e == null ? l.expenseAdd : l.expenseTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(readOnly ? l.expenseCancelledHint : l.expenseAmountHint, style: theme.textTheme.bodySmall),
          TextField(
            key: ExpenseFormScreen.amountField,
            controller: _amount,
            enabled: !readOnly,
            autofocus: e == null,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
            style: theme.textTheme.titleLarge,
            decoration: InputDecoration(labelText: l.expenseAmount, prefixText: '₹'),
          ),
          ListTile(
            key: ExpenseFormScreen.dateButton,
            contentPadding: EdgeInsets.zero,
            enabled: !readOnly,
            leading: const Icon(Icons.event_outlined),
            title: Text(l.dateLabel),
            trailing: Text(dayLabel(_date, l.localeName, year: true)),
            onTap: _pickDate,
          ),
          DropdownButtonFormField<String>(
            key: ExpenseFormScreen.categoryField,
            initialValue: cats.any((c) => c.id == _categoryId) ? _categoryId : null,
            isExpanded: true,
            decoration: InputDecoration(labelText: l.expenseCategory),
            items: [for (final c in cats) DropdownMenuItem(value: c.id, child: Text(categoryName(l, c.name, builtin: c.builtin)))],
            onChanged: readOnly ? null : (v) => setState(() => _categoryId = v),
          ),
          const SizedBox(height: 12),
          Text(l.expensePaidBy, style: theme.textTheme.labelLarge),
          Wrap(spacing: 6, children: [
            for (final m in paymentMethods)
              ChoiceChip(
                key: Key('expenseForm.method.$m'),
                label: Text(methodLabel(l, m)),
                selected: _method == m,
                onSelected: readOnly ? null : (_) => setState(() => _method = m),
              ),
          ]),
          TextField(
            key: ExpenseFormScreen.noteField,
            controller: _note,
            enabled: !readOnly,
            maxLength: 1000,
            maxLines: 2,
            decoration: InputDecoration(labelText: l.noteOptional, hintText: l.expenseNoteHint),
          ),
          TextField(
            key: ExpenseFormScreen.referenceField,
            controller: _reference,
            enabled: !readOnly,
            maxLength: 100,
            decoration: InputDecoration(labelText: l.referenceOptional, hintText: l.expenseReferenceHint),
          ),
          if (e != null && e.gstAmount > 0)
            Text(l.expenseGstInside(formatPaise(e.gstAmount), formatPaise(e.itc)), style: theme.textTheme.bodySmall),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
          const SizedBox(height: 16),
          if (!readOnly) FilledButton(key: ExpenseFormScreen.saveButton, onPressed: _busy ? null : _save, child: Text(l.save)),
          if (e != null && !readOnly) ...[
            const SizedBox(height: 8),
            TextButton.icon(
              key: ExpenseFormScreen.cancelExpenseButton,
              onPressed: _busy ? null : _cancelExpense,
              icon: Icon(Icons.block, color: theme.colorScheme.error),
              label: Text(l.expenseCancel, style: TextStyle(color: theme.colorScheme.error)),
            ),
          ],
        ],
      ),
    );
  }
}

/// Expense categories (categories-dialog.tsx): add, rename, delete (built-ins can be renamed, not deleted; a category
/// with expenses can't be deleted: the server's 409 message is shown).
class ExpenseCategoriesScreen extends StatefulWidget {
  const ExpenseCategoriesScreen({super.key});

  static const nameField = Key('categories.name');
  static const addButton = Key('categories.add');

  @override
  State<ExpenseCategoriesScreen> createState() => _ExpenseCategoriesScreenState();
}

class _ExpenseCategoriesScreenState extends State<ExpenseCategoriesScreen> {
  final _name = TextEditingController();
  List<ExpenseCategory>? _cats;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final c = await AppScope.read(context).api.expenseCategories();
      if (mounted) setState(() => _cats = c);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _write(Future<void> Function() run) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await run();
      await _load();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorText(l, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add() async {
    final name = _name.text.trim();
    if (name.isEmpty || name.length > 60) return;
    final actions = AppScope.read(context).booksActions();
    await _write(() async {
      await actions.addCategory(name);
      _name.clear();
    });
  }

  Future<void> _rename(ExpenseCategory c) async {
    final l = AppLocalizations.of(context);
    final actions = AppScope.read(context).booksActions();
    final ctrl = TextEditingController(text: categoryName(l, c.name, builtin: c.builtin));
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.categoryRename),
        content: TextField(key: const Key('categories.renameField'), controller: ctrl, autofocus: true, maxLength: 60),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l.cancel)),
          FilledButton(key: const Key('categories.renameSave'), onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: Text(l.save)),
        ],
      ),
    );
    ctrl.dispose();
    if (name == null || name.isEmpty || name == c.name) return;
    await _write(() => actions.renameCategory(c.id, name));
  }

  Future<void> _delete(ExpenseCategory c) async {
    final l = AppLocalizations.of(context);
    final actions = AppScope.read(context).booksActions();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.categoryDeleteTitle(categoryName(l, c.name, builtin: c.builtin))),
        content: Text(l.categoryDeleteBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.cancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.delete)),
        ],
      ),
    );
    if (ok == true) await _write(() => actions.deleteCategory(c.id));
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final cats = _cats;
    return Scaffold(
      appBar: AppBar(title: Text(l.expenseCategories)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(l.categoriesHint, style: Theme.of(context).textTheme.bodySmall),
          Row(children: [
            Expanded(
              child: TextField(
                key: ExpenseCategoriesScreen.nameField,
                controller: _name,
                maxLength: 60,
                decoration: InputDecoration(labelText: l.categoryNew),
                onSubmitted: (_) => _add(),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(key: ExpenseCategoriesScreen.addButton, onPressed: _busy ? null : _add, child: Text(l.categoryAdd)),
          ]),
          if (_error != null) Text(errorText(l, _error)),
          if (cats == null && _error == null) const Center(child: CircularProgressIndicator()),
          for (final c in cats ?? const <ExpenseCategory>[])
            ListTile(
              key: Key('categories.row.${c.id}'),
              contentPadding: EdgeInsets.zero,
              title: Text(categoryName(l, c.name, builtin: c.builtin)),
              leading: c.builtin ? Icon(Icons.lock_outline, size: 18, semanticLabel: l.categoryBuiltin) : const SizedBox(width: 18),
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                IconButton(key: Key('categories.rename.${c.id}'), tooltip: l.categoryRename, icon: const Icon(Icons.edit_outlined), onPressed: _busy ? null : () => _rename(c)),
                IconButton(
                  key: Key('categories.delete.${c.id}'),
                  tooltip: l.delete,
                  icon: const Icon(Icons.delete_outline),
                  onPressed: c.builtin || _busy ? null : () => _delete(c),
                ),
              ]),
            ),
        ],
      ),
    );
  }
}
