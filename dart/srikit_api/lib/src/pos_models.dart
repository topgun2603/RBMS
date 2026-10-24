// POS terminal models (docs/pos-terminals.md, packages/pos/src/api-schemas.ts): terminals, pairing, the device, PIN
// sessions, the POS catalogue and weigh tickets. Money is paise (int), weights kg (3 decimals).

import 'models.dart';

Json _map(Object? v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
List<Json> _list(Object? v) => v is List ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() : const [];
List<String> _strings(Object? v) => v is List ? v.whereType<String>().toList() : const [];
int _int(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? 0 : 0);
int? _intOrNull(Object? v) => v is num ? v.toInt() : null;
double _num(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) ?? 0 : 0);
String? _str(Object? v) => v is String ? v : null;
DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;

/// `Terminal.settings`: `{ printerWidth: 58 | 80, autoPrint, lockAfterMinutes: 1..60 }`.
class TerminalSettings {
  const TerminalSettings({this.printerWidth = 58, this.autoPrint = false, this.lockAfterMinutes = 5});
  final int printerWidth;
  final bool autoPrint;

  /// Idle minutes before the terminal locks itself (1..60, default 5).
  final int lockAfterMinutes;

  factory TerminalSettings.fromJson(Json j) => TerminalSettings(
        printerWidth: _int(j['printerWidth']) == 80 ? 80 : 58,
        autoPrint: j['autoPrint'] == true,
        lockAfterMinutes: (_intOrNull(j['lockAfterMinutes']) ?? 5).clamp(1, 60),
      );
}

/// The device a terminal runs on: `{ platform: web | android | ios, model, appVersion, name }`. Also the body of
/// POST /v1/pos/pair's `device`.
class PosDeviceDescription {
  const PosDeviceDescription({required this.platform, this.model, this.appVersion, this.name});
  final String platform;
  final String? model;
  final String? appVersion;
  final String? name;

  static String? _short(String? s) {
    final t = s?.trim();
    if (t == null || t.isEmpty) return null;
    return t.length > 80 ? t.substring(0, 80) : t;
  }

  Map<String, Object?> toJson() => {
        'platform': platform,
        if (_short(model) != null) 'model': _short(model),
        if (_short(appVersion) != null) 'appVersion': _short(appVersion),
        if (_short(name) != null) 'name': _short(name),
      };

  factory PosDeviceDescription.fromJson(Json j) => PosDeviceDescription(
        platform: _str(j['platform']) ?? 'web',
        model: _str(j['model']),
        appVersion: _str(j['appVersion']),
        name: _str(j['name']),
      );
}

/// packages/pos `terminalSchema`.
class PosTerminal {
  const PosTerminal({
    required this.id,
    required this.name,
    required this.role,
    this.branchId,
    this.locationId,
    this.settings = const TerminalSettings(),
    this.paired = false,
    this.device,
    this.pairedAt,
    this.lastSeenAt,
    this.pairingPending = false,
    this.createdAt,
  });

  final String id;

  /// Also the till `register` of this terminal.
  final String name;

  /// `pos` (billing counter) or `weighing` (weighing station).
  final String role;
  final String? branchId;
  final String? locationId;
  final TerminalSettings settings;
  final bool paired;
  final PosDeviceDescription? device;
  final DateTime? pairedAt;
  final DateTime? lastSeenAt;
  final bool pairingPending;
  final DateTime? createdAt;

  bool get isWeighing => role == 'weighing';

  factory PosTerminal.fromJson(Json j) => PosTerminal(
        id: _str(j['id']) ?? '',
        name: _str(j['name']) ?? '',
        role: _str(j['role']) ?? 'pos',
        branchId: _str(j['branchId']),
        locationId: _str(j['locationId']),
        settings: TerminalSettings.fromJson(_map(j['settings'])),
        paired: j['paired'] == true,
        device: j['device'] is Map ? PosDeviceDescription.fromJson(_map(j['device'])) : null,
        pairedAt: _date(j['pairedAt']),
        lastSeenAt: _date(j['lastSeenAt']),
        pairingPending: j['pairingPending'] == true,
        createdAt: _date(j['createdAt']),
      );
}

/// GET /v1/pos/terminals: `{ items, total, limit }` (limit = the plan's terminal limit, null = unlimited).
class PosTerminalList {
  const PosTerminalList({required this.items, required this.total, this.limit});
  final List<PosTerminal> items;
  final int total;
  final int? limit;

