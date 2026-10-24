import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../l10n/app_localizations.dart';

/// Camera barcode scan; pops with the first code read (or null).
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  bool _done = false;

  void _onDetect(BarcodeCapture capture) {
    if (_done) return;
    final code = capture.barcodes.map((b) => b.rawValue).whereType<String>().where((v) => v.trim().isNotEmpty).firstOrNull;
    if (code == null) return;
    _done = true;
    Navigator.of(context).pop(code.trim());
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.scanBarcode)),
      body: Stack(
        children: [
          MobileScanner(onDetect: _onDetect),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              width: double.infinity,
              color: Colors.black54,
              padding: const EdgeInsets.all(16),
              child: Text(l.scanHint, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center),
            ),
          ),
        ],
      ),
    );
  }
}
