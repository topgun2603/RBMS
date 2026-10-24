# srikit_kit

Shared plumbing for srikit Flutter apps (see `apps/mobile_business/README.md`):

- `SessionStore` over a `KeyValueStore` (`SecureKeyValueStore` = flutter_secure_storage; `MemoryKeyValueStore` for tests):
  session token, last shop slug, language.
- `AuthRepository`: restore (`/auth/me`; a 401 drops the token, offline keeps it), complete sign-in, sign out.
- `PhoneSignIn`: `OtpPhoneSignIn` (now) and a TODO `FirebasePhoneSignIn`; `normalizePhone` (+91 default).
- `ShopRepository` / `ShopContext`: `/tenancy/mine`, auto-pick (one shop or the last one), open a shop (`x-tenant`,
  features, branding, per-shop permissions).
- `Gates`, `GateScope`, `Gate`: feature and permission checks mirroring the server (`permissionMatches`).
- `PushRegistrar` + `PushTokenSource` (FCM to come).
- `formatPaise`: `₹1,23,456.78`.

Tests: `flutter test`.