  factory PosTerminalList.fromJson(Json j) => PosTerminalList(
        items: _list(j['items']).map(PosTerminal.fromJson).toList(),
        total: _int(j['total']),
        limit: _intOrNull(j['limit']),
      );
}

/// A pairing code: `{ code: "ABCD-2345", expiresAt (15 min), qr: "srikit-pair:1:<apiOrigin>:<code>" }`.
class PosPairing {
  const PosPairing({required this.code, this.expiresAt, required this.qr});
  final String code;
  final DateTime? expiresAt;
  final String qr;

  factory PosPairing.fromJson(Json j) =>
      PosPairing(code: _str(j['code']) ?? '', expiresAt: _date(j['expiresAt']), qr: _str(j['qr']) ?? '');
}

/// The shop a terminal belongs to: `{ id, slug, name, appId }`.
class PosShop {
  const PosShop({required this.id, required this.slug, required this.name, this.appId});
  final String id;
  final String slug;
  final String name;
  final String? appId;

  factory PosShop.fromJson(Json j) =>
      PosShop(id: _str(j['id']) ?? '', slug: _str(j['slug']) ?? '', name: _str(j['name']) ?? '', appId: _str(j['appId']));

  Map<String, Object?> toJson() => {'id': id, 'slug': slug, 'name': name, 'appId': appId};
}

/// POST /v1/pos/pair: `{ deviceToken, terminal, shop }`. Keep [deviceToken] in secure storage.
class PosPairResult {
  const PosPairResult({required this.deviceToken, required this.terminal, required this.shop});
  final String deviceToken;
  final PosTerminal terminal;
  final PosShop shop;

  factory PosPairResult.fromJson(Json j) => PosPairResult(
        deviceToken: _str(j['deviceToken']) ?? '',
        terminal: PosTerminal.fromJson(_map(j['terminal'])),
        shop: PosShop.fromJson(_map(j['shop'])),
      );
}

/// GET /v1/pos/device: `{ terminal, shop, features }` (enabled feature keys of the shop).
class PosDeviceInfo {
  const PosDeviceInfo({required this.terminal, required this.shop, required this.features});
  final PosTerminal terminal;
  final PosShop shop;
  final List<String> features;

  factory PosDeviceInfo.fromJson(Json j) => PosDeviceInfo(
        terminal: PosTerminal.fromJson(_map(j['terminal'])),
        shop: PosShop.fromJson(_map(j['shop'])),
        features: _strings(j['features']),
      );
}

/// POST /v1/pos/session: a PIN session (12 h, no sliding), valid only with this terminal's device token.
class PosPinSession {
  const PosPinSession({
    required this.token,
    this.expiresAt,
    required this.userId,
    this.userName,
    required this.permissions,
    required this.tenantRoles,
  });

  final String token;
  final DateTime? expiresAt;
  final String userId;
  final String? userName;

  /// The member's full permission list (owners / admins `["*"]`).
  final List<String> permissions;
  final List<String> tenantRoles;

  bool expired([DateTime? now]) => expiresAt != null && !expiresAt!.isAfter(now ?? DateTime.now());

  factory PosPinSession.fromJson(Json j) {
    final user = _map(j['user']);
    return PosPinSession(
      token: _str(j['token']) ?? '',
      expiresAt: _date(j['expiresAt']),
      userId: _str(user['id']) ?? '',
      userName: _str(user['name']),
      permissions: _strings(j['permissions']),
      tenantRoles: _strings(j['tenantRoles']),
    );
  }
}

/// GET /v1/pos/staff item: names for the lock screen (never PINs).
class PosStaffEntry {
  const PosStaffEntry({required this.userId, this.name, required this.hasPin});
  final String userId;
  final String? name;
  final bool hasPin;

  factory PosStaffEntry.fromJson(Json j) =>
      PosStaffEntry(userId: _str(j['userId']) ?? '', name: _str(j['name']), hasPin: j['hasPin'] == true);
}

/// `{ items: [...] }` answers (staff, categories).
class PosList<T> {
  const PosList(this.items);
  final List<T> items;

  static PosList<T> fromJson<T>(Json j, T Function(Json) item) => PosList(_list(j['items']).map(item).toList());
}

/// `PosItem.stock`: `{ qty, status: ok | low | out | untracked }`.
class PosItemStock {
  const PosItemStock({required this.qty, required this.status});
  final double qty;
  final String status;

