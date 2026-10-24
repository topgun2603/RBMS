# srikit_api

Thin typed client over `package:http` for the srikit Fastify API. See `apps/mobile_business/README.md`.

- `ApiClient`: base URL, headers (`authorization`, `x-tenant`, `accept-language`, `x-client`, `idempotency-key`), JSON,
  `ApiResponse` (status, data, headers, `replayed`).
- Errors: `ApiException(status, code, message, details)`; `UpdateRequiredException` (426 `app_update_required`,
  `minVersion`, also reported to `ApiClient.onUpdateRequired`); `IdempotencyInProgressException` (409, retryable);
  `IdempotencyKeyReusedError` (422, an `Error`).
- `IdempotencyKeys(deviceId).next()` → `<deviceId>:<uuid v4>`; `isValidIdempotencyKey`.
- `SrikitApi`: typed endpoints (mobile config, auth, tenancy, features, branding, invoices summary, push tokens, counter
  billing, products, stock, orders, customers, credit book, expenses); every write takes an optional `idempotencyKey`.
  Models: `models.dart`, `billing_models.dart`, `catalog_models.dart`, `books_models.dart` (credit book, ledger,
  receipts as `CustomerReceipt`, expenses).
- POS terminals (`pos_models.dart`): pairing, device, PIN session, staff, catalogue (`posCatalog` with `etag` → 304 =
  `PosCatalogPage.unchanged`), categories, weigh tickets. `ApiClient.deviceToken` → `x-device-token`;
  `ApiClient.onUnauthorized` hears every 401; `setBaseUrl` for a pairing QR of another API.
- Money is always paise (`int`). Lists are `Page<T>` (`{ items, total }`); `/tenancy/mine` has no `total`.

Models are hand-written; `node scripts/mobile/check-api-models.mjs` compares them with the typed API document.
Tests: `dart test`.
