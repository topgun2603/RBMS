import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/orders/order_rules.dart';
import 'package:srikit_kit/srikit_kit.dart';

Order order(String status, {int balance = 1000, String method = 'cod', List<Map<String, Object?>> events = const []}) => Order.fromJson({
      'id': 'o1',
      'number': 'ORD/1',
      'status': status,
      'paymentMethod': method,
      'customer': {'name': 'A'},
      'totals': {},
      'total': 1000,
      'paid': 1000 - balance,
      'balance': balance,
      'events': events,
    });

void main() {
  group('transitions (packages/orders logic.ts)', () {
    test('forward steps may be skipped; cancel only before shipping; nothing after the end', () {
      expect(allowedTransitions('placed'), ['confirmed', 'packed', 'shipped', 'delivered', 'cancelled']);
      expect(allowedTransitions('confirmed'), ['packed', 'shipped', 'delivered', 'cancelled']);
      expect(allowedTransitions('packed'), ['shipped', 'delivered', 'cancelled']);
      expect(allowedTransitions('shipped'), ['delivered']); // no cancel once shipped
      expect(allowedTransitions('delivered'), isEmpty);
      expect(allowedTransitions('delivered', returnsEnabled: true), ['returned']);
      expect(allowedTransitions('cancelled'), isEmpty);
      expect(allowedTransitions('returned'), isEmpty);
    });

    test('the primary button is the next flow step, if allowed', () {
      expect(nextStep('placed', allowedTransitions('placed')), 'confirmed');
      expect(nextStep('packed', allowedTransitions('packed')), 'shipped');
      expect(nextStep('shipped', allowedTransitions('shipped')), 'delivered');
      expect(nextStep('delivered', const ['returned']), isNull);
      expect(nextStep('placed', const ['cancelled']), isNull); // server says only cancel
      expect(skipAhead('placed', allowedTransitions('placed')), ['packed', 'shipped', 'delivered']);
    });

    test('ship, cancel and return open a dialog first', () {
      expect(needsDialog('shipped'), isTrue);
      expect(needsDialog('cancelled'), isTrue);
      expect(needsDialog('returned'), isTrue);
      expect(needsDialog('confirmed'), isFalse);
      expect(needsDialog('delivered'), isFalse);
    });
  });

  group('permissions per move (routes.ts)', () {
    test('a packer with orders.ship / orders.deliver but not orders.manage', () {
      const g = Gates(enabled: {'orders'}, roles: ['staff'], permissions: ['orders.ship', 'orders.deliver']);
      expect(canMove(g, 'confirmed'), isFalse);
      expect(canMove(g, 'shipped'), isTrue);
      expect(canMove(g, 'delivered'), isTrue);
      expect(canMove(g, 'cancelled'), isFalse);
      expect(availableMoves(g, 'packed', allowedTransitions('packed')), ['shipped', 'delivered']);
    });

    test('cancel needs orders.cancel even with orders.manage', () {
      const g = Gates(roles: ['staff'], permissions: ['orders.manage']);
      expect(canMove(g, 'cancelled'), isFalse);
      expect(canMove(g, 'confirmed'), isTrue);
      expect(canMove(const Gates(roles: ['owner']), 'cancelled'), isTrue);
      expect(canMove(const Gates(roles: ['staff'], permissions: ['orders.*']), 'cancelled'), isTrue);
    });
  });

  group('payments, invoice, inputs', () {
    const manager = Gates(roles: ['staff'], permissions: ['orders.manage']);

    test('record payment while something is due on a live order', () {
      expect(canRecordPayment(manager, order('confirmed')), isTrue);
      expect(canRecordPayment(manager, order('delivered', balance: 0)), isFalse); // COD collected on delivery
      expect(canRecordPayment(manager, order('cancelled')), isFalse);
      expect(canRecordPayment(manager, order('returned')), isFalse);
      expect(canRecordPayment(const Gates(roles: ['staff'], permissions: ['orders.ship']), order('confirmed')), isFalse);
    });

    test('invoice retry shows only after the automatic invoice failed', () {
      expect(invoiceFailed(order('delivered')), isFalse);
      expect(
        invoiceFailed(order('delivered', events: [
          {'id': 'e', 'type': 'note', 'data': {'kind': 'effect_failed', 'effect': 'invoice.create', 'error': 'x'}},
        ])),
        isTrue,
      );
    });

    test('tracking link and cancel reason', () {
      expect(validTrackingUrl(''), isTrue);
      expect(validTrackingUrl('https://track.example.in/123'), isTrue);
      expect(validTrackingUrl('track.example.in/123'), isFalse);
      expect(validTrackingUrl('https://nodot'), isFalse);
      expect(validateCancelReason('  '), 'required');
      expect(validateCancelReason('Out of stock'), isNull);
      expect(validateCancelReason('x' * 501), 'tooLong');
    });

    test('payments come from payment events', () {
      final o = order('delivered', balance: 0, events: [
        {'id': 'e1', 'type': 'payment', 'data': {'amount': 1000, 'method': 'cod', 'source': 'cod', 'date': '2026-10-21'}},
        {'id': 'e2', 'type': 'note', 'message': 'hi', 'data': {}},
      ]);
      expect(o.payments.single.amount, 1000);
      expect(o.payments.single.source, 'cod');
      expect(o.isCod, isTrue);
    });
  });
}
