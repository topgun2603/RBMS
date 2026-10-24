// The POS catalogue on the device (GET /v1/pos/catalog, docs/pos-terminals.md), with the same rules as the web POS
// (packages/pos-ui/src/lib/catalog-sync.ts): full sync, `since` deltas (changed items + removed ids), paging with
// `next` (later pages send `after` alone), `full: true` replaces the cache, ETag / 304 on the first page. A sync is
// applied only after its last page arrived, so a failure half-way leaves the previous cache as it was.
//
// Storage: one JSON file per shop, read and written in a background isolate (README: 5k items = ~2 MB, ~250 ms to
// load and ~200 ms to save on a desktop AOT build, off the UI thread), so no database plugin is needed; search runs
// over an in-memory index.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:flutter/foundation.dart';
import 'package:srikit_api/srikit_api.dart';

/// What the device holds.
class CatalogSnapshot {
  CatalogSnapshot({Map<String, PosItem>? items, this.categories = const [], this.cursor, this.etag, this.syncedAt})
      : items = items ?? {};

  final Map<String, PosItem> items;
  final List<PosCategory> categories;

  /// For the next delta sync; null = never synced (full).
  final String? cursor;

  /// ETag of the last delta's first page (sent as If-None-Match with the same `since`).
  final String? etag;
  final DateTime? syncedAt;

  bool get isEmpty => items.isEmpty;

  Map<String, Object?> toJson() => {
        'v': 1,
        'cursor': cursor,
        'etag': etag,
        'syncedAt': syncedAt?.toUtc().toIso8601String(),
        'categories': [for (final c in categories) c.toJson()],
        'items': [for (final i in items.values) i.toJson()],
      };

  static CatalogSnapshot? fromJson(Object? json) {
    if (json is! Map || json['v'] != 1) return null;
    final items = <String, PosItem>{};
    for (final raw in (json['items'] as List? ?? const []).whereType<Map>()) {
      final i = PosItem.fromJson(raw.cast<String, dynamic>());
      items[i.itemId] = i;
    }
    return CatalogSnapshot(
      items: items,
      categories: [
        for (final c in (json['categories'] as List? ?? const []).whereType<Map>()) PosCategory.fromJson(c.cast<String, dynamic>()),
      ],
      cursor: json['cursor'] as String?,
      etag: json['etag'] as String?,
      syncedAt: json['syncedAt'] is String ? DateTime.tryParse(json['syncedAt'] as String) : null,
    );
  }
}

/// One sync's result, not yet applied. [replace] = drop everything first (a full sync).
class CatalogChange {
  const CatalogChange({
    required this.replace,
    required this.upserts,
    required this.removes,
    required this.cursor,
    this.etag,
    this.notModified = false,
    this.pages = 0,
  });

  final bool replace;
  final List<PosItem> upserts;
  final List<String> removes;
  final String? cursor;
  final String? etag;

  /// 304 on the first page: nothing changed.
  final bool notModified;
  final int pages;

  bool get changed => replace || upserts.isNotEmpty || removes.isNotEmpty;
}

typedef FetchCatalogPage = Future<PosCatalogPage> Function({String? since, String? after, int? limit, String? etag});

const catalogPageLimit = 1000;

/// A guard against a server that never stops paging.
const _maxPages = 200;

/// Fetches every page of one sync. `since` (and the ETag) on the first page only; later pages carry `after` alone.
Future<CatalogChange> fetchCatalogChange(FetchCatalogPage fetch, {String? cursor, String? etag}) async {
  String? after;
  var replace = false;
  final upserts = <String, PosItem>{};
  final removes = <String>{};
  PosCatalogPage? last;
  String? firstEtag;
  var pages = 0;
  for (var i = 0; i < _maxPages; i++) {
    final page = after != null
        ? await fetch(after: after, limit: catalogPageLimit)
        : await fetch(since: cursor, limit: catalogPageLimit, etag: cursor == null ? null : etag);
    pages++;
    if (i == 0 && page.notModified) {
      return CatalogChange(replace: false, upserts: const [], removes: const [], cursor: cursor, etag: etag, notModified: true, pages: 1);
    }
    if (i == 0) {
      replace = page.full || cursor == null;
      firstEtag = page.etag;
    }
    for (final id in page.removed) {
      removes.add(id);
      upserts.remove(id);
    }
    for (final item in page.items) {
      // Archived / inactive items leave the cache like removed ones.
      if (!item.active) {
        upserts.remove(item.itemId);
        removes.add(item.itemId);
      } else {
        upserts[item.itemId] = item;
        removes.remove(item.itemId);
      }
    }
    last = page;
    if (page.next == null) break;
    after = page.next;
  }
  return CatalogChange(
    replace: replace,
    upserts: upserts.values.toList(),
    removes: replace ? const [] : removes.toList(),
    cursor: last!.cursor.isEmpty ? cursor : last.cursor,
    // The ETag belongs to the first page of `since = <old cursor>`; the next sync asks with the new cursor, so it is
    // only worth keeping when the cursor did not move.
    etag: last.cursor == cursor ? firstEtag : null,
    pages: pages,
  );
}

