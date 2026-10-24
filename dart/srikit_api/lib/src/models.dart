// Response models. Each mirrors a TypeScript type in the API; the source is named on every class.
// Money fields are paise (int). Unknown fields are ignored, missing optional ones become null.

typedef Json = Map<String, dynamic>;

Json _map(Object? v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
List<Json> _list(Object? v) => v is List ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() : const [];
List<String> _strings(Object? v) => v is List ? v.whereType<String>().toList() : const [];
int _int(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? 0 : 0);
String? _str(Object? v) => v is String ? v : null;
DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;

/// `{ items, total?, limit?, offset?, facets? }`. `total` is null for lists that don't page (e.g. `/tenancy/mine`).
class Page<T> {
  const Page(this.items, {this.total, this.limit, this.offset, this.facets});
  final List<T> items;
  final int? total;
  final int? limit;
  final int? offset;

  /// Filter counts of list endpoints (raw; not used by the app yet).
  final Json? facets;

  static Page<T> fromJson<T>(Object? json, T Function(Json) item) {
    final m = _map(json);
    int? n(Object? v) => v is num ? v.toInt() : null;
    return Page(
      _list(m['items']).map(item).toList(),
      total: n(m['total']),
      limit: n(m['limit']),
      offset: n(m['offset']),
      facets: m['facets'] is Map ? _map(m['facets']) : null,
    );
  }
}

/// packages/auth/src/service.ts `AuthClientConfig` (GET /v1/auth/config).
class AuthClientConfig {
  const AuthClientConfig({required this.phoneMethod, this.firebaseProjectId, required this.smsOtp, required this.google, this.testTargets});

  /// `firebase` or `otp`.
  final String phoneMethod;
  final String? firebaseProjectId;

  /// SMS codes from `/otp/request` are allowed.
  final bool smsOtp;
  final bool google;

  /// Development only: test-identity patterns (e.g. `+9199990*`) that always use the OTP flow.
  final List<String>? testTargets;

  bool get usesFirebase => phoneMethod == 'firebase';

  /// Whether [target] matches a test pattern (exact, or `*` as a wildcard), mirroring the API's matching.
  bool isTestTarget(String target) => (testTargets ?? const []).any((p) {
        final re = RegExp('^${p.split('*').map(RegExp.escape).join('.*')}\$', caseSensitive: false);
        return re.hasMatch(target);
      });

  factory AuthClientConfig.fromJson(Json j) {
    final phone = _map(j['phone']);
    return AuthClientConfig(
      phoneMethod: _str(phone['method']) ?? 'otp',
      firebaseProjectId: _str(phone['firebaseProjectId']),
      smsOtp: phone['smsOtp'] != false,
      google: j['google'] == true,
      testTargets: j['testTargets'] is List ? _strings(j['testTargets']) : null,
    );
  }
}

/// packages/auth/src/service.ts `AuthUser`.
class AuthUser {
  const AuthUser({
    required this.id,
    this.phone,
    this.email,
    this.name,
    this.avatarUrl,
    required this.locale,
    required this.platformRoles,
    required this.status,
    this.createdAt,
  });

  final String id;
  final String? phone;
  final String? email;
  final String? name;
  final String? avatarUrl;
  final String locale;
  final List<String> platformRoles;

  /// `active`, `disabled` or `deleted`.
  final String status;
  final DateTime? createdAt;

  String get displayName => name ?? phone ?? email ?? '';

  factory AuthUser.fromJson(Json j) => AuthUser(
        id: _str(j['id']) ?? '',
        phone: _str(j['phone']),
        email: _str(j['email']),
        name: _str(j['name']),
        avatarUrl: _str(j['avatarUrl']),
        locale: _str(j['locale']) ?? 'en',
        platformRoles: _strings(j['platformRoles']),
        status: _str(j['status']) ?? 'active',
        createdAt: _date(j['createdAt']),
      );
}

/// Sign-in answer of `/auth/otp/verify`, `/auth/firebase`, `/auth/google`: `{ token, expiresAt, user, isNewUser }`.
class SignInResult {
  const SignInResult({required this.token, this.expiresAt, required this.user, required this.isNewUser});
  final String token;
  final DateTime? expiresAt;
  final AuthUser user;
  final bool isNewUser;

  factory SignInResult.fromJson(Json j) => SignInResult(
        token: _str(j['token']) ?? '',
        expiresAt: _date(j['expiresAt']),
        user: AuthUser.fromJson(_map(j['user'])),
        isNewUser: j['isNewUser'] == true,
      );
}

/// GET /v1/auth/me: `{ user, tenantRoles, permissions }`. Roles and permissions are for the `x-tenant` shop (empty
/// without one).
class Me {
  const Me({required this.user, required this.tenantRoles, required this.permissions});
  final AuthUser user;
  final List<String> tenantRoles;
  final List<String> permissions;

  factory Me.fromJson(Json j) => Me(
        user: AuthUser.fromJson(_map(j['user'])),
        tenantRoles: _strings(j['tenantRoles']),
        permissions: _strings(j['permissions']),
      );
}

/// packages/tenancy/src/service.ts `publicTenant`: `{ id, slug, name, appId, status }`.
class Tenant {
  const Tenant({required this.id, required this.slug, required this.name, this.appId, required this.status});
  final String id;
  final String slug;
  final String name;
  final String? appId;

  /// `active` or `suspended`.
  final String status;

  factory Tenant.fromJson(Json j) => Tenant(
        id: _str(j['id']) ?? '',
        slug: _str(j['slug']) ?? '',
        name: _str(j['name']) ?? '',
        appId: _str(j['appId']),
        status: _str(j['status']) ?? 'active',
      );
}

/// An item of GET /v1/tenancy/mine: `{ tenant, roles }`.
class Membership {
  const Membership({required this.tenant, required this.roles});
  final Tenant tenant;
  final List<String> roles;

  factory Membership.fromJson(Json j) => Membership(tenant: Tenant.fromJson(_map(j['tenant'])), roles: _strings(j['roles']));
}

/// packages/features/src/resolve.ts `FeatureState`.
class FeatureState {
  const FeatureState({
    required this.key,
    required this.module,
    required this.label,
    required this.description,
    required this.dependsOn,
    required this.shopToggle,
    required this.enabled,
    this.reason,
    required this.available,
    this.shopEnabled,
  });

  final String key;
  final String module;
  final String label;
  final String description;
  final List<String> dependsOn;
  final bool shopToggle;
  final bool enabled;

  /// Why it's off: `app`, `plan`, `dependency` or `shop`. Null when enabled.
  final String? reason;

  /// App, plan and dependencies allow it (the shop switch aside).
  final bool available;

  /// The owner's switch; null = never touched.
  final bool? shopEnabled;

  factory FeatureState.fromJson(Json j) => FeatureState(
        key: _str(j['key']) ?? '',
        module: _str(j['module']) ?? '',
        label: _str(j['label']) ?? '',
        description: _str(j['description']) ?? '',
        dependsOn: _strings(j['dependsOn']),
        shopToggle: j['shopToggle'] == true,
        enabled: j['enabled'] == true,
        reason: _str(j['reason']),
        available: j['available'] == true,
        shopEnabled: j['shopEnabled'] is bool ? j['shopEnabled'] as bool : null,
      );
}

/// packages/features/src/service.ts `TenantFeatures` (GET /v1/features).
class TenantFeatures {
  const TenantFeatures({this.appId, this.planId, required this.features, required this.enabled});
  final String? appId;
  final String? planId;
  final List<FeatureState> features;

  /// Keys of the enabled features.
  final List<String> enabled;

  static const empty = TenantFeatures(features: [], enabled: []);

  factory TenantFeatures.fromJson(Json j) => TenantFeatures(
        appId: _str(j['appId']),
        planId: _str(j['planId']),
        features: _list(j['features']).map(FeatureState.fromJson).toList(),
        enabled: _strings(j['enabled']),
      );
}

/// packages/branding/src/service.ts `Branding` (GET /v1/branding). [tokens] is the raw `BrandTokens` JSON; parse it
/// with `BrandTokens.fromJson` from srikit_theme.
class Branding {
  const Branding({this.appName, this.logoUrl, this.logoDarkUrl, this.faviconUrl, required this.tokens, this.css = ''});
  final String? appName;
  final String? logoUrl;
  final String? logoDarkUrl;
  final String? faviconUrl;
  final Json tokens;

  /// The web theme as CSS variables (not used by the app; tokens drive the Flutter theme).
  final String css;

  factory Branding.fromJson(Json j) => Branding(
        appName: _str(j['appName']),
        logoUrl: _str(j['logoUrl']),
        logoDarkUrl: _str(j['logoDarkUrl']),
        faviconUrl: _str(j['faviconUrl']),
        tokens: _map(j['tokens']),
        css: _str(j['css']) ?? '',
      );
}

/// `{ invoiced, collected, count }` for a period (paise, paise, bills).
class PeriodTotals {
  const PeriodTotals({required this.invoiced, required this.collected, required this.count});
  final int invoiced;
  final int collected;
  final int count;

  static const zero = PeriodTotals(invoiced: 0, collected: 0, count: 0);

  factory PeriodTotals.fromJson(Json j) =>
      PeriodTotals(invoiced: _int(j['invoiced']), collected: _int(j['collected']), count: _int(j['count']));
}

/// packages/invoices/src/service.ts `InvoiceSummary` (a row of bill lists).
class InvoiceSummary {
  const InvoiceSummary({
    required this.id,
    this.number,
    this.branchId,
    required this.status,
    required this.date,
    this.dueDate,
    required this.customerName,
    required this.total,
    required this.paid,
    required this.credited,
    required this.balance,
    required this.isOverdue,
  });

  final String id;

  /// Null for drafts.
  final String? number;
  final String? branchId;
  final String status;

  /// `YYYY-MM-DD` (IST).
  final String date;
  final String? dueDate;
  final String customerName;
  final int total;
  final int paid;
  final int credited;
  final int balance;
  final bool isOverdue;

  factory InvoiceSummary.fromJson(Json j) => InvoiceSummary(
        id: _str(j['id']) ?? '',
        number: _str(j['number']),
        branchId: _str(j['branchId']),
        status: _str(j['status']) ?? '',
        date: _str(j['date']) ?? '',
        dueDate: _str(j['dueDate']),
        customerName: _str(j['customerName']) ?? '',
        total: _int(j['total']),
        paid: _int(j['paid']),
        credited: _int(j['credited']),
        balance: _int(j['balance']),
        isOverdue: j['isOverdue'] == true,
      );
}

/// packages/invoices/src/service.ts `DashboardSummary` (GET /v1/invoices/summary).
class DashboardSummary {
  const DashboardSummary({
    required this.month,
    required this.prevMonth,
    required this.outstanding,
    required this.overdueCount,
    required this.recent,
    required this.trend,
  });

  /// Current IST month.
  final PeriodTotals month;
  final PeriodTotals prevMonth;

  /// Unpaid balance of open bills (paise).
  final int outstanding;
  final int overdueCount;

  /// The five latest bills.
  final List<InvoiceSummary> recent;

  /// Last 14 IST days, oldest first: `{ date, invoiced }`.
  final List<({String date, int invoiced})> trend;

  factory DashboardSummary.fromJson(Json j) => DashboardSummary(
        month: PeriodTotals.fromJson(_map(j['month'])),
        prevMonth: PeriodTotals.fromJson(_map(j['prevMonth'])),
        outstanding: _int(j['outstanding']),
        overdueCount: _int(j['overdueCount']),
        recent: _list(j['recent']).map(InvoiceSummary.fromJson).toList(),
        trend: _list(j['trend']).map((t) => (date: _str(t['date']) ?? '', invoiced: _int(t['invoiced']))).toList(),
      );
}

/// `{ ok: true }` answer of simple writes (push tokens, logout). [replayed] is true when the API replayed a stored
/// answer for the same Idempotency-Key.
class Ok {
  const Ok({required this.ok, this.replayed = false});
  final bool ok;
  final bool replayed;

  factory Ok.fromJson(Json j, {bool replayed = false}) => Ok(ok: j['ok'] == true, replayed: replayed);
}

/// POST /v1/auth/otp/request: `{ target, channel, expiresInSeconds, resendInSeconds }`.
class OtpRequestResult {
  const OtpRequestResult({required this.target, required this.channel, required this.expiresInSeconds, required this.resendInSeconds});

  /// The normalised target the code went to (E.164 for phones).
  final String target;
  final String channel;
  final int expiresInSeconds;

  /// Wait this long before offering "send again".
  final int resendInSeconds;

  factory OtpRequestResult.fromJson(Json j) => OtpRequestResult(
        target: _str(j['target']) ?? '',
        channel: _str(j['channel']) ?? 'sms',
        expiresInSeconds: _int(j['expiresInSeconds']),
        resendInSeconds: _int(j['resendInSeconds']),
      );
}

/// One app's versions in GET /v1/mobile/config `apps`.
class MobileAppVersions {
  const MobileAppVersions({this.minVersion, this.latestVersion});
  final String? minVersion;
  final String? latestVersion;

  factory MobileAppVersions.fromJson(Json j) =>
      MobileAppVersions(minVersion: _str(j['minVersion']), latestVersion: _str(j['latestVersion']));
}

/// The calling app as the API read it from `x-client` (null when the header was missing or malformed).
class MobileClient {
  const MobileClient({required this.app, required this.version, this.platform});
  final String app;
  final String version;
  final String? platform;

  factory MobileClient.fromJson(Json j) =>
      MobileClient(app: _str(j['app']) ?? '', version: _str(j['version']) ?? '', platform: _str(j['platform']));
}

/// apps/api/src/kit-mobile.ts GET /v1/mobile/config: `{ apps, client, updateRequired, updateAvailable }`.
class MobileConfig {
  const MobileConfig({required this.apps, this.client, required this.updateRequired, required this.updateAvailable});
  final Map<String, MobileAppVersions> apps;
  final MobileClient? client;

  /// This version is below the minimum: every other call answers 426 until the app is updated.
  final bool updateRequired;

  /// A newer version is in the stores.
  final bool updateAvailable;

  /// The minimum version for [app] (or the calling app).
  String? minVersionFor(String app) => apps[app]?.minVersion;

  factory MobileConfig.fromJson(Json j) => MobileConfig(
        apps: _map(j['apps']).map((k, v) => MapEntry(k, MobileAppVersions.fromJson(_map(v)))),
        client: j['client'] is Map ? MobileClient.fromJson(_map(j['client'])) : null,
        updateRequired: j['updateRequired'] == true,
        updateAvailable: j['updateAvailable'] == true,
      );
}