  factory PosItemStock.fromJson(Json j) => PosItemStock(qty: _num(j['qty']), status: _str(j['status']) ?? 'ok');
  Map<String, Object?> toJson() => {'qty': qty, 'status': status};
}

/// packages/pos `posItemSchema`: one sellable item of the POS catalogue.
class PosItem {
  const PosItem({
    required this.itemId,
    this.productId,
    required this.name,
    this.variantTitle = '',
    this.sku,
    this.barcodes = const [],
    this.categoryId,
    required this.price,
    this.mrp,
    required this.taxInclusive,
    required this.gstRate,
    this.hsn,
    this.unit = 'pcs',
    this.soldBy = 'unit',
    this.plu,
    this.image,
    this.stock,
    this.active = true,
    this.updatedAt,
  });

  /// Variant id (or billing item id when the catalogue is off): the bill line's `itemId`.
  final String itemId;
  final String? productId;

  /// "Product – Variant".
  final String name;
  final String variantTitle;
  final String? sku;
  final List<String> barcodes;
  final String? categoryId;

  /// Paise per unit as sold (includes GST when [taxInclusive]).
  final int price;
  final int? mrp;
  final bool taxInclusive;
  final double gstRate;
  final String? hsn;
  final String unit;

  /// `unit` or `weight` (kg / g units, or a by-weight scales PLU).
  final String soldBy;
  final String? plu;
  final String? image;
  final PosItemStock? stock;
  final bool active;
  final DateTime? updatedAt;

  bool get byWeight => soldBy == 'weight';

  factory PosItem.fromJson(Json j) => PosItem(
        itemId: _str(j['itemId']) ?? '',
        productId: _str(j['productId']),
        name: _str(j['name']) ?? '',
        variantTitle: _str(j['variantTitle']) ?? '',
        sku: _str(j['sku']),
        barcodes: _strings(j['barcodes']),
        categoryId: _str(j['categoryId']),
        price: _int(j['price']),
        mrp: _intOrNull(j['mrp']),
        taxInclusive: j['taxInclusive'] == true,
        gstRate: _num(j['gstRate']),
        hsn: _str(j['hsn']),
        unit: _str(j['unit']) ?? 'pcs',
        soldBy: _str(j['soldBy']) == 'weight' ? 'weight' : 'unit',
        plu: _str(j['plu']),
        image: _str(j['image']),
        stock: j['stock'] is Map ? PosItemStock.fromJson(_map(j['stock'])) : null,
        active: j['active'] != false,
        updatedAt: _date(j['updatedAt']),
      );

  /// The same shape as the API (for the device's catalogue file).
  Map<String, Object?> toJson() => {
        'itemId': itemId,
        'productId': productId,
        'name': name,
        'variantTitle': variantTitle,
        'sku': sku,
        'barcodes': barcodes,
        'categoryId': categoryId,
        'price': price,
        'mrp': mrp,
        'taxInclusive': taxInclusive,
        'gstRate': gstRate,
        'hsn': hsn,
        'unit': unit,
        'soldBy': soldBy,
        'plu': plu,
        'image': image,
        'stock': stock?.toJson(),
        'active': active,
        'updatedAt': updatedAt?.toUtc().toIso8601String(),
      };
}

/// GET /v1/pos/catalog page: `{ items, removed, cursor, next, full }`, plus its `ETag`. A 304 (the `If-None-Match`
/// matched) is [notModified] with nothing else set.
class PosCatalogPage {
  const PosCatalogPage({
    this.items = const [],
    this.removed = const [],
    this.cursor = '',
    this.next,
    this.full = false,
    this.etag,
    this.notModified = false,
  });

  final List<PosItem> items;

  /// Item ids removed / archived since `since`.
  final List<String> removed;

  /// Keep for the next delta sync (`since`).
  final String cursor;

  /// Page token for `after`; null on the last page.
  final String? next;

  /// "Replace your cache" (no `since`, or it was too old).
  final bool full;
  final String? etag;
  final bool notModified;

  static const unchanged = PosCatalogPage(notModified: true);

  factory PosCatalogPage.fromJson(Json j, {String? etag}) => PosCatalogPage(
        items: _list(j['items']).map(PosItem.fromJson).toList(),
        removed: _strings(j['removed']),
        cursor: _str(j['cursor']) ?? '',
        next: _str(j['next']),
        full: j['full'] == true,
        etag: etag,
      );
}