/// The snapshot after a change (the old one is untouched).
CatalogSnapshot applyCatalogChange(CatalogSnapshot snap, CatalogChange change,
    {List<PosCategory>? categories, required DateTime now}) {
  if (change.notModified) {
    return CatalogSnapshot(
        items: snap.items, categories: categories ?? snap.categories, cursor: snap.cursor, etag: snap.etag, syncedAt: now);
  }
  final items = change.replace ? <String, PosItem>{} : Map.of(snap.items);
  for (final id in change.removes) {
    items.remove(id);
  }
  for (final it in change.upserts) {
    items[it.itemId] = it;
  }
  return CatalogSnapshot(
      items: items, categories: categories ?? snap.categories, cursor: change.cursor, etag: change.etag, syncedAt: now);
}

// ---------------------------------------------------------------- local lookup and search

String _norm(String s) => s.toLowerCase();

/// Lookups over the cached items: barcode (exact), SKU (any case), scales PLU, and a name-sorted search list.
class CatalogIndex {
  CatalogIndex(Iterable<PosItem> items) {
    for (final item in items) {
      if (!item.active) continue;
      for (final b in item.barcodes) {
        final t = b.trim();
        if (t.isNotEmpty) _byBarcode.putIfAbsent(t, () => item);
      }
      final sku = item.sku?.trim();
      if (sku != null && sku.isNotEmpty) _bySku.putIfAbsent(sku.toUpperCase(), () => item);
      final plu = item.plu?.trim();
      if (plu != null && RegExp(r'^\d+$').hasMatch(plu)) _byPlu.putIfAbsent(int.parse(plu).toString(), () => item);
      _list.add((item: item, text: _norm([item.name, item.variantTitle, item.sku ?? '', ...item.barcodes, item.plu ?? ''].join(' '))));
    }
    _list.sort((a, b) {
      final n = a.item.name.toLowerCase().compareTo(b.item.name.toLowerCase());
      return n != 0 ? n : a.item.variantTitle.compareTo(b.item.variantTitle);
    });
  }

  final _byBarcode = <String, PosItem>{};
  final _bySku = <String, PosItem>{};
  final _byPlu = <String, PosItem>{};
  final _list = <({PosItem item, String text})>[];

  int get length => _list.length;

  /// A scanned / typed code: any barcode exactly, else the SKU (any case), else a scales PLU. Null when none.
  PosItem? findByCode(String code) {
    final c = code.trim();
    if (c.isEmpty) return null;
    return _byBarcode[c] ?? _bySku[c.toUpperCase()] ?? findByPlu(c);
  }

  /// By scales PLU (`42`, `00042`).
  PosItem? findByPlu(String plu) {
    final p = plu.trim();
    if (!RegExp(r'^\d{1,9}$').hasMatch(p)) return null;
    return _byPlu[int.parse(p).toString()];
  }

  /// Every word must appear in name / variant / SKU / barcode / PLU. Ranked: barcode match, SKU match, names
  /// starting with the query, then the rest (name order). [categoryId] narrows; [weightFirst] puts by-weight items
  /// first (the weighing station). An empty query lists everything (by category).
  List<PosItem> search(String q, {String? categoryId, int limit = 60, bool weightFirst = false}) {
    final needle = _norm(q.trim());
    final words = needle.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    final barcode = needle.isEmpty ? null : _byBarcode[q.trim()];
    final sku = needle.isEmpty ? null : _bySku[q.trim().toUpperCase()];
    final scored = <({PosItem item, int rank, int i})>[];
    for (var i = 0; i < _list.length; i++) {
      final e = _list[i];
      if (categoryId != null && e.item.categoryId != categoryId) continue;
      if (words.isNotEmpty && !words.every(e.text.contains)) continue;
      var rank = 3;
      if (barcode != null && barcode.itemId == e.item.itemId) {
        rank = 0;
      } else if (sku != null && sku.itemId == e.item.itemId) {
        rank = 1;
      } else if (needle.isNotEmpty && _norm(e.item.name).startsWith(needle)) {
        rank = 2;
      }
      if (weightFirst && !e.item.byWeight) rank += 10;
      scored.add((item: e.item, rank: rank, i: i));
    }
    scored.sort((a, b) => a.rank != b.rank ? a.rank - b.rank : a.i - b.i);
    return [for (final s in scored.take(limit)) s.item];
  }
}

// ---------------------------------------------------------------- storage

abstract interface class CatalogStore {
  Future<CatalogSnapshot?> read();
  Future<void> write(CatalogSnapshot snapshot);
  Future<void> clear();
}

class MemoryCatalogStore implements CatalogStore {
  CatalogSnapshot? saved;
  int writes = 0;

  @override
  Future<CatalogSnapshot?> read() async => saved;
  @override
  Future<void> write(CatalogSnapshot snapshot) async {
    writes++;
    saved = snapshot;
  }

