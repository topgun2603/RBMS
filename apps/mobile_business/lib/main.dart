import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import 'src/app.dart';
import 'src/app_controller.dart';
import 'src/config.dart';
import 'src/pos/catalog.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final client = ApiClient(
    baseUrl: apiBaseUrl,
    client: ClientInfo(app: clientApp, version: appVersion, platform: clientPlatform),
  );
  final controller = AppController(
    api: SrikitApi(client),
    session: SessionStore(SecureKeyValueStore()),
    // A paired terminal keeps its catalogue in a JSON file per shop (app support directory, not backed up as cache).
    catalogStoreFor: (shopId) async => JsonFileCatalogStore(await getApplicationSupportDirectory(), shopId),
  )..deviceModel = Platform.isAndroid || Platform.isIOS ? Platform.operatingSystemVersion : null;
  runApp(SrikitBusinessApp(controller: controller));
  controller.start();
}
