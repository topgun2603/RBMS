import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../errors.dart';
import 'counter_controller.dart';

/// Who the bill is for (customer-bar.tsx): no customer, a walk-in (name + mobile printed on the bill), or a saved
/// customer found by mobile / name (search from 3 characters, 200 ms debounce) or quick-added.
Future<void> showCustomerSheet(BuildContext context, CounterController c) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CustomerSheet(controller: c),
    );

class _CustomerSheet extends StatefulWidget {
  const _CustomerSheet({required this.controller});
  final CounterController controller;

  @override
  State<_CustomerSheet> createState() => _CustomerSheetState();
}

class _CustomerSheetState extends State<_CustomerSheet> {
  final _query = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  Timer? _debounce;
  List<Customer> _found = const [];
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final c = widget.controller.customer;
    if (c.kind == CustomerKind.walkIn) {
      _name.text = c.name ?? '';
      _phone.text = c.phone?.replaceFirst('+91', '') ?? '';
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  void _onQuery(String q) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 200), () async {
      try {
        final r = await widget.controller.searchCustomers(q);
        if (mounted) setState(() => _found = r);
      } on ApiException catch (e) {
        if (mounted) setState(() => _error = errorText(AppLocalizations.of(context), e));
      }
    });
  }

  /// The typed mobile in E.164, null when empty; false when it isn't a valid mobile.
  Object? _phoneValue() {
    final t = _phone.text.trim();
    if (t.isEmpty) return null;
    return normalizePhone(t) ?? false;
  }

  void _walkIn() {
    final l = AppLocalizations.of(context);
    final phone = _phoneValue();
    if (phone == false) {
      setState(() => _error = l.phoneInvalid);
      return;
    }
    widget.controller.setCustomer(CounterCustomer.walkIn(name: _name.text.trim(), phone: phone as String?));
    Navigator.pop(context);
  }

  Future<void> _create() async {
    final l = AppLocalizations.of(context);
    if (_name.text.trim().isEmpty) {
      setState(() => _error = l.customerNameRequired);
      return;
    }
    final phone = _phoneValue();
    if (phone == false) {
      setState(() => _error = l.phoneInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.controller.createCustomer(_name.text, phone as String?);
      if (mounted) Navigator.pop(context);
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
    final c = widget.controller;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(l.customerTitle, style: theme.textTheme.titleMedium),
                const Spacer(),
                if (c.customer.kind != CustomerKind.none)
                  TextButton(
                    onPressed: () {
                      c.setCustomer(const CounterCustomer.none());
                      Navigator.pop(context);
                    },
                    child: Text(l.customerClear),
                  ),
              ],
            ),
            TextField(
              key: const Key('customer.search'),
              controller: _query,
              onChanged: _onQuery,
              keyboardType: TextInputType.text,
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.customerSearch),
            ),
            for (final cu in _found)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(cu.name),
                subtitle: Text([if (cu.phone != null) cu.phone!, if (cu.outstanding > 0) l.customerOwes(formatPaise(cu.outstanding))].join(' · ')),
                onTap: () {
                  c.setCustomer(CounterCustomer.saved(cu));
                  Navigator.pop(context);
                },
              ),
            const Divider(height: 32),
            TextField(
              key: const Key('customer.name'),
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(labelText: l.customerName),
            ),
            const SizedBox(height: 8),
            TextField(
              key: const Key('customer.phone'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')), LengthLimitingTextInputFormatter(16)],
              decoration: InputDecoration(labelText: l.customerPhoneOptional, prefixText: '+91 '),
            ),
            if (_error != null)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(key: const Key('customer.walkIn'), onPressed: _busy ? null : _walkIn, child: Text(l.customerUseWalkIn)),
                ),
                if (c.canCreateCustomer) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(key: const Key('customer.create'), onPressed: _busy ? null : _create, child: Text(l.customerAdd)),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
