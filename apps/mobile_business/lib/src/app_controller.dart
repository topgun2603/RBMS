import 'package:flutter/widgets.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';
import 'package:srikit_theme/srikit_theme.dart';

import 'books/books_actions.dart';
import 'config.dart';
import 'counter/counter_controller.dart';
import 'links.dart';
import 'orders/order_actions.dart';
import 'pos/catalog.dart';
import 'pos/terminal_controller.dart';

/// Where the app is. The root widget shows one screen per stage.
/// [updateRequired] is sticky: once the API says this version is too old, nothing else can move the app on until
/// [start] runs again (the "Check again" button).
/// [terminal]: this phone is (or is being set up as) a POS terminal; [TerminalController.phase] says which screen.
enum AppStage { starting, restoreFailed, updateRequired, signedOut, pickingShop, openingShop, ready, terminal }

/// App-wide state: session, shops, the open shop and the language. Screens read it through [AppScope] and call its
/// methods; it notifies listeners on every change.
class AppController extends ChangeNotifier {
  AppController({
    required this.api,
    required this.session,
    PushRegistrar? push,
    CatalogStoreFactory? catalogStoreFor,
    this.now = DateTime.now,
  })
      : push = push ?? PushRegistrar(api, NoPushTokenSource(clientPlatform ?? 'android')),
        catalogStoreFor = catalogStoreFor ?? ((_) async => MemoryCatalogStore()) {
    auth = AuthRepository(api: api, session: session, push: this.push);
    shopsRepo = ShopRepository(api: api, session: session);
    // A 426 app_update_required from any request, anywhere in the app, lands on the update screen.
    api.client.onUpdateRequired = (e) => _updateRequired(e.minVersion);
    api.client.onUnauthorized = (e) {
      if (stage == AppStage.terminal) terminal?.unauthorized(e);
    };
  }

  /// The clock (tests replace it to run PIN lockouts and session expiry).
  final DateTime Function() now;

  /// Where a terminal keeps its catalogue (a JSON file per shop on devices; memory in tests).
  final CatalogStoreFactory catalogStoreFor;

  /// Set while the phone is in terminal mode.
  TerminalController? terminal;
  String? _counterUser;

  /// Model / OS text sent with POST /pos/pair (main.dart fills it on devices).
  String? deviceModel;

  void _terminalChanged() {
    final t = terminal;
    if (t == null) return;
    final ctx = t.shopContext();
    if (ctx != null) {
      // A different cashier gets a fresh counter (cart, keys); the same one comes back to their cart.
      if (_counterUser != ctx.me.user.id) _dropCounter();
      _counterUser = ctx.me.user.id;
      shop = ctx;
    } else if (t.phase == TerminalPhase.unpaired) {
      _dropCounter();
      _counterUser = null;
      shop = null;
    }
    notifyListeners();
  }

  Future<void> _enterTerminal() async {
    terminal?.removeListener(_terminalChanged);
    terminal?.dispose();
    final t = TerminalController(
      api: api,
      session: session,
      buildOrigin: api.client.baseUri.toString(),
      catalogStoreFor: catalogStoreFor,
      platform: clientPlatform ?? 'android',
      appVersion: appVersion,
      deviceModel: deviceModel,
      now: now,
    )..addListener(_terminalChanged);
    terminal = t;
    _dropCounter();
    shop = null;
    me = null;
    _set(AppStage.terminal);
    await t.start();
  }

  /// Sign-in → "Use this phone as a POS terminal".
  Future<void> useAsTerminal() => _enterTerminal();

  /// Pairing → "Sign in as owner or staff instead" (only while not paired).
  Future<void> leaveTerminalMode() async {
    final t = terminal;
    if (t != null && t.phase != TerminalPhase.unpaired) return;
    t?.removeListener(_terminalChanged);
    t?.dispose();
    terminal = null;
    await _signedOut();
  }

  final SrikitApi api;
  final SessionStore session;
  final PushRegistrar push;
  late final AuthRepository auth;
  late final ShopRepository shopsRepo;

  AppStage stage = AppStage.starting;
  Me? me;
  List<Membership> shops = const [];
  ShopContext? shop;

  /// The shop being opened (for the "Opening …" screen).
  Membership? opening;

  /// The last error to show on the current screen (cleared on the next action).
  Object? error;
  AuthClientConfig? authConfig;
  Locale locale = const Locale('en');

  /// GET /v1/mobile/config from the last start (null when it could not be loaded).
  MobileConfig? mobileConfig;

  /// The minimum version the API asked for (update screen).
  String? requiredVersion;
  bool _updateBannerDismissed = false;

  /// A newer version is in the store and the user hasn't dismissed the banner this run.
  bool get showUpdateBanner => (mobileConfig?.updateAvailable ?? false) && !_updateBannerDismissed;

  void dismissUpdateBanner() {
    _updateBannerDismissed = true;
    notifyListeners();
  }

  void _updateRequired(String? minVersion) {
    requiredVersion = minVersion ?? requiredVersion;
    stage = AppStage.updateRequired;
    error = null;
    opening = null;
    notifyListeners();
  }

  /// Brand tokens in effect: the shop's once one is open, the platform defaults before.
  BrandTokens get tokens => shop?.tokens ?? srikitDefaultTokens;

  Gates get gates => shop?.gates ?? Gates.none;

  CounterController? _counter;