  @override
  Future<void> clear() async => saved = null;
}

/// `<dir>/pos_catalog_<shopId>.json`, written to a temp file and renamed (a crash mid-write keeps the old file).
class JsonFileCatalogStore implements CatalogStore {
  JsonFileCatalogStore(this.directory, String shopId) : file = File('${directory.path}/pos_catalog_${_safe(shopId)}.json');

  final Directory directory;
  final File file;

  static String _safe(String s) => s.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');

  /// Read, decode and parse in a background isolate (a 2 MB decode would drop frames on the UI thread).
  @override
  Future<CatalogSnapshot?> read() {
    final path = file.path;
    return Isolate.run(() {
      try {
        final f = File(path);
        if (!f.existsSync()) return null;
        return CatalogSnapshot.fromJson(jsonDecode(f.readAsStringSync()));
      } catch (_) {
        return null; // corrupt or unreadable: sync again from scratch
      }
    });
  }

  /// Encode and write in a background isolate, to a temp file renamed over the old one. No fsync: the cache can be
  /// rebuilt from the server, and a torn file reads as "no cache".
  @override
  Future<void> write(CatalogSnapshot snapshot) {
    final path = file.path;
    final dir = directory.path;
    return Isolate.run(() {
      Directory(dir).createSync(recursive: true);
      final tmp = File('$path.tmp')..writeAsStringSync(jsonEncode(snapshot.toJson()));
      tmp.renameSync(path);
    });
  }

  @override
  Future<void> clear() async {
    try {
      if (await file.exists()) await file.delete();
    } catch (_) {}
  }
}

// ---------------------------------------------------------------- the terminal's catalogue

/// The catalogue a paired terminal bills from: loads the saved snapshot, syncs on open, every [interval] and on
/// pull-to-refresh, and answers searches from memory.
class PosCatalog extends ChangeNotifier {
  PosCatalog({required this.api, required this.store, this.interval = const Duration(minutes: 5), DateTime Function()? now})
      : _now = now ?? DateTime.now;

  final SrikitApi api;
  final CatalogStore store;
  final Duration interval;
  final DateTime Function() _now;

  CatalogSnapshot snapshot = CatalogSnapshot();
  CatalogIndex _index = CatalogIndex(const []);
  CatalogIndex get index => _index;
  bool syncing = false;
  Object? lastError;
  CatalogChange? lastChange;
  Timer? _timer;
  Future<void>? _running;
  bool _disposed = false;

  bool get ready => !snapshot.isEmpty;
  int get count => snapshot.items.length;
  List<PosCategory> get categories => snapshot.categories;

  Future<void> load() async {
    final saved = await store.read();
    if (saved != null) _set(saved);
  }

  void _set(CatalogSnapshot s) {
    snapshot = s;
    _index = CatalogIndex(s.items.values);
    if (!_disposed) notifyListeners();
  }

  /// One sync round (concurrent calls share it). Errors are kept in [lastError], not thrown, unless [rethrowErrors].
  Future<void> sync({bool rethrowErrors = false}) {
    final running = _running ??= _sync().whenComplete(() => _running = null);
    return rethrowErrors ? running.then((_) {
      if (lastError != null) throw lastError!;
    }) : running;
  }

  Future<void> _sync() async {
    syncing = true;
    if (!_disposed) notifyListeners();
    try {
      final change = await fetchCatalogChange(
        ({since, after, limit, etag}) => api.posCatalog(since: since, after: after, limit: limit, etag: etag),
        cursor: snapshot.cursor,
        etag: snapshot.etag,
      );
      List<PosCategory>? categories;
      try {
        categories = await api.posCategories();
      } on ApiException {
        categories = null; // keep the old ones
      }
      final next = applyCatalogChange(snapshot, change, categories: categories, now: _now());
      lastChange = change;
      lastError = null;
      final categoriesChanged = categories != null && !_sameCategories(categories, snapshot.categories);
      if (change.changed || categoriesChanged) {
        _set(next);
        try {
          await store.write(next);
        } catch (_) {
          // A full disk: the cache lives in memory for this run.
        }
      } else {
        // Only the cursor / ETag moved: kept in memory (a later write saves it; an old cursor just repeats a delta).
        snapshot = next;
      }
    } catch (e) {
      lastError = e;
    } finally {
      syncing = false;
      if (!_disposed) notifyListeners();
    }
  }

  static bool _sameCategories(List<PosCategory> a, List<PosCategory> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].id != b[i].id || a[i].name != b[i].name || a[i].parentId != b[i].parentId || a[i].position != b[i].position) {
        return false;
      }
    }
    return true;
  }

  void startAutoSync() {
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) => sync());
  }

  void stopAutoSync() {
    _timer?.cancel();
    _timer = null;
  }

  @override
  void dispose() {
    _disposed = true;
    stopAutoSync();
    super.dispose();
  }
}
