import 'package:url_launcher/url_launcher.dart';

/// Opens a URL outside the app (WhatsApp, the dialer); replaceable in tests (`AppController.openUrl`).
typedef UrlOpener = Future<bool> Function(Uri url);

/// [launchUrl] in the external app; false when nothing can open it.
Future<bool> openExternal(Uri url) async {
  try {
    return await launchUrl(url, mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}
