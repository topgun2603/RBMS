import 'package:srikit_api/srikit_api.dart';

/// Turns what the user typed into E.164. Ten Indian mobile digits (optionally with a leading 0 or 91) get `+91`;
/// input starting with `+` keeps its country code. Returns null when it can't be a phone number.
String? normalizePhone(String input) {
  final trimmed = input.trim();
  final digits = trimmed.replaceAll(RegExp(r'[^0-9]'), '');
  if (trimmed.startsWith('+')) {
    if (digits.startsWith('91')) return RegExp(r'^91[6-9]\d{9}$').hasMatch(digits) ? '+$digits' : null;
    return digits.length >= 8 && digits.length <= 15 ? '+$digits' : null;
  }
  var d = digits;
  if (d.length == 11 && d.startsWith('0')) d = d.substring(1);
  if (d.length == 12 && d.startsWith('91')) d = d.substring(2);
  return RegExp(r'^[6-9]\d{9}$').hasMatch(d) ? '+91$d' : null;
}

/// Verifies a phone number and returns a srikit session.
///
/// [OtpPhoneSignIn] (our own SMS code through /v1/auth/otp/*) is used in development and when `GET /v1/auth/config`
/// says `phone.method == "otp"`. [FirebasePhoneSignIn] is not wired yet.
abstract interface class PhoneSignIn {
  /// Sends a code to [phone] (E.164).
  Future<void> sendCode(String phone);

  /// Checks [code] for [phone] and signs in. Throws [ApiException] on a wrong or expired code.
  Future<SignInResult> verify(String phone, String code, {String? name});
}

class OtpPhoneSignIn implements PhoneSignIn {
  OtpPhoneSignIn(this.api);
  final SrikitApi api;

  @override
  Future<void> sendCode(String phone) => api.requestOtp(phone, channel: 'sms');

  @override
  Future<SignInResult> verify(String phone, String code, {String? name}) => api.verifyOtp(phone, code, name: name);
}

/// Lower-cased email when [input] looks like one, else null (the server does the real check).
String? normalizeEmail(String input) {
  final e = input.trim().toLowerCase();
  return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(e) && e.length <= 254 ? e : null;
}

/// A 6-digit code sent by email through /v1/auth/otp/* (shop owners who signed up with an email, and the
/// development test identity).
class EmailOtpSignIn implements PhoneSignIn {
  EmailOtpSignIn(this.api);
  final SrikitApi api;

  @override
  Future<void> sendCode(String email) => api.requestOtp(email, channel: 'email');

  @override
  Future<SignInResult> verify(String email, String code, {String? name}) => api.verifyOtp(email, code, name: name);
}

/// Firebase Phone Authentication, then `POST /v1/auth/firebase { idToken }`.
///
/// TODO(firebase): add firebase_core + firebase_auth and the platform config (google-services.json,
/// GoogleService-Info.plist), then: [sendCode] → `FirebaseAuth.instance.verifyPhoneNumber(...)` keeping the
/// verificationId (and handling Android auto-retrieval); [verify] → `PhoneAuthProvider.credential(verificationId,
/// code)`, `signInWithCredential`, `user.getIdToken()`, then [SrikitApi.firebaseSignIn].
class FirebasePhoneSignIn implements PhoneSignIn {
  FirebasePhoneSignIn(this.api);
  final SrikitApi api;

  @override
  Future<void> sendCode(String phone) => throw UnimplementedError('Firebase phone sign-in is not set up yet');

  @override
  Future<SignInResult> verify(String phone, String code, {String? name}) =>
      throw UnimplementedError('Firebase phone sign-in is not set up yet');
}

/// The phone sign-in to use for [phone] given the server's [config]. Until Firebase is wired this is always OTP.
PhoneSignIn phoneSignInFor(SrikitApi api, AuthClientConfig? config, String phone) {
  // TODO(firebase): return FirebasePhoneSignIn(api) when config.usesFirebase && !config.isTestTarget(phone).
  return OtpPhoneSignIn(api);
}
