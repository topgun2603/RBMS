import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_theme/srikit_theme.dart';

import 'gates.dart';
import 'storage.dart';

/// Everything the app needs about the shop being worked in.
class ShopContext {
  const ShopContext({required this.membership, required this.features, required this.branding, required this.tokens, required this.me});

  final Membership membership;
  final TenantFeatures features;
  final Branding? branding;

  /// The shop's brand tokens (platform defaults when branding could not be loaded).
  final BrandTokens tokens;

  /// The user with roles and permissions in this shop.
  final Me me;

  Tenant get tenant => membership.tenant;

  Gates get gates => Gates(enabled: features.enabled.toSet(), roles: me.tenantRoles, permissions: me.permissions);
}

/// Lists the user's shops and switches between them (`x-tenant`).
class ShopRepository {
  ShopRepository({required this.api, required this.session});
  final SrikitApi api;
  final SessionStore session;

  Future<List<Membership>> myShops() => api.myShops();

  /// The shop to open without asking: the only one, else the last one picked (if still a member). Null = ask.
  Future<Membership?> autoPick(List<Membership> shops) async {
    final active = shops.where((m) => m.tenant.status == 'active').toList();
    if (active.length == 1) return active.single;
    final last = await session.lastShop();
    if (last == null) return null;
    return active.where((m) => m.tenant.slug == last).firstOrNull;
  }

  /// Switches the client to [membership]'s shop, remembers it and loads its features, branding and permissions.
  /// Branding failing is not fatal (defaults are used); features or `/auth/me` failing is.
  Future<ShopContext> open(Membership membership) async {
    final previous = api.client.tenant;
    api.client.tenant = membership.tenant.slug;
    try {
      final results = await Future.wait<Object?>([
        api.features(),
        api.me(),
        api.branding().then<Branding?>((b) => b, onError: (Object _) => null),
      ]);
      final branding = results[2] as Branding?;
      await session.saveLastShop(membership.tenant.slug);
      return ShopContext(
        membership: membership,
        features: results[0] as TenantFeatures,
        me: results[1] as Me,
        branding: branding,
        tokens: BrandTokens.fromJson(branding?.tokens, fallback: srikitDefaultTokens),
      );
    } catch (_) {
      api.client.tenant = previous;
      rethrow;
    }
  }

  /// Leaves the current shop (back to the picker).
  void close() => api.client.tenant = null;
}