  /// The open shop's counter (cart, till, bill in progress). Kept while the shop is open, so switching tabs keeps the
  /// cart; a new one per shop.
  CounterController counter() {
    final s = shop;
    if (s == null) throw StateError('No shop is open');
    final t = stage == AppStage.terminal ? terminal : null;
    return _counter ??= (CounterController(
      api: api,
      session: session,
      gates: s.gates,
      actorName: s.me.user.name,
      catalog: t?.catalog,
      fixedRegister: t?.terminal?.name,
    )..init());
  }

  OrdersWatcher? _ordersWatcher;
  OrderActions? _orderActions;

  /// How often the Orders tab polls for new orders (until push arrives). Tests shorten it.
  Duration ordersPollInterval = const Duration(seconds: 60);

  /// New-order count for the Orders tab badge (per shop).
  OrdersWatcher ordersWatcher() => _ordersWatcher ??= OrdersWatcher(api, interval: ordersPollInterval);

  /// Order writes with idempotency keys (per shop).
  OrderActions orderActions() => _orderActions ??= OrderActions(api, session);

  ActionKeys? _catalogKeys;

  /// Idempotency keys for product and stock writes (per shop).
  ActionKeys catalogKeys() => _catalogKeys ??= ActionKeys(session);

  BooksActions? _books;

  /// Customer, credit-book and expense writes with idempotency keys (per shop).
  BooksActions booksActions() => _books ??= BooksActions(api, session);

  /// Opens WhatsApp / the dialer. Tests replace it to see the URL.
  UrlOpener openUrl = openExternal;

  /// Drops everything kept for the open shop (counter, order watcher / keys).
  void _dropCounter() {
    _counter?.dispose();
    _counter = null;
    _ordersWatcher?.dispose();
    _ordersWatcher = null;
    _orderActions = null;
    _catalogKeys = null;
    _books = null;
  }

  void _set(AppStage s, {Object? error}) {
    // Requests that were in flight when a 426 arrived must not leave the update screen.
    if (stage == AppStage.updateRequired && s != AppStage.starting) return;
    stage = s;
    this.error = error;
    notifyListeners();
  }

  /// Splash: language, app version check, then the saved session, then the shop.
  Future<void> start() async {
    _set(AppStage.starting);
    final saved = await session.locale();
    if (saved != null && supportedLanguageCodes.contains(saved)) {
      locale = Locale(saved);
      api.client.locale = saved;
    }
    try {
      mobileConfig = await api.mobileConfig();
    } on ApiException {
      // Offline or an older API without /mobile/config: carry on; a 426 later still lands on the update screen.
      mobileConfig = null;
    }
    if (mobileConfig?.updateRequired ?? false) {
      return _updateRequired(mobileConfig!.minVersionFor(clientApp));
    }
    // A paired terminal opens on its lock screen; no owner session is used.
    if (await session.savedTerminal() != null) return _enterTerminal();
    try {
      me = await auth.restore();
    } catch (e) {
      _set(AppStage.restoreFailed, error: e);
      return;
    }
    if (me == null) return _signedOut();
    await _loadShops();
  }

  Future<void> _signedOut() async {
    _dropCounter();
    me = null;
    shop = null;
    shops = const [];
    _set(AppStage.signedOut);
    // Which phone method to use; failure is fine (OTP is the fallback).
    try {
      authConfig = await auth.config();
      notifyListeners();
    } catch (_) {}
  }

  /// The phone sign-in for [phone] (OTP now; Firebase when wired, see `phoneSignInFor`).
  PhoneSignIn phoneSignIn(String phone) => phoneSignInFor(api, authConfig, phone);

  /// After a successful code check.
  Future<void> signedIn(SignInResult result) async {
    await auth.completeSignIn(result);
    me = Me(user: result.user, tenantRoles: const [], permissions: const []);
    await _loadShops();
  }

  Future<void> _loadShops() async {
    try {
      shops = await shopsRepo.myShops();
    } on ApiException catch (e) {
      if (e.isUnauthorized) return _signedOut();
      _set(AppStage.restoreFailed, error: e);
      return;
    }
    final pick = await shopsRepo.autoPick(shops);
    if (pick != null) {
      await openShop(pick);
    } else {
      _set(AppStage.pickingShop);
    }
  }

  /// Reloads the shop list (pull to refresh on the picker).
  Future<void> reloadShops() async {
    try {
      shops = await shopsRepo.myShops();
      _set(AppStage.pickingShop);
    } catch (e) {
      _set(AppStage.pickingShop, error: e);
    }
  }

  Future<void> openShop(Membership m) async {
    opening = m;
    _set(AppStage.openingShop);
    try {
      _dropCounter();
      shop = await shopsRepo.open(m);
      opening = null;
      _set(AppStage.ready);
      await push.register();
    } on ApiException catch (e) {
      opening = null;
      if (e.isUnauthorized) return _signedOut();
      _set(AppStage.pickingShop, error: e);
    }
  }

  /// Back to the picker (More → Switch shop).
  Future<void> switchShop() async {
    _dropCounter();
    shop = null;
    shopsRepo.close();
    await reloadShops();
  }

  Future<void> signOut() async {
    await auth.signOut();
    await _signedOut();
  }

  Future<void> setLanguage(String code) async {
    if (!supportedLanguageCodes.contains(code)) return;
    locale = Locale(code);
    api.client.locale = code;
    notifyListeners();
    await session.saveLocale(code);
  }
}

/// Gives the widget tree the [AppController] and rebuilds dependants when it notifies.
class AppScope extends InheritedNotifier<AppController> {
  const AppScope({super.key, required AppController controller, required super.child}) : super(notifier: controller);

  static AppController of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;

  /// Without subscribing (for callbacks).
  static AppController read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
