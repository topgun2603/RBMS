// Catalogue products and variants, inventory stock and locations, and online / manual orders.
// Shapes from apps/api/openapi.typed.json and the zod schemas in packages/catalogue/src/routes.ts,
// packages/inventory/src/routes.ts and packages/orders/src/routes.ts. Money is paise (int); quantities are doubles.

import 'models.dart';

Json _map(Object? v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
List<Json> _list(Object? v) => v is List ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() : const [];
List<String> _strings(Object? v) => v is List ? v.whereType<String>().toList() : const [];
int _int(Object? v) => v is num ? v.toInt() : 0;
int? _intOrNull(Object? v) => v is num ? v.toInt() : null;
double _num(Object? v) => v is num ? v.toDouble() : 0;
String? _str(Object? v) => v is String ? v : null;
DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;
Map<String, int> _counts(Object? v) => _map(v).map((k, x) => MapEntry(k, _int(x)));

// ================================================================ catalogue

class Category {
  const Category({
    required this.id,
    this.parentId,
    required this.name,
    required this.slug,
    this.description,
    this.imageUrl,
    this.sort = 0,
    this.active = true,
    this.seo,
    this.productCount = 0,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String? parentId;
  final String name;
  final String slug;
  final String? description;
  final String? imageUrl;
  final int sort;
  final bool active;
  final Json? seo;
  final int productCount;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory Category.fromJson(Json j) => Category(
        id: _str(j['id']) ?? '',
        parentId: _str(j['parentId']),
        name: _str(j['name']) ?? '',
        slug: _str(j['slug']) ?? '',
        description: _str(j['description']),
        imageUrl: _str(j['imageUrl']),
        sort: _int(j['sort']),
        active: j['active'] != false,
        seo: j['seo'] is Map ? _map(j['seo']) : null,
        productCount: _int(j['productCount']),
        createdAt: _date(j['createdAt']),
        updatedAt: _date(j['updatedAt']),
      );
}

/// A product row's stock: absent when the shop doesn't track stock, null when no variant is tracked.
class StockBadge {
  const StockBadge({required this.qty, required this.status});
  final double qty;

  /// `ok`, `low` or `out`.
  final String status;

  factory StockBadge.fromJson(Json j) => StockBadge(qty: _num(j['qty']), status: _str(j['status']) ?? 'ok');
}

/// GET /v1/catalog/products row.
class ProductRow {
  const ProductRow({
    required this.id,
    required this.name,
    required this.slug,
    required this.status,
    this.categoryId,
    this.categoryName,
    this.image,
    required this.priceMin,
    required this.priceMax,
    required this.variantCount,
    this.channels = const [],
    this.vendorId,
    this.updatedAt,
    this.stockTracked = false,
    this.stock,
  });

  final String id;
  final String name;
  final String slug;

  /// `active`, `draft` or `archived`.
  final String status;
  final String? categoryId;
  final String? categoryName;
  final String? image;
  final int priceMin;
  final int priceMax;
  final int variantCount;
  final List<String> channels;
  final String? vendorId;
  final DateTime? updatedAt;

  /// The row had a `stock` key: the shop tracks stock. [stock] is then null when no variant is tracked.
  final bool stockTracked;
  final StockBadge? stock;

  factory ProductRow.fromJson(Json j) => ProductRow(
        id: _str(j['id']) ?? '',
        name: _str(j['name']) ?? '',
        slug: _str(j['slug']) ?? '',
        status: _str(j['status']) ?? 'active',
        categoryId: _str(j['categoryId']),
        categoryName: _str(j['categoryName']),
        image: _str(j['image']),
        priceMin: _int(j['priceMin']),
        priceMax: _int(j['priceMax']),
        variantCount: _int(j['variantCount']),
        channels: _strings(j['channels']),
        vendorId: _str(j['vendorId']),
        updatedAt: _date(j['updatedAt']),
        stockTracked: j.containsKey('stock'),
        stock: j['stock'] is Map ? StockBadge.fromJson(_map(j['stock'])) : null,
      );
}

/// A variant inside a product (GET /v1/catalog/products/:id `variants`, POST/PATCH variant answers).
class ProductVariant {
  const ProductVariant({
    required this.id,
    required this.productId,
    this.sku,
    this.barcode,
    required this.title,
    this.optionValues = const {},
    required this.price,
    this.mrp,
    this.cost,
    this.weightGrams,
    this.position = 0,
    this.isDefault = false,
  });

  final String id;
  final String productId;
  final String? sku;
  final String? barcode;
  final String title;
  final Json optionValues;

  /// As sold (includes GST when the product is tax-inclusive).
  final int price;
  final int? mrp;
  final int? cost;
  final int? weightGrams;
  final int position;
  final bool isDefault;

  factory ProductVariant.fromJson(Json j) => ProductVariant(
        id: _str(j['id']) ?? '',
        productId: _str(j['productId']) ?? '',
        sku: _str(j['sku']),
        barcode: _str(j['barcode']),
        title: _str(j['title']) ?? '',
        optionValues: _map(j['optionValues']),
        price: _int(j['price']),
        mrp: _intOrNull(j['mrp']),
        cost: _intOrNull(j['cost']),
        weightGrams: _intOrNull(j['weightGrams']),
        position: _int(j['position']),
        isDefault: j['isDefault'] == true,
      );
}

/// GET /v1/catalog/products/:id (also the create / update answer).
class Product {
  const Product({
    required this.id,
    required this.name,
    required this.slug,
    this.description,
    this.brand,
    this.categoryId,
    this.hsn,
    required this.gstRate,
    required this.unit,
    required this.taxInclusive,
    required this.status,
    this.channels = const [],
    this.tags = const [],
    this.attributes = const {},
    this.options = const [],
    this.images = const [],
    this.seo,
    this.vendorId,
    this.variants = const [],
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String name;
  final String slug;
  final String? description;
  final String? brand;
  final String? categoryId;
  final String? hsn;
  final double gstRate;
  final String unit;
  final bool taxInclusive;
  final String status;
  final List<String> channels;
  final List<String> tags;
  final Json attributes;

  /// Option definitions (`{ name, values }`), raw.
  final List<Json> options;

  /// `{ url, alt }`, raw.
  final List<Json> images;
  final Json? seo;
  final String? vendorId;
  final List<ProductVariant> variants;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get archived => status == 'archived';

  factory Product.fromJson(Json j) => Product(
        id: _str(j['id']) ?? '',
        name: _str(j['name']) ?? '',
        slug: _str(j['slug']) ?? '',
        description: _str(j['description']),
        brand: _str(j['brand']),
        categoryId: _str(j['categoryId']),
        hsn: _str(j['hsn']),
        gstRate: _num(j['gstRate']),
        unit: _str(j['unit']) ?? 'pcs',
        taxInclusive: j['taxInclusive'] == true,
        status: _str(j['status']) ?? 'active',
        channels: _strings(j['channels']),
        tags: _strings(j['tags']),
        attributes: _map(j['attributes']),
        options: _list(j['options']),
        images: _list(j['images']),
        seo: j['seo'] is Map ? _map(j['seo']) : null,
        vendorId: _str(j['vendorId']),
        variants: _list(j['variants']).map(ProductVariant.fromJson).toList(),
        createdAt: _date(j['createdAt']),
        updatedAt: _date(j['updatedAt']),
      );
}

// ================================================================ inventory

/// GET /v1/inventory/stock row (and the adjust / get / patch answers). [itemId] is the variant id.
class StockItem {
  const StockItem({
    required this.itemId,
    required this.name,
    required this.unit,
    this.hsn,
    required this.qty,
    required this.reorderLevel,
    required this.track,
    this.avgCost,
    required this.value,
    required this.status,
    this.updatedAt,
    required this.reserved,
    required this.available,
    this.locationId,
    this.categoryId,
    this.categoryName,
  });

  final String itemId;
  final String name;
  final String unit;
  final String? hsn;
  final double qty;
  final double reorderLevel;
  final bool track;
  final int? avgCost;

  /// Stock value at average cost (paise).
  final int value;

  /// `ok`, `low` or `out`.
  final String status;
  final DateTime? updatedAt;
  final double reserved;
  final double available;
  final String? locationId;
  final String? categoryId;
  final String? categoryName;

  factory StockItem.fromJson(Json j) => StockItem(
        itemId: _str(j['itemId']) ?? '',
        name: _str(j['name']) ?? '',
        unit: _str(j['unit']) ?? 'pcs',
        hsn: _str(j['hsn']),
        qty: _num(j['qty']),
        reorderLevel: _num(j['reorderLevel']),
        track: j['track'] == true,
        avgCost: _intOrNull(j['avgCost']),
        value: _int(j['value']),
        status: _str(j['status']) ?? 'ok',
        updatedAt: _date(j['updatedAt']),
        reserved: _num(j['reserved']),
        available: _num(j['available']),
        locationId: _str(j['locationId']),
        categoryId: _str(j['categoryId']),
        categoryName: _str(j['categoryName']),
      );
}

/// GET /v1/inventory/stock: rows plus totals and the category filter list.
class StockPage {
  const StockPage({
    required this.items,
    required this.total,
    this.limit,
    this.offset,
    required this.stockValue,
    required this.lowCount,
    required this.outCount,
    this.facets = const {},
    this.categories = const [],
  });

  final List<StockItem> items;
  final int total;
  final int? limit;
  final int? offset;
  final int stockValue;
  final int lowCount;
  final int outCount;
  final Json facets;
  final List<({String id, String name})> categories;

  factory StockPage.fromJson(Json j) {
    final totals = _map(j['totals']);
    return StockPage(
      items: _list(j['items']).map(StockItem.fromJson).toList(),
      total: _int(j['total']),
      limit: _intOrNull(j['limit']),
      offset: _intOrNull(j['offset']),
      stockValue: _int(totals['stockValue']),
      lowCount: _int(totals['lowCount']),
      outCount: _int(totals['outCount']),
      facets: _map(j['facets']),
      categories: _list(j['categories']).map((c) => (id: _str(c['id']) ?? '', name: _str(c['name']) ?? '')).toList(),
    );
  }
}

/// A stock movement (GET /v1/inventory/stock/:itemId/movements).
class StockMovement {
  const StockMovement({
    required this.id,
    required this.date,
    required this.reason,
    required this.delta,
    required this.qtyAfter,
    this.refType,
    this.refId,
    this.refNumber,
    this.note,
    this.createdBy,
    this.locationId,
  });

  final String id;
  final String date;

  /// `opening`, `adjustment`, `sale`, `sale_cancel`, `sale_return`, `sale_return_cancel`, `purchase`,
  /// `purchase_cancel`, `transfer_out`, `transfer_in`.
  final String reason;
  final double delta;
  final double qtyAfter;
  final String? refType;
  final String? refId;

  /// Bill / order number behind the movement.
  final String? refNumber;
  final String? note;
  final String? createdBy;
  final String? locationId;

  factory StockMovement.fromJson(Json j) => StockMovement(
        id: _str(j['id']) ?? '',
        date: _str(j['date']) ?? '',
        reason: _str(j['reason']) ?? 'adjustment',
        delta: _num(j['delta']),
        qtyAfter: _num(j['qtyAfter']),
        refType: _str(j['refType']),
        refId: _str(j['refId']),
        refNumber: _str(j['refNumber']),
        note: _str(j['note']),
        createdBy: _str(j['createdBy']),
        locationId: _str(j['locationId']),
      );
}

/// GET /v1/inventory/locations row (stores and warehouses).
class StockLocation {
  const StockLocation({
    required this.id,
    required this.name,
    required this.code,
    required this.type,
    this.address,
    this.isDefault = false,
    this.active = true,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String name;
  final String code;

  /// `store` or `warehouse`.
  final String type;
  final String? address;
  final bool isDefault;
  final bool active;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory StockLocation.fromJson(Json j) => StockLocation(
        id: _str(j['id']) ?? '',
        name: _str(j['name']) ?? '',
        code: _str(j['code']) ?? '',
        type: _str(j['type']) ?? 'store',
        address: _str(j['address']),
        isDefault: j['isDefault'] == true,
        active: j['active'] != false,
        createdAt: _date(j['createdAt']),
        updatedAt: _date(j['updatedAt']),
      );
}

/// GET /v1/inventory/summary.
class StockSummary {
  const StockSummary({required this.stockValue, required this.lowCount, required this.outCount, this.lowItems = const []});
  final int stockValue;
  final int lowCount;
  final int outCount;
  final List<StockItem> lowItems;

  factory StockSummary.fromJson(Json j) => StockSummary(
        stockValue: _int(j['stockValue']),
        lowCount: _int(j['lowCount']),
        outCount: _int(j['outCount']),
        lowItems: _list(j['lowItems']).map(StockItem.fromJson).toList(),
      );
}

// ================================================================ orders

/// GET /v1/orders row.
class OrderRow {
  const OrderRow({
    required this.id,
    required this.number,
    required this.channel,
    required this.status,
    required this.paymentStatus,
    required this.paymentMethod,
    required this.customerName,
    this.customerPhone,
    required this.itemCount,
    required this.total,
    required this.paid,
    this.branchId,
    this.placedAt,
  });

  final String id;
  final String number;

  /// `store`, `manual`, `pos` or `marketplace`.
  final String channel;

  /// `placed`, `confirmed`, `packed`, `shipped`, `delivered`, `cancelled`, `returned`.
  final String status;

  /// `unpaid`, `pending`, `paid`, `cod`, `refunded`, `partially_refunded`.
  final String paymentStatus;

  /// `online`, `cod`, `cash`, `upi`, `card`, `other`.
  final String paymentMethod;
  final String customerName;
  final String? customerPhone;
  final int itemCount;
  final int total;
  final int paid;
  final String? branchId;
  final DateTime? placedAt;

  factory OrderRow.fromJson(Json j) => OrderRow(
        id: _str(j['id']) ?? '',
        number: _str(j['number']) ?? '',
        channel: _str(j['channel']) ?? 'store',
        status: _str(j['status']) ?? 'placed',
        paymentStatus: _str(j['paymentStatus']) ?? 'unpaid',
        paymentMethod: _str(j['paymentMethod']) ?? 'other',
        customerName: _str(j['customerName']) ?? '',
        customerPhone: _str(j['customerPhone']),
        itemCount: _int(j['itemCount']),
        total: _int(j['total']),
        paid: _int(j['paid']),
        branchId: _str(j['branchId']),
        placedAt: _date(j['placedAt']),
      );
}

/// GET /v1/orders: rows plus the count per status (for the chips).
class OrderPage {
  const OrderPage({required this.items, required this.total, this.limit, this.offset, this.counts = const {}, this.facets = const {}});
  final List<OrderRow> items;
  final int total;
  final int? limit;
  final int? offset;

  /// Orders per status (all statuses, regardless of the status filter).
  final Map<String, int> counts;
  final Json facets;

  factory OrderPage.fromJson(Json j) => OrderPage(
        items: _list(j['items']).map(OrderRow.fromJson).toList(),
        total: _int(j['total']),
        limit: _intOrNull(j['limit']),
        offset: _intOrNull(j['offset']),
        counts: _counts(j['counts']),
        facets: _map(j['facets']),
      );
}

/// GET /v1/orders/summary.
class OrderSummary {
  const OrderSummary({
    required this.todayCount,
    required this.todayTotal,
    required this.pending,
    required this.monthCount,
    required this.monthTotal,
  });

  final int todayCount;
  final int todayTotal;

  /// Open orders by status: `placed` (new), `confirmed`, `packed`.
  final Map<String, int> pending;
  final int monthCount;
  final int monthTotal;

  /// Orders waiting to be confirmed.
  int get newOrders => pending['placed'] ?? 0;

  factory OrderSummary.fromJson(Json j) {
    final today = _map(j['today']);
    final month = _map(j['month']);
    return OrderSummary(
      todayCount: _int(today['count']),
      todayTotal: _int(today['total']),
      pending: _counts(j['pending']),
      monthCount: _int(month['count']),
      monthTotal: _int(month['total']),
    );
  }
}

class OrderCustomer {
  const OrderCustomer({required this.name, this.phone, this.email, this.customerId, this.accountId, this.locale});
  final String name;
  final String? phone;
  final String? email;
  final String? customerId;
  final String? accountId;
  final String? locale;

  factory OrderCustomer.fromJson(Json j) => OrderCustomer(
        name: _str(j['name']) ?? '',
        phone: _str(j['phone']),
        email: _str(j['email']),
        customerId: _str(j['customerId']),
        accountId: _str(j['accountId']),
        locale: _str(j['locale']),
      );
}

class OrderAddress {
  const OrderAddress({
    this.name,
    this.phone,
    required this.line1,
    this.line2,
    this.landmark,
    required this.city,
    this.district,
    required this.stateCode,
    required this.pincode,
    required this.country,
  });

  final String? name;
  final String? phone;
  final String line1;
  final String? line2;
  final String? landmark;
  final String city;
  final String? district;
  final String stateCode;
  final String pincode;
  final String country;

  /// Printable lines.
  List<String> get lines => [
        if (name != null && name!.isNotEmpty) name!,
        line1,
        if (line2 != null && line2!.isNotEmpty) line2!,
        if (landmark != null && landmark!.isNotEmpty) landmark!,
        [city, if (district != null && district!.isNotEmpty) district!, pincode].join(', '),
        if (phone != null && phone!.isNotEmpty) phone!,
      ];

  factory OrderAddress.fromJson(Json j) => OrderAddress(
        name: _str(j['name']),
        phone: _str(j['phone']),
        line1: _str(j['line1']) ?? '',
        line2: _str(j['line2']),
        landmark: _str(j['landmark']),
        city: _str(j['city']) ?? '',
        district: _str(j['district']),
        stateCode: _str(j['stateCode']) ?? '',
        pincode: _str(j['pincode']) ?? '',
        country: _str(j['country']) ?? 'IN',
      );
}

class OrderLine {
  const OrderLine({
    required this.variantId,
    required this.productId,
    required this.name,
    this.sku,
    this.image,
    required this.qty,
    required this.unit,
    required this.price,
    required this.rate,
    required this.gstRate,
    this.hsn,
    required this.taxInclusive,
    required this.discount,
    required this.amount,
    required this.taxable,
    required this.cgst,
    required this.sgst,
    required this.igst,
    required this.total,
  });

  final String variantId;
  final String productId;
  final String name;
  final String? sku;
  final String? image;
  final double qty;
  final String unit;
  final int price;
  final int rate;
  final double gstRate;
  final String? hsn;
  final bool taxInclusive;
  final int discount;
  final int amount;
  final int taxable;
  final int cgst;
  final int sgst;
  final int igst;
  final int total;

  factory OrderLine.fromJson(Json j) => OrderLine(
        variantId: _str(j['variantId']) ?? '',
        productId: _str(j['productId']) ?? '',
        name: _str(j['name']) ?? '',
        sku: _str(j['sku']),
        image: _str(j['image']),
        qty: _num(j['qty']),
        unit: _str(j['unit']) ?? 'pcs',
        price: _int(j['price']),
        rate: _int(j['rate']),
        gstRate: _num(j['gstRate']),
        hsn: _str(j['hsn']),
        taxInclusive: j['taxInclusive'] == true,
        discount: _int(j['discount']),
        amount: _int(j['amount']),
        taxable: _int(j['taxable']),
        cgst: _int(j['cgst']),
        sgst: _int(j['sgst']),
        igst: _int(j['igst']),
        total: _int(j['total']),
      );
}

/// The server's order totals.
class OrderTotals {
  const OrderTotals({
    required this.subtotal,
    required this.discount,
    this.loyaltyPoints,
    this.loyaltyDiscount,
    required this.shipping,
    required this.shippingWaived,
    this.shippingLine,
    this.codFee = 0,
    this.codFeeLine,
    required this.taxable,
    required this.cgst,
    required this.sgst,
    required this.igst,
    required this.roundOff,
    required this.total,
    this.taxBreakup = const [],
    required this.sellerState,
    required this.placeOfSupply,
    required this.interState,
    this.offers = const [],
    this.offerDiscount = 0,
  });

  final int subtotal;
  final int discount;

  /// Automatic offers applied (`{ id, kind, name, label, ... }`), raw.
  final List<Json> offers;

  /// Paise taken off by [offers].
  final int offerDiscount;
  final int? loyaltyPoints;
  final int? loyaltyDiscount;
  final int shipping;
  final int shippingWaived;

  /// The shipping charge as a bill line, raw.
  final Json? shippingLine;
  final int codFee;

  /// The COD fee as a bill line, raw.
  final Json? codFeeLine;
  final int taxable;
  final int cgst;
  final int sgst;
  final int igst;
  final int roundOff;
  final int total;

  /// `{ gstRate, taxable, cgst, sgst, igst }`, raw.
  final List<Json> taxBreakup;
  final String sellerState;
  final String placeOfSupply;
  final bool interState;

  factory OrderTotals.fromJson(Json j) {
    final loyalty = j['loyalty'] is Map ? _map(j['loyalty']) : null;
    return OrderTotals(
      subtotal: _int(j['subtotal']),
      discount: _int(j['discount']),
      loyaltyPoints: loyalty == null ? null : _int(loyalty['points']),
      loyaltyDiscount: loyalty == null ? null : _int(loyalty['discount']),
      shipping: _int(j['shipping']),
      shippingWaived: _int(j['shippingWaived']),
      shippingLine: j['shippingLine'] is Map ? _map(j['shippingLine']) : null,
      codFee: _int(j['codFee']),
      codFeeLine: j['codFeeLine'] is Map ? _map(j['codFeeLine']) : null,
      taxable: _int(j['taxable']),
      cgst: _int(j['cgst']),
      sgst: _int(j['sgst']),
      igst: _int(j['igst']),
      roundOff: _int(j['roundOff']),
      total: _int(j['total']),
      taxBreakup: _list(j['taxBreakup']),
      sellerState: _str(j['sellerState']) ?? '',
      placeOfSupply: _str(j['placeOfSupply']) ?? '',
      interState: j['interState'] == true,
      offers: _list(j['offers']),
      offerDiscount: _int(j['offerDiscount']),
    );
  }
}

class Fulfillment {
  const Fulfillment({this.carrier, this.trackingNumber, this.trackingUrl, this.shipmentId});
  final String? carrier;
  final String? trackingNumber;
  final String? trackingUrl;
  final String? shipmentId;

  bool get isEmpty => [carrier, trackingNumber, trackingUrl, shipmentId].every((v) => v == null || v.isEmpty);

  factory Fulfillment.fromJson(Json j) => Fulfillment(
        carrier: _str(j['carrier']),
        trackingNumber: _str(j['trackingNumber']),
        trackingUrl: _str(j['trackingUrl']),
        shipmentId: _str(j['shipmentId']),
      );

  Map<String, Object?> toJson() => {
        if (carrier != null) 'carrier': carrier,
        if (trackingNumber != null) 'trackingNumber': trackingNumber,
        if (trackingUrl != null) 'trackingUrl': trackingUrl,
        if (shipmentId != null) 'shipmentId': shipmentId,
      };
}

/// An order timeline entry.
class OrderEvent {
  const OrderEvent({
    required this.id,
    required this.type,
    this.fromStatus,
    this.toStatus,
    this.message,
    this.actorUserId,
    this.data = const {},
    this.createdAt,
  });

  final String id;

  /// `status`, `payment`, `note`, `fulfillment` or `refund`.
  final String type;
  final String? fromStatus;
  final String? toStatus;
  final String? message;
  final String? actorUserId;
  final Json data;
  final DateTime? createdAt;

  factory OrderEvent.fromJson(Json j) => OrderEvent(
        id: _str(j['id']) ?? '',
        type: _str(j['type']) ?? 'note',
        fromStatus: _str(j['fromStatus']),
        toStatus: _str(j['toStatus']),
        message: _str(j['message']),
        actorUserId: _str(j['actorUserId']),
        data: _map(j['data']),
        createdAt: _date(j['createdAt']),
      );
}

/// GET /v1/orders/:id (and the answer of every order action).
class Order {
  const Order({
    required this.id,
    required this.number,
    required this.channel,
    required this.status,
    required this.paymentStatus,
    required this.paymentMethod,
    required this.customer,
    this.shippingAddress,
    this.billingAddress,
    this.lines = const [],
    required this.totals,
    required this.total,
    required this.paid,
    required this.refunded,
    required this.balance,
    this.currency = 'INR',
    this.fulfillment = const Fulfillment(),
    this.stockState = 'none',
    this.couponCode,
    this.invoiceId,
    this.invoiceNumber,
    this.locationId,
    this.branchId,
    this.notes,
    this.customerNote,
    this.cancelReason,
    this.accessToken = '',
    this.placedAt,
    this.confirmedAt,
    this.shippedAt,
    this.deliveredAt,
    this.cancelledAt,
    this.createdAt,
    this.updatedAt,
    this.events = const [],
    this.nextStatuses = const [],
  });

  final String id;
  final String number;
  final String channel;
  final String status;
  final String paymentStatus;
  final String paymentMethod;
  final OrderCustomer customer;
  final OrderAddress? shippingAddress;
  final OrderAddress? billingAddress;
  final List<OrderLine> lines;
  final OrderTotals totals;
  final int total;
  final int paid;
  final int refunded;
  final int balance;
  final String currency;
  final Fulfillment fulfillment;

  /// `none`, `reserved`, `committed`, `released` or `returned`.
  final String stockState;
  final String? couponCode;
  final String? invoiceId;
  final String? invoiceNumber;
  final String? locationId;
  final String? branchId;
  final String? notes;
  final String? customerNote;
  final String? cancelReason;

  /// Customer-facing order link token (not used by the app).
  final String accessToken;
  final DateTime? placedAt;
  final DateTime? confirmedAt;
  final DateTime? shippedAt;
  final DateTime? deliveredAt;
  final DateTime? cancelledAt;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final List<OrderEvent> events;

  /// The statuses the server allows next (the source of truth for the action buttons).
  final List<String> nextStatuses;

  bool get isCod => paymentMethod == 'cod';

  /// Payments recorded on the order. The API has no payments list: they are `payment` events with
  /// `data { amount, method, reference, date, source: manual | cod }`.
  List<({int amount, String method, String? reference, String? date, String source, DateTime? at})> get payments => [
        for (final e in events)
          if (e.type == 'payment')
            (
              amount: _int(e.data['amount']),
              method: _str(e.data['method']) ?? 'other',
              reference: _str(e.data['reference']),
              date: _str(e.data['date']),
              source: _str(e.data['source']) ?? 'manual',
              at: e.createdAt,
            ),
      ];

  /// Refunded so far is [refunded]; what may still be refunded.
  int get refundable => paid - refunded;

  factory Order.fromJson(Json j) => Order(
        id: _str(j['id']) ?? '',
        number: _str(j['number']) ?? '',
        channel: _str(j['channel']) ?? 'store',
        status: _str(j['status']) ?? 'placed',
        paymentStatus: _str(j['paymentStatus']) ?? 'unpaid',
        paymentMethod: _str(j['paymentMethod']) ?? 'other',
        customer: OrderCustomer.fromJson(_map(j['customer'])),
        shippingAddress: j['shippingAddress'] is Map ? OrderAddress.fromJson(_map(j['shippingAddress'])) : null,
        billingAddress: j['billingAddress'] is Map ? OrderAddress.fromJson(_map(j['billingAddress'])) : null,
        lines: _list(j['lines']).map(OrderLine.fromJson).toList(),
        totals: OrderTotals.fromJson(_map(j['totals'])),
        total: _int(j['total']),
        paid: _int(j['paid']),
        refunded: _int(j['refunded']),
        balance: _int(j['balance']),
        currency: _str(j['currency']) ?? 'INR',
        fulfillment: Fulfillment.fromJson(_map(j['fulfillment'])),
        stockState: _str(j['stockState']) ?? 'none',
        couponCode: _str(j['couponCode']),
        invoiceId: _str(j['invoiceId']),
        invoiceNumber: _str(j['invoiceNumber']),
        locationId: _str(j['locationId']),
        branchId: _str(j['branchId']),
        notes: _str(j['notes']),
        customerNote: _str(j['customerNote']),
        cancelReason: _str(j['cancelReason']),
        accessToken: _str(j['accessToken']) ?? '',
        placedAt: _date(j['placedAt']),
        confirmedAt: _date(j['confirmedAt']),
        shippedAt: _date(j['shippedAt']),
        deliveredAt: _date(j['deliveredAt']),
        cancelledAt: _date(j['cancelledAt']),
        createdAt: _date(j['createdAt']),
        updatedAt: _date(j['updatedAt']),
        events: _list(j['events']).map(OrderEvent.fromJson).toList(),
        nextStatuses: _strings(j['nextStatuses']),
      );
}