/// GET /v1/pos/catalog/categories item.
class PosCategory {
  const PosCategory({required this.id, required this.name, this.parentId, this.position = 0});
  final String id;
  final String name;
  final String? parentId;
  final int position;

  factory PosCategory.fromJson(Json j) =>
      PosCategory(id: _str(j['id']) ?? '', name: _str(j['name']) ?? '', parentId: _str(j['parentId']), position: _int(j['position']));

  Map<String, Object?> toJson() => {'id': id, 'name': name, 'parentId': parentId, 'position': position};
}

/// A weigh-ticket line, priced by the server: [qty] (kg, 3 decimals, or a count), [unitPrice] paise per unit as the
/// catalogue sells it, [amount] paise.
class WeighTicketLine {
  const WeighTicketLine({
    required this.itemId,
    required this.name,
    required this.unit,
    required this.qty,
    required this.unitPrice,
    required this.amount,
    required this.taxInclusive,
    required this.gstRate,
    this.hsn,
    this.tareKg,
  });

  final String itemId;
  final String name;
  final String unit;
  final double qty;
  final int unitPrice;
  final int amount;
  final bool taxInclusive;
  final double gstRate;
  final String? hsn;
  final double? tareKg;

  factory WeighTicketLine.fromJson(Json j) => WeighTicketLine(
        itemId: _str(j['itemId']) ?? '',
        name: _str(j['name']) ?? '',
        unit: _str(j['unit']) ?? 'kg',
        qty: _num(j['qty']),
        unitPrice: _int(j['unitPrice']),
        amount: _int(j['amount']),
        taxInclusive: j['taxInclusive'] == true,
        gstRate: _num(j['gstRate']),
        hsn: _str(j['hsn']),
        tareKg: j['tareKg'] is num ? (j['tareKg'] as num).toDouble() : null,
      );
}

/// packages/pos `weighTicketSchema`. [code] is "W" + 11 digits (the Code 128 text).
class WeighTicket {
  const WeighTicket({
    required this.id,
    required this.code,
    required this.terminalId,
    required this.status,
    required this.lines,
    required this.total,
    this.note,
    this.createdAt,
    this.expiresAt,
    this.usedInvoiceId,
  });

  final String id;
  final String code;
  final String terminalId;

  /// `open`, `used` or `cancelled`.
  final String status;
  final List<WeighTicketLine> lines;
  final int total;
  final String? note;
  final DateTime? createdAt;

  /// End of the IST day it was issued.
  final DateTime? expiresAt;
  final String? usedInvoiceId;

  bool get isOpen => status == 'open';
  bool expired([DateTime? now]) => expiresAt != null && !expiresAt!.isAfter(now ?? DateTime.now());

  factory WeighTicket.fromJson(Json j) => WeighTicket(
        id: _str(j['id']) ?? '',
        code: _str(j['code']) ?? '',
        terminalId: _str(j['terminalId']) ?? '',
        status: _str(j['status']) ?? 'open',
        lines: _list(j['lines']).map(WeighTicketLine.fromJson).toList(),
        total: _int(j['total']),
        note: _str(j['note']),
        createdAt: _date(j['createdAt']),
        expiresAt: _date(j['expiresAt']),
        usedInvoiceId: _str(j['usedInvoiceId']),
      );
}

/// GET /v1/pos/weigh-tickets: `{ items, total }`.
class WeighTicketPage {
  const WeighTicketPage({required this.items, required this.total});
  final List<WeighTicket> items;
  final int total;

  factory WeighTicketPage.fromJson(Json j) =>
      WeighTicketPage(items: _list(j['items']).map(WeighTicket.fromJson).toList(), total: _int(j['total']));
}

/// A line for POST /v1/pos/weigh-tickets. The server prices it; clients never send prices.
class WeighTicketLineInput {
  const WeighTicketLineInput({required this.itemId, this.weightKg, this.qty, this.tareKg});
  final String itemId;

  /// Gross weight in kg (by-weight items).
  final double? weightKg;

  /// Count (count items) or grams for gram-priced items.
  final double? qty;

  /// Omit to use the scale PLU's tare.
  final double? tareKg;

  static num _n(double v) {
    final r = (v * 1000).round() / 1000;
    return r == r.roundToDouble() ? r.toInt() : r;
  }

  Map<String, Object?> toJson() => {
        'itemId': itemId,
        if (weightKg != null) 'weightKg': _n(weightKg!),
        if (qty != null) 'qty': _n(qty!),
        if (tareKg != null) 'tareKg': _n(tareKg!),
      };
}
