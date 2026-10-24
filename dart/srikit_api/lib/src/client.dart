import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'idempotency.dart';

/// An error answer from the API (`{ error: { code, message, details } }`), or a transport failure.
///
/// Transport failures (no network, timeout, a non-JSON answer) use [status] 0 and code [networkCode] /
/// [timeoutCode] / [badResponseCode], so the UI can show its own localised text for them.
class ApiException implements Exception {
  const ApiException(this.status, this.code, this.message, {this.details});

  static const networkCode = 'network';
  static const timeoutCode = 'timeout';
  static const badResponseCode = 'bad_response';

  /// HTTP status, or 0 when no answer arrived.
  final int status;

  /// Machine code from the API, e.g. `unauthorized`, `invalid_input`, `feature_disabled`, `plan_limit`.
  final String code;

  /// Human message from the API (already in the request's language where the API translates it).
  final String message;
  final Object? details;

  bool get isUnauthorized => status == 401;
  bool get isNetwork => status == 0;

  /// Sending the same request again may succeed (transport failures, 409 idempotency_in_progress). Only safe to
  /// act on for writes that carry an Idempotency-Key.
  bool get retryable => status == 0;

  @override
  String toString() => 'ApiException($status, $code, $message)';
}

/// 426 `app_update_required`: this app version is below the minimum (apps/api/src/kit-mobile.ts `updateGuard`). Every
/// request fails with it until the app is updated.
class UpdateRequiredException extends ApiException {
  const UpdateRequiredException(String message, {this.minVersion, super.details}) : super(426, errorCode, message);

  static const errorCode = 'app_update_required';

  /// `details.minVersion`, e.g. `1.2.0`.
  final String? minVersion;
}

/// 409 `idempotency_in_progress`: the first request with this Idempotency-Key is still running. Retry the same
/// request (same key) after a short wait.
class IdempotencyInProgressException extends ApiException {
  const IdempotencyInProgressException(String message, {super.details}) : super(409, errorCode, message);

  static const errorCode = 'idempotency_in_progress';

  @override
  bool get retryable => true;
}

/// 422 `idempotency_key_reused`: one Idempotency-Key was sent with two different requests. This is a bug in the app
/// (a key must belong to exactly one operation), so it is an [Error], not an [ApiException]: it is not caught by
/// `on ApiException` handlers and should reach crash reporting.
class IdempotencyKeyReusedError extends Error {
  IdempotencyKeyReusedError(this.key, this.message);
  static const errorCode = 'idempotency_key_reused';
  final String? key;
  final String message;

  @override
  String toString() => 'IdempotencyKeyReusedError($key): $message';
}

/// Describes the app for the `x-client` header, e.g. `srikit-business/1.0.0 (android)`.
///
/// The API (`parseClient` in packages/auth) only accepts `srikit-<name>/<semver>[ (android|ios)]`; a valid header makes
/// the session a long, sliding mobile session and lets the API enforce a minimum app version.
class ClientInfo {
  const ClientInfo({required this.app, required this.version, this.platform});

  /// Lower-case letters only, e.g. `business`.
  final String app;

  /// Semver, e.g. `1.0.0` or `1.0.0+3`.
  final String version;

  /// `android` or `ios`; null on other platforms (tests, desktop).
  final String? platform;

  String get header => 'srikit-$app/$version${platform == null ? '' : ' ($platform)'}';
}

/// A decoded answer with its status and headers.
class ApiResponse {
  const ApiResponse(this.status, this.data, this.headers);
  final int status;

  /// Decoded JSON (null for an empty body).
  final Object? data;

  /// Lower-case header names.
  final Map<String, String> headers;

  /// The API replayed the stored answer of an earlier request with the same Idempotency-Key
  /// (`idempotent-replayed: true`): the write already happened, this is not a second one.
  bool get replayed => headers['idempotent-replayed'] == 'true';
}

