import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';
import 'package:srikit_theme/srikit_theme.dart';

import 'catalog.dart';
import 'idle_lock.dart';
import 'pairing.dart';
import 'pin_pad.dart';
import 'weigh.dart';

/// Where a POS terminal is (packages/pos-ui terminal phases): not paired yet, the server can't be reached, locked
/// (PIN pad), or unlocked by a cashier.
enum TerminalPhase { loading, unpaired, offline, locked, unlocked }

/// Why the terminal is showing pairing / the lock screen.
enum TerminalNotice { none, revoked, idle, expired, locked }

/// Feature keys of terminal mode.
abstract final class PosKeys {
  static const terminals = 'pos.terminals';
  static const weighing = 'pos.weighing';
  static const weigh = 'pos.weigh';
}

typedef CatalogStoreFactory = Future<CatalogStore> Function(String shopId);

/// This phone as a POS terminal (docs/pos-terminals.md): pairing (device token in secure storage, `x-device-token`
/// on every request), the PIN lock (a PIN session as the bearer, 12 h, no slide), idle auto-lock, the on-device
/// catalogue, and the shop context the counter bills with.
class TerminalController extends ChangeNotifier {
  TerminalController({
    required this.api,
    required this.session,
    required this.buildOrigin,
    required this.catalogStoreFor,
    required this.platform,
    required this.appVersion,
    this.deviceModel,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now {
    idle = IdleLock(onLock: () => lock(reason: TerminalNotice.idle), now: _now);
  }

  final SrikitApi api;
  final SessionStore session;

  /// The build's API origin (SRIKIT_API).
  final String buildOrigin;
  final CatalogStoreFactory catalogStoreFor;

  /// `android` / `ios` for POST /pair.
  final String platform;
  final String appVersion;
  final String? deviceModel;
  final DateTime Function() _now;
  DateTime Function() get clock => _now;
  late final IdleLock idle;

  TerminalPhase phase = TerminalPhase.loading;
  TerminalNotice notice = TerminalNotice.none;
  PosDeviceInfo? device;
  Branding? branding;
  PosPinSession? pin;
  List<PosStaffEntry> staff = const [];
  UnlockProblem? unlockProblem;
  Object? error;
  bool busy = false;
  PosCatalog? catalog;
  WeighingController? weighing;
  Timer? _expiry;
  bool _disposed = false;

  PosTerminal? get terminal => device?.terminal;
  bool get isWeighing => terminal?.isWeighing ?? false;

  /// The shop has terminal mode (and, for a weighing station, the weighing feature).
  bool get featureOn {
    final d = device;
    if (d == null) return false;
    if (!d.features.contains(PosKeys.terminals)) return false;
    return !d.terminal.isWeighing || d.features.contains(PosKeys.weighing);
  }

  BrandTokens get tokens => BrandTokens.fromJson(branding?.tokens, fallback: srikitDefaultTokens);

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  // ---------------------------------------------------------------- start / pairing

  /// On launch: a saved pairing → load the device (locked); none → pairing.
  Future<void> start() async {
    final saved = await session.savedTerminal();
    if (saved == null) {
      phase = TerminalPhase.unpaired;
      _notify();
      return;
    }
    api.client.deviceToken = saved.deviceToken;
    if (saved.origin != null) api.client.setBaseUrl(saved.origin!);
    await loadDevice();
  }

  /// GET /pos/device (and the shop's branding) → locked. A revoked token → pairing; no network → offline.
  Future<void> loadDevice() async {
    phase = TerminalPhase.loading;
    error = null;
    _notify();
    try {
      final d = await api.posDevice();
      device = d;
      api.client.tenant = d.shop.slug;
      idle.lockAfter = Duration(minutes: d.terminal.settings.lockAfterMinutes);
      try {
        branding = await api.branding();
      } on ApiException {
        branding = null;
      }
      if (catalog == null) {
        catalog = PosCatalog(api: api, store: await catalogStoreFor(d.shop.id));
        await catalog!.load();
      }
      phase = pin != null && !pin!.expired(_now()) ? TerminalPhase.unlocked : TerminalPhase.locked;
      _notify();
      if (phase == TerminalPhase.locked) await loadStaff();
    } on ApiException catch (e) {
      if (e.code == 'device_not_paired' || e.status == 401) {
        await _forget(TerminalNotice.revoked);
        return;
      }
      error = e;
      phase = TerminalPhase.offline;
      _notify();
    }
  }

  Future<void> loadStaff() async {
    try {
      staff = await api.posStaff();
      _notify();
    } on ApiException {
      // The names are a convenience; the PIN alone unlocks.
    }
  }

  /// A typed code or a scanned QR. Throws [ApiException] (see [pairErrorOf]) or [FormatException].
  Future<void> pair(String input) async {
    final qr = parsePairingQr(input) ?? (normalizePairingCode(input) == null ? null : PairingQr('', normalizePairingCode(input)!));
    if (qr == null) throw const FormatException('Not a pairing code');
    final origin = pairingOrigin(qr, buildOrigin);
    final previous = api.client.baseUri;
    busy = true;
    _notify();
    try {
      api.client.deviceToken = null;
      api.client.token = null;
      api.client.tenant = null;
      if (origin != null) api.client.setBaseUrl(origin);
      final r = await api.posPair(
        qr.code,
        PosDeviceDescription(platform: platform, model: deviceModel, appVersion: appVersion),
      );
      await session.saveTerminal(r.value.deviceToken, origin: origin);
      api.client.deviceToken = r.value.deviceToken;
      notice = TerminalNotice.none;
      pin = null;
      catalog?.dispose();
      catalog = null;
      busy = false;
      await loadDevice();
    } catch (_) {
      api.client.baseUri = previous;
      busy = false;
      _notify();
      rethrow;
    }
  }

  // ---------------------------------------------------------------- PIN lock

  /// POST /pos/session with the PIN. Problems land in [unlockProblem] (wrong PIN with tries left, lockout with a
  /// countdown, not allowed on this terminal).
  Future<bool> unlock(String digits) async {
    if (padDisabled(unlockProblem, busy, _now())) return false;
    busy = true;
    unlockProblem = null;
    _notify();
    try {
      final s = await api.posSession(digits);
      pin = s;
      api.client.token = s.token;
      notice = TerminalNotice.none;
      phase = TerminalPhase.unlocked;
      busy = false;
      _armExpiry(s);
      idle.start();
      if (isWeighing) {
        weighing?.dispose();
        weighing = WeighingController(api: api, session: session, catalog: catalog!);
      }
      _notify();
      final c = catalog;
      if (c != null) {
        unawaited(c.sync());
        c.startAutoSync();
      }
      return true;
    } catch (e) {
      busy = false;
      final p = unlockProblemOf(e, _now());
      if (p.kind == UnlockKind.unpaired) {
        await _forget(TerminalNotice.revoked);
        return false;
      }
      unlockProblem = p;
      _notify();
      return false;
    }
  }

  void _armExpiry(PosPinSession s) {
    _expiry?.cancel();
    final at = s.expiresAt;
    if (at == null) return;
    final left = at.difference(_now());
    _expiry = Timer(left.isNegative ? Duration.zero : left, () => lock(reason: TerminalNotice.expired, tellServer: false));
  }

  void clearUnlockProblem() {
    unlockProblem = null;
    _notify();
  }

  /// Lock / Switch cashier (POST /pos/session/lock), idle auto-lock, or an expired session ([tellServer] false).
  Future<void> lock({TerminalNotice reason = TerminalNotice.none, bool tellServer = true}) async {
    if (phase != TerminalPhase.unlocked) return;
    idle.stop();
    _expiry?.cancel();
    catalog?.stopAutoSync();
    phase = TerminalPhase.locked;
    notice = reason;
    final hadSession = pin != null;
    pin = null;
    _notify();
    if (tellServer && hadSession) {
      try {
        await api.posLock();
      } on ApiException {
        // The session dies on its own (12 h); the phone forgets it now.
      }
    }
    api.client.token = null;
    await loadStaff();
  }

  /// A 401 from any request while in terminal mode.
  void unauthorized(ApiException e) {
    if (e.code == 'device_not_paired') {
      unawaited(_forget(TerminalNotice.revoked));
    } else if (phase == TerminalPhase.unlocked) {
      // The PIN session ended (expired, revoked, device_required): back to the PIN pad.
      api.client.token = null;
      unawaited(lock(reason: TerminalNotice.expired, tellServer: false));
    }
  }

  // ---------------------------------------------------------------- unpair

  /// Settings → Unpair this phone (POST /pos/device/unpair), then back to pairing.
  Future<void> unpair() async {
    try {
      await api.posUnpairDevice();
    } on ApiException {
      // Already unpaired on the server, or offline: forget it here anyway.
    }
    await _forget(TerminalNotice.none);
  }

  Future<void> _forget(TerminalNotice why) async {
    idle.stop();
    _expiry?.cancel();
    await session.clearTerminal();
    final c = catalog;
    catalog = null;
    if (c != null) {
      c.stopAutoSync();
      await c.store.clear();
      c.dispose();
    }
    weighing?.dispose();
    weighing = null;
    api.client
      ..deviceToken = null
      ..token = null
      ..tenant = null
      ..setBaseUrl(buildOrigin);
    device = null;
    branding = null;
    pin = null;
    staff = const [];
    unlockProblem = null;
    phase = TerminalPhase.unpaired;
    notice = why;
    _notify();
  }

  // ---------------------------------------------------------------- the shop for the counter

  /// The shop context a cashier bills in (gates from the PIN session's roles / permissions and the device's
  /// features). Null while locked.
  ShopContext? shopContext() {
    final d = device;
    final s = pin;
    if (d == null || s == null || phase != TerminalPhase.unlocked) return null;
    return ShopContext(
      membership: Membership(
        tenant: Tenant(id: d.shop.id, slug: d.shop.slug, name: d.shop.name, appId: d.shop.appId, status: 'active'),
        roles: s.tenantRoles,
      ),
      features: TenantFeatures(appId: d.shop.appId, features: const [], enabled: d.features),
      branding: branding,
      tokens: tokens,
      me: Me(
        user: AuthUser(id: s.userId, name: s.userName, locale: 'en', platformRoles: const [], status: 'active'),
        tenantRoles: s.tenantRoles,
        permissions: s.permissions,
      ),
    );
  }

  @override
  void dispose() {
    _disposed = true;
    idle.dispose();
    _expiry?.cancel();
    catalog?.dispose();
    weighing?.dispose();
    super.dispose();
  }
}
