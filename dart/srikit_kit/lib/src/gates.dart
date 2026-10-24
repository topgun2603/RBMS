import 'package:flutter/widgets.dart';

/// Does the granted pattern cover [key]? Mirrors `permissionMatches` in packages/core/src/permissions.ts:
/// `*` matches everything; a `*` segment matches one segment, except last where it matches one or more; `module.*`
/// also matches the bare `module`.
bool permissionMatches(String granted, String key) {
  if (granted == '*' || granted == key) return true;
  if (!granted.contains('*')) return false;
  final g = granted.split('.');
  final k = key.split('.');
  for (var i = 0; i < g.length; i++) {
    final seg = g[i];
    final last = i == g.length - 1;
    if (seg == '*' && last) return k.length >= i;
    if (i >= k.length) return false;
    if (seg != '*' && seg != k[i]) return false;
  }
  return g.length == k.length;
}

/// Base levels that hold every permission in their shop (`FULL_ACCESS_ROLES`).
const fullAccessRoles = {'owner', 'admin'};

/// What the user may see in the current shop: enabled feature keys (GET /v1/features `enabled`) and permissions
/// (GET /v1/auth/me with `x-tenant`). The server enforces the same rules; gates only hide what would fail.
@immutable
class Gates {
  const Gates({this.enabled = const {}, this.roles = const [], this.permissions = const []});

  /// No shop: nothing is on.
  static const none = Gates();

  final Set<String> enabled;
  final List<String> roles;
  final List<String> permissions;

  bool get fullAccess => roles.any(fullAccessRoles.contains);

  /// The user holds one of [any] base roles in the shop (e.g. staff-only API routes need owner, admin or staff).
  bool hasRole(Iterable<String> any) => roles.any(any.contains);

  /// The feature is on for the shop.
  bool feature(String key) => enabled.contains(key);

  /// The user holds the permission (owners and admins hold all).
  bool can(String permission) => fullAccess || permissions.any((g) => permissionMatches(g, permission));

  /// Every listed feature is on and every listed permission is held.
  bool allows({Iterable<String> features = const [], Iterable<String> permissions = const []}) =>
      features.every(feature) && permissions.every(can);
}

/// Provides [Gates] to the widget tree (set by the app when a shop is opened).
class GateScope extends InheritedWidget {
  const GateScope({super.key, required this.gates, required super.child});
  final Gates gates;

  static Gates of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<GateScope>()?.gates ?? Gates.none;

  @override
  bool updateShouldNotify(GateScope oldWidget) =>
      oldWidget.gates.enabled.length != gates.enabled.length ||
      !oldWidget.gates.enabled.containsAll(gates.enabled) ||
      oldWidget.gates.roles.join(',') != gates.roles.join(',') ||
      oldWidget.gates.permissions.join(',') != gates.permissions.join(',');
}

/// Shows [child] only when the shop has every [features] key and the user every [permissions] key; otherwise
/// [fallback] (nothing by default).
class Gate extends StatelessWidget {
  const Gate({super.key, this.features = const [], this.permissions = const [], required this.child, this.fallback});

  /// Shorthand for one feature.
  Gate.feature(String feature, {super.key, required this.child, this.fallback})
      : features = [feature],
        permissions = const [];

  final List<String> features;
  final List<String> permissions;
  final Widget child;
  final Widget? fallback;

  @override
  Widget build(BuildContext context) {
    final gates = GateScope.of(context);
    final ok = gates.allows(features: features, permissions: permissions);
    return ok ? child : (fallback ?? const SizedBox.shrink());
  }
}
