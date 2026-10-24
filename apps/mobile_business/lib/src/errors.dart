import 'package:srikit_api/srikit_api.dart';

import '../l10n/app_localizations.dart';

/// Text to show for an error: our own words for transport failures, the API's message (already in the request
/// language where the API translates) for everything else.
String errorText(AppLocalizations l, Object? error) {
  if (error is ApiException) {
    return switch (error.code) {
      ApiException.networkCode => l.errorNetwork,
      ApiException.timeoutCode => l.errorTimeout,
      ApiException.badResponseCode => l.errorGeneric,
      _ => error.message.isNotEmpty && error.status < 500 ? error.message : l.errorGeneric,
    };
  }
  return l.errorGeneric;
}

/// Display label of a membership role (`role:<key>` custom roles show their key).
String roleLabel(AppLocalizations l, String role) => switch (role) {
      'owner' => l.roleOwner,
      'admin' => l.roleAdmin,
      'staff' => l.roleStaff,
      'member' => l.roleMember,
      _ => role.startsWith('role:') ? role.substring(5) : role,
    };

/// `+919876543210` → `+91 98765 43210`.
String prettyPhone(String phone) {
  final m = RegExp(r'^\+91(\d{5})(\d{5})$').firstMatch(phone);
  return m == null ? phone : '+91 ${m.group(1)} ${m.group(2)}';
}
