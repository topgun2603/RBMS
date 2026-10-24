import 'dart:convert';

import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

/// Customer, credit-book and expense writes, each with one Idempotency-Key per user action (kept for the shop, so a
/// retry after a dropped answer reuses it and the server does the write once). A replayed answer is success.
class BooksActions {
  BooksActions(this.api, SessionStore session) : keys = ActionKeys(session);
  final SrikitApi api;
  final ActionKeys keys;

  /// New customer ([id] null) or the changed fields of one.
  Future<Customer> saveCustomer(String? id, Map<String, Object?> body) async => (await keys.once(
        'customer.save:${id ?? 'new'}:${jsonEncode(body)}',
        (k) => id == null ? api.addCustomer(body, idempotencyKey: k) : api.updateCustomer(id, body, idempotencyKey: k),
      ))
          .value;

  /// Money received on account. The balance before is part of the action: the same receipt typed again after the
  /// first one went through is a new receipt, a retry of a failed one is not.
  Future<ReceiptResult> receive(
    Customer c, {
    required int amount,
    required String method,
    required String date,
    String? reference,
    String? note,
  }) async =>
      (await keys.once(
        'receipt:${c.id}:${c.outstanding}:$amount:$method:$date:${reference ?? ''}:${note ?? ''}',
        (k) => api.receivePayment(c.id, amount: amount, method: method, date: date, reference: reference, note: note, idempotencyKey: k),
      ))
          .value;

  Future<ShareLink> shareStatement(String customerId) async =>
      (await keys.once('statement.share:$customerId', (k) => api.shareStatement(customerId, idempotencyKey: k))).value;

  Future<RemindResult> remind(Customer c, {String? locale}) async => (await keys.once(
        'remind:${c.id}:${c.outstanding}',
        (k) => api.remindCustomer(c.id, locale: locale, idempotencyKey: k),
      ))
          .value;

  /// New expense ([id] null) or the changed fields of one.
  Future<Expense> saveExpense(String? id, ExpenseInput input) async => (await keys.once(
        'expense.save:${id ?? 'new'}:${jsonEncode(input.toJson())}',
        (k) => id == null ? api.createExpense(input, idempotencyKey: k) : api.updateExpense(id, input, idempotencyKey: k),
      ))
          .value;

  Future<Expense> cancelExpense(String id) async =>
      (await keys.once('expense.cancel:$id', (k) => api.cancelExpense(id, idempotencyKey: k))).value;

  Future<ExpenseCategory> addCategory(String name) async =>
      (await keys.once('expense.category.add:${name.trim()}', (k) => api.createExpenseCategory(name, idempotencyKey: k))).value;

  Future<ExpenseCategory> renameCategory(String id, String name) async => (await keys.once(
      'expense.category.rename:$id:${name.trim()}', (k) => api.renameExpenseCategory(id, name, idempotencyKey: k)))
      .value;

  Future<void> deleteCategory(String id) =>
      keys.once('expense.category.delete:$id', (k) => api.deleteExpenseCategory(id, idempotencyKey: k));
}