/// Low-level JSON client. Mutable [token], [tenant] and [locale] are read on every request.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.client,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 20),
  })  : baseUri = Uri.parse(baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl),
        _http = httpClient ?? http.Client();

  /// Origin of the API, without `/v1`, e.g. `http://10.0.2.2:4000`. A POS terminal paired through a QR code that
  /// names another origin switches it with [setBaseUrl].
  Uri baseUri;
  final ClientInfo client;
  final Duration timeout;
  final http.Client _http;

  /// Session token, sent as `authorization: Bearer <token>`.
  String? token;

  /// Shop slug, sent as `x-tenant`.
  String? tenant;

  /// A paired POS terminal's device token, sent as `x-device-token` on every request (docs/pos-terminals.md).
  String? deviceToken;

  /// UI language, sent as `accept-language` (e.g. `en`, `ta`).
  String locale = 'en';

  /// Called (before the exception is thrown) whenever any request answers 426 `app_update_required`, so the app can
  /// switch to its update screen from wherever the request was made.
  void Function(UpdateRequiredException error)? onUpdateRequired;

  /// Called (before the exception is thrown) for every 401 answer, with its error code (e.g. `device_not_paired`,
  /// `device_required`, `unauthorized`). A POS terminal uses it to go back to pairing or to the lock screen.
  void Function(ApiException error)? onUnauthorized;

  /// Points the client at another API origin (without `/v1`).
  void setBaseUrl(String baseUrl) =>
      baseUri = Uri.parse(baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl);

  Uri uri(String path, [Map<String, String>? query]) {
    final p = path.startsWith('/') ? path : '/$path';
    return baseUri.replace(path: '${baseUri.path}/v1$p', queryParameters: query == null || query.isEmpty ? null : query);
  }

  Map<String, String> headers({bool json = false, String? idempotencyKey}) => {
        'accept': 'application/json',
        'accept-language': locale,
        'x-client': client.header,
        if (json) 'content-type': 'application/json',
        if (token != null && token!.isNotEmpty) 'authorization': 'Bearer $token',
        if (tenant != null && tenant!.isNotEmpty) 'x-tenant': tenant!,
        if (deviceToken != null && deviceToken!.isNotEmpty) 'x-device-token': deviceToken!,
        if (idempotencyKey != null) 'idempotency-key': idempotencyKey,
      };

  Future<Object?> get(String path, {Map<String, String>? query}) async => (await request('GET', path, query: query)).data;
  Future<Object?> post(String path, [Object? body, String? idempotencyKey]) async =>
      (await request('POST', path, body: body, idempotencyKey: idempotencyKey)).data;
  Future<Object?> put(String path, [Object? body, String? idempotencyKey]) async =>
      (await request('PUT', path, body: body, idempotencyKey: idempotencyKey)).data;
  Future<Object?> patch(String path, [Object? body, String? idempotencyKey]) async =>
      (await request('PATCH', path, body: body, idempotencyKey: idempotencyKey)).data;
  Future<Object?> delete(String path, [Object? body, String? idempotencyKey]) async =>
      (await request('DELETE', path, body: body, idempotencyKey: idempotencyKey)).data;

  /// Sends a request and returns the decoded answer. Throws [ApiException] (or a subclass), or
  /// [IdempotencyKeyReusedError]. [idempotencyKey] (writes only) must match [isValidIdempotencyKey]. [headers] are
  /// added as given (e.g. `if-none-match`); a 304 answer comes back as an [ApiResponse] with status 304 and no data.
  Future<ApiResponse> request(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    String? idempotencyKey,
    Map<String, String>? headers,
  }) async {
    if (idempotencyKey != null) {
      if (method == 'GET' || method == 'HEAD') throw ArgumentError('Idempotency-Key is for writes only');
      if (!isValidIdempotencyKey(idempotencyKey)) {
        throw ArgumentError.value(idempotencyKey, 'idempotencyKey', 'must be 8–128 of [A-Za-z0-9_.:-]');
      }
    }
    final req = http.Request(method, uri(path, query))
      ..headers.addAll(this.headers(json: body != null, idempotencyKey: idempotencyKey))
      ..headers.addAll(headers ?? const {});
    if (body != null) req.body = jsonEncode(body);
    final http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(req).timeout(timeout)).timeout(timeout);
    } on TimeoutException {
      throw const ApiException(0, ApiException.timeoutCode, 'The server took too long to answer');
    } on http.ClientException catch (e) {
      throw ApiException(0, ApiException.networkCode, 'Could not reach the server', details: e.message);
    } catch (e) {
      // SocketException / HandshakeException (dart:io) without importing dart:io, so this stays web-safe.
      throw ApiException(0, ApiException.networkCode, 'Could not reach the server', details: e.toString());
    }
    final Object? data;
    try {
      data = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } on FormatException {
      if (res.statusCode >= 400) throw ApiException(res.statusCode, 'http_${res.statusCode}', 'Request failed (${res.statusCode})');
      throw ApiException(res.statusCode, ApiException.badResponseCode, 'The server sent an unexpected answer');
    }
    if (res.statusCode >= 400) {
      final error = _error(res.statusCode, data, idempotencyKey);
      if (error is UpdateRequiredException) onUpdateRequired?.call(error);
      if (error is ApiException && error.status == 401) onUnauthorized?.call(error);
      throw error;
    }
    return ApiResponse(res.statusCode, data, res.headers);
  }

  static Object _error(int status, Object? data, [String? key]) {
    final err = data is Map ? data['error'] : null;
    if (err is! Map) return ApiException(status, 'http_$status', 'Request failed ($status)');
    final code = err['code'] is String ? err['code'] as String : 'http_$status';
    final message = err['message'] is String ? err['message'] as String : 'Request failed ($status)';
    final details = err['details'];
    return switch ((status, code)) {
      (426, UpdateRequiredException.errorCode) => UpdateRequiredException(
          message,
          minVersion: details is Map && details['minVersion'] is String ? details['minVersion'] as String : null,
          details: details,
        ),
      (409, IdempotencyInProgressException.errorCode) => IdempotencyInProgressException(message, details: details),
      (422, IdempotencyKeyReusedError.errorCode) => IdempotencyKeyReusedError(key, message),
      _ => ApiException(status, code, message, details: details),
    };
  }

  void close() => _http.close();
}
