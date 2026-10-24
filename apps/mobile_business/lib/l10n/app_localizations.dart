import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_ta.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('ta')
  ];

  /// App name. The brand stays in Latin letters in every language.
  ///
  /// In en, this message translates to:
  /// **'srikit Business'**
  String get appTitle;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Opening…'**
  String get loading;

  /// No description provided for @restoreFailedTitle.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t reach srikit'**
  String get restoreFailedTitle;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get retry;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @signInTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signInTitle;

  /// No description provided for @signInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Enter your mobile number. We\'ll send you a 6-digit code.'**
  String get signInSubtitle;

  /// No description provided for @phoneLabel.
  ///
  /// In en, this message translates to:
  /// **'Mobile number'**
  String get phoneLabel;

  /// No description provided for @phoneInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid 10-digit mobile number'**
  String get phoneInvalid;

  /// No description provided for @emailLabel.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get emailLabel;

  /// No description provided for @useEmail.
  ///
  /// In en, this message translates to:
  /// **'Sign in with email instead'**
  String get useEmail;

  /// No description provided for @usePhone.
  ///
  /// In en, this message translates to:
  /// **'Sign in with mobile number'**
  String get usePhone;

  /// No description provided for @sendCode.
  ///
  /// In en, this message translates to:
  /// **'Send code'**
  String get sendCode;

  /// No description provided for @codeSentTo.
  ///
  /// In en, this message translates to:
  /// **'Enter the code sent to {phone}'**
  String codeSentTo(String phone);

  /// No description provided for @codeLabel.
  ///
  /// In en, this message translates to:
  /// **'6-digit code'**
  String get codeLabel;

  /// No description provided for @codeInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter the 6-digit code'**
  String get codeInvalid;

  /// No description provided for @verifyCode.
  ///
  /// In en, this message translates to:
  /// **'Verify and sign in'**
  String get verifyCode;

  /// No description provided for @changeNumber.
  ///
  /// In en, this message translates to:
  /// **'Change number'**
  String get changeNumber;

  /// No description provided for @resendCode.
  ///
  /// In en, this message translates to:
  /// **'Send the code again'**
  String get resendCode;

  /// No description provided for @codeResent.
  ///
  /// In en, this message translates to:
  /// **'A new code is on its way'**
  String get codeResent;

  /// No description provided for @testNumberHint.
  ///
  /// In en, this message translates to:
  /// **'This is a test number: use the test code.'**
  String get testNumberHint;

  /// No description provided for @errorNetwork.
  ///
  /// In en, this message translates to:
  /// **'No connection to the server. Check your internet and try again.'**
  String get errorNetwork;

  /// No description provided for @errorTimeout.
  ///
  /// In en, this message translates to:
  /// **'The server is taking too long. Try again.'**
  String get errorTimeout;

  /// No description provided for @errorGeneric.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Try again.'**
  String get errorGeneric;

  /// No description provided for @pickShopTitle.
  ///
  /// In en, this message translates to:
  /// **'Choose a shop'**
  String get pickShopTitle;

  /// No description provided for @noShops.
  ///
  /// In en, this message translates to:
  /// **'You\'re not part of any shop yet. Ask the owner to add your number, or start a shop on the srikit website.'**
  String get noShops;

  /// No description provided for @shopSuspended.
  ///
  /// In en, this message translates to:
  /// **'Suspended'**
  String get shopSuspended;

  /// No description provided for @openingShop.
  ///
  /// In en, this message translates to:
  /// **'Opening {shop}…'**
  String openingShop(String shop);

  /// No description provided for @roleOwner.
  ///
  /// In en, this message translates to:
  /// **'Owner'**
  String get roleOwner;

  /// No description provided for @roleAdmin.
  ///
  /// In en, this message translates to:
  /// **'Admin'**
  String get roleAdmin;

  /// No description provided for @roleStaff.
  ///
  /// In en, this message translates to:
  /// **'Staff'**
  String get roleStaff;

  /// No description provided for @roleMember.
  ///
  /// In en, this message translates to:
  /// **'Member'**
  String get roleMember;

  /// No description provided for @tabHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get tabHome;

  /// No description provided for @tabBill.
  ///
  /// In en, this message translates to:
  /// **'Bill'**
  String get tabBill;

  /// No description provided for @tabOrders.
  ///
  /// In en, this message translates to:
  /// **'Orders'**
  String get tabOrders;

  /// No description provided for @tabMore.
  ///
  /// In en, this message translates to:
  /// **'More'**
  String get tabMore;

  /// No description provided for @hello.
  ///
  /// In en, this message translates to:
  /// **'Hello, {name}'**
  String hello(String name);

  /// No description provided for @dashThisMonth.
  ///
  /// In en, this message translates to:
  /// **'This month'**
  String get dashThisMonth;

  /// No description provided for @dashBilled.
  ///
  /// In en, this message translates to:
  /// **'Billed'**
  String get dashBilled;

  /// No description provided for @dashCollected.
  ///
  /// In en, this message translates to:
  /// **'Collected'**
  String get dashCollected;

  /// No description provided for @dashBills.
  ///
  /// In en, this message translates to:
  /// **'Bills'**
  String get dashBills;

  /// No description provided for @dashToCollect.
  ///
  /// In en, this message translates to:
  /// **'To collect'**
  String get dashToCollect;

  /// No description provided for @dashLastMonth.
  ///
  /// In en, this message translates to:
  /// **'Last month {amount}'**
  String dashLastMonth(String amount);

  /// No description provided for @dashOverdue.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No overdue bills} =1{1 overdue bill} other{{count} overdue bills}}'**
  String dashOverdue(int count);

  /// No description provided for @dashRecent.
  ///
  /// In en, this message translates to:
  /// **'Recent bills'**
  String get dashRecent;

  /// No description provided for @dashNoBills.
  ///
  /// In en, this message translates to:
  /// **'No bills yet'**
  String get dashNoBills;

  /// No description provided for @dashDraft.
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get dashDraft;

  /// No description provided for @dashBillingOff.
  ///
  /// In en, this message translates to:
  /// **'Billing isn\'t turned on for this shop.'**
  String get dashBillingOff;

  /// No description provided for @dashNoAccess.
  ///
  /// In en, this message translates to:
  /// **'Ask the shop owner for staff access to see the day\'s numbers.'**
  String get dashNoAccess;

  /// No description provided for @moreShop.
  ///
  /// In en, this message translates to:
  /// **'Shop'**
  String get moreShop;

  /// No description provided for @switchShop.
  ///
  /// In en, this message translates to:
  /// **'Switch shop'**
  String get switchShop;

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @languageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// No description provided for @languageTamil.
  ///
  /// In en, this message translates to:
  /// **'தமிழ்'**
  String get languageTamil;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @signOutConfirm.
  ///
  /// In en, this message translates to:
  /// **'Sign out of srikit Business on this phone?'**
  String get signOutConfirm;

  /// No description provided for @signedInAs.
  ///
  /// In en, this message translates to:
  /// **'Signed in as {name}'**
  String signedInAs(String name);

  /// No description provided for @appVersion.
  ///
  /// In en, this message translates to:
  /// **'Version {version}'**
  String appVersion(String version);

  /// No description provided for @updateRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Update the app'**
  String get updateRequiredTitle;

  /// No description provided for @updateRequiredBody.
  ///
  /// In en, this message translates to:
  /// **'This version of srikit Business is no longer supported. Update it from the store to keep billing and managing your shop.'**
  String get updateRequiredBody;

  /// No description provided for @updateVersions.
  ///
  /// In en, this message translates to:
  /// **'Your version {current} · needed {minimum} or newer'**
  String updateVersions(String current, String minimum);

  /// No description provided for @updateYourVersion.
  ///
  /// In en, this message translates to:
  /// **'Your version {current}'**
  String updateYourVersion(String current);

  /// No description provided for @updateNow.
  ///
  /// In en, this message translates to:
  /// **'Update'**
  String get updateNow;

  /// No description provided for @updateCheckAgain.
  ///
  /// In en, this message translates to:
  /// **'I\'ve updated, check again'**
  String get updateCheckAgain;

  /// No description provided for @updateAvailable.
  ///
  /// In en, this message translates to:
  /// **'A new version of srikit Business is available.'**
  String get updateAvailable;

  /// No description provided for @updateLater.
  ///
  /// In en, this message translates to:
  /// **'Later'**
  String get updateLater;

  /// No description provided for @tillNotOpened.
  ///
  /// In en, this message translates to:
  /// **'Day not opened'**
  String get tillNotOpened;

  /// No description provided for @tillOpenSince.
  ///
  /// In en, this message translates to:
  /// **'Day open · {time}'**
  String tillOpenSince(String time);

  /// No description provided for @tillClosed.
  ///
  /// In en, this message translates to:
  /// **'Day closed'**
  String get tillClosed;

  /// No description provided for @tillOpenDay.
  ///
  /// In en, this message translates to:
  /// **'Open day'**
  String get tillOpenDay;

  /// No description provided for @tillRegister.
  ///
  /// In en, this message translates to:
  /// **'Counter name'**
  String get tillRegister;

  /// No description provided for @tillOpeningCash.
  ///
  /// In en, this message translates to:
  /// **'Cash in the drawer to start (₹)'**
  String get tillOpeningCash;

  /// No description provided for @tillNoPermission.
  ///
  /// In en, this message translates to:
  /// **'You don\'t have permission for the till.'**
  String get tillNoPermission;

  /// No description provided for @tillNotOpenedHint.
  ///
  /// In en, this message translates to:
  /// **'You can bill without opening the day, but those bills won\'t count in the till.'**
  String get tillNotOpenedHint;

  /// No description provided for @tillToday.
  ///
  /// In en, this message translates to:
  /// **'Today (X report)'**
  String get tillToday;

  /// No description provided for @tillCashInOut.
  ///
  /// In en, this message translates to:
  /// **'Cash in / out'**
  String get tillCashInOut;

  /// No description provided for @tillCloseDay.
  ///
  /// In en, this message translates to:
  /// **'Close day'**
  String get tillCloseDay;

  /// No description provided for @tillBills.
  ///
  /// In en, this message translates to:
  /// **'Bills'**
  String get tillBills;

  /// No description provided for @tillSales.
  ///
  /// In en, this message translates to:
  /// **'Sales'**
  String get tillSales;

  /// No description provided for @tillCashExpected.
  ///
  /// In en, this message translates to:
  /// **'Cash expected'**
  String get tillCashExpected;

  /// No description provided for @tillOpening.
  ///
  /// In en, this message translates to:
  /// **'Opening cash'**
  String get tillOpening;

  /// No description provided for @tillOnCredit.
  ///
  /// In en, this message translates to:
  /// **'On credit'**
  String get tillOnCredit;

  /// No description provided for @tillRefunds.
  ///
  /// In en, this message translates to:
  /// **'Refunds'**
  String get tillRefunds;

  /// No description provided for @tillCashNet.
  ///
  /// In en, this message translates to:
  /// **'Cash in/out (net)'**
  String get tillCashNet;

  /// No description provided for @tillCashIn.
  ///
  /// In en, this message translates to:
  /// **'Cash in'**
  String get tillCashIn;

  /// No description provided for @tillCashOut.
  ///
  /// In en, this message translates to:
  /// **'Cash out'**
  String get tillCashOut;

  /// No description provided for @tillAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount (₹)'**
  String get tillAmount;

  /// No description provided for @tillReason.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get tillReason;

  /// No description provided for @tillNoEntries.
  ///
  /// In en, this message translates to:
  /// **'No cash in or out yet'**
  String get tillNoEntries;

  /// No description provided for @tillCounted.
  ///
  /// In en, this message translates to:
  /// **'Cash counted (₹)'**
  String get tillCounted;

  /// No description provided for @tillCountedLabel.
  ///
  /// In en, this message translates to:
  /// **'Counted'**
  String get tillCountedLabel;

  /// No description provided for @tillNote.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get tillNote;

  /// No description provided for @tillDifference.
  ///
  /// In en, this message translates to:
  /// **'Difference'**
  String get tillDifference;

  /// No description provided for @tillMatches.
  ///
  /// In en, this message translates to:
  /// **'Matches'**
  String get tillMatches;

  /// No description provided for @tillExtra.
  ///
  /// In en, this message translates to:
  /// **'Extra {amount}'**
  String tillExtra(String amount);

  /// No description provided for @tillShort.
  ///
  /// In en, this message translates to:
  /// **'Short {amount}'**
  String tillShort(String amount);

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @methodCash.
  ///
  /// In en, this message translates to:
  /// **'Cash'**
  String get methodCash;

  /// No description provided for @methodUpi.
  ///
  /// In en, this message translates to:
  /// **'UPI'**
  String get methodUpi;

  /// No description provided for @methodCard.
  ///
  /// In en, this message translates to:
  /// **'Card'**
  String get methodCard;

  /// No description provided for @methodBank.
  ///
  /// In en, this message translates to:
  /// **'Bank'**
  String get methodBank;

  /// No description provided for @methodCheque.
  ///
  /// In en, this message translates to:
  /// **'Cheque'**
  String get methodCheque;

  /// No description provided for @methodOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get methodOther;

  /// No description provided for @methodCredit.
  ///
  /// In en, this message translates to:
  /// **'On credit'**
  String get methodCredit;

  /// No description provided for @searchItems.
  ///
  /// In en, this message translates to:
  /// **'Search items or type a code'**
  String get searchItems;

  /// No description provided for @scanBarcode.
  ///
  /// In en, this message translates to:
  /// **'Scan barcode'**
  String get scanBarcode;

  /// No description provided for @scanHint.
  ///
  /// In en, this message translates to:
  /// **'Point the camera at a barcode'**
  String get scanHint;

  /// No description provided for @codeNotFound.
  ///
  /// In en, this message translates to:
  /// **'No item for {code}'**
  String codeNotFound(String code);

  /// No description provided for @noResults.
  ///
  /// In en, this message translates to:
  /// **'No items found'**
  String get noResults;

  /// No description provided for @cartEmpty.
  ///
  /// In en, this message translates to:
  /// **'Search or scan to add items'**
  String get cartEmpty;

  /// No description provided for @itemAdded.
  ///
  /// In en, this message translates to:
  /// **'Added {name}'**
  String itemAdded(String name);

  /// No description provided for @remove.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get remove;

  /// No description provided for @editLine.
  ///
  /// In en, this message translates to:
  /// **'Edit line'**
  String get editLine;

  /// No description provided for @qtyLabel.
  ///
  /// In en, this message translates to:
  /// **'Quantity'**
  String get qtyLabel;

  /// No description provided for @priceLabel.
  ///
  /// In en, this message translates to:
  /// **'Price (₹)'**
  String get priceLabel;

  /// No description provided for @priceLocked.
  ///
  /// In en, this message translates to:
  /// **'Changing the price or discount needs the discount permission'**
  String get priceLocked;

  /// No description provided for @discountLabel.
  ///
  /// In en, this message translates to:
  /// **'Discount'**
  String get discountLabel;

  /// No description provided for @discountRupees.
  ///
  /// In en, this message translates to:
  /// **'₹ off'**
  String get discountRupees;

  /// No description provided for @discountPercent.
  ///
  /// In en, this message translates to:
  /// **'% off'**
  String get discountPercent;

  /// No description provided for @apply.
  ///
  /// In en, this message translates to:
  /// **'Apply'**
  String get apply;

  /// No description provided for @serialLabel.
  ///
  /// In en, this message translates to:
  /// **'S/N {serial}'**
  String serialLabel(String serial);

  /// No description provided for @customerTitle.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get customerTitle;

  /// No description provided for @customerNone.
  ///
  /// In en, this message translates to:
  /// **'No customer'**
  String get customerNone;

  /// No description provided for @customerWalkIn.
  ///
  /// In en, this message translates to:
  /// **'Walk-in'**
  String get customerWalkIn;

  /// No description provided for @walkInDefaultName.
  ///
  /// In en, this message translates to:
  /// **'Walk-in Customer'**
  String get walkInDefaultName;

  /// No description provided for @customerSearch.
  ///
  /// In en, this message translates to:
  /// **'Search by mobile or name'**
  String get customerSearch;

  /// No description provided for @customerAdd.
  ///
  /// In en, this message translates to:
  /// **'Add customer'**
  String get customerAdd;

  /// No description provided for @customerName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get customerName;

  /// No description provided for @customerPhoneOptional.
  ///
  /// In en, this message translates to:
  /// **'Mobile (optional)'**
  String get customerPhoneOptional;

  /// No description provided for @customerUseWalkIn.
  ///
  /// In en, this message translates to:
  /// **'Bill as walk-in'**
  String get customerUseWalkIn;

  /// No description provided for @customerClear.
  ///
  /// In en, this message translates to:
  /// **'Remove customer'**
  String get customerClear;

  /// No description provided for @customerOwes.
  ///
  /// In en, this message translates to:
  /// **'Owes {amount}'**
  String customerOwes(String amount);

  /// No description provided for @customerNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a name'**
  String get customerNameRequired;

  /// No description provided for @estimate.
  ///
  /// In en, this message translates to:
  /// **'Estimate'**
  String get estimate;

  /// No description provided for @estimateNote.
  ///
  /// In en, this message translates to:
  /// **'The final total is worked out when the bill is made'**
  String get estimateNote;

  /// No description provided for @itemsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item} other{{count} items}}'**
  String itemsCount(int count);

  /// No description provided for @charge.
  ///
  /// In en, this message translates to:
  /// **'Charge ≈ {amount}'**
  String charge(String amount);

  /// No description provided for @makingBill.
  ///
  /// In en, this message translates to:
  /// **'Making the bill…'**
  String get makingBill;

  /// No description provided for @billNumber.
  ///
  /// In en, this message translates to:
  /// **'Bill {number}'**
  String billNumber(String number);

  /// No description provided for @subtotalLabel.
  ///
  /// In en, this message translates to:
  /// **'Subtotal'**
  String get subtotalLabel;

  /// No description provided for @taxableLabel.
  ///
  /// In en, this message translates to:
  /// **'Taxable value'**
  String get taxableLabel;

  /// No description provided for @cgstLabel.
  ///
  /// In en, this message translates to:
  /// **'CGST'**
  String get cgstLabel;

  /// No description provided for @sgstLabel.
  ///
  /// In en, this message translates to:
  /// **'SGST'**
  String get sgstLabel;

  /// No description provided for @igstLabel.
  ///
  /// In en, this message translates to:
  /// **'IGST'**
  String get igstLabel;

  /// No description provided for @roundOffLabel.
  ///
  /// In en, this message translates to:
  /// **'Round off'**
  String get roundOffLabel;

  /// No description provided for @totalLabel.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get totalLabel;

  /// No description provided for @toPay.
  ///
  /// In en, this message translates to:
  /// **'To pay {amount}'**
  String toPay(String amount);

  /// No description provided for @cashReceived.
  ///
  /// In en, this message translates to:
  /// **'Cash received (₹)'**
  String get cashReceived;

  /// No description provided for @upiAmount.
  ///
  /// In en, this message translates to:
  /// **'UPI (₹)'**
  String get upiAmount;

  /// No description provided for @cardAmount.
  ///
  /// In en, this message translates to:
  /// **'Card (₹)'**
  String get cardAmount;

  /// No description provided for @creditAmount.
  ///
  /// In en, this message translates to:
  /// **'On credit (₹)'**
  String get creditAmount;

  /// No description provided for @upiReceived.
  ///
  /// In en, this message translates to:
  /// **'UPI payment received'**
  String get upiReceived;

  /// No description provided for @referenceOptional.
  ///
  /// In en, this message translates to:
  /// **'Reference (optional)'**
  String get referenceOptional;

  /// No description provided for @changeDue.
  ///
  /// In en, this message translates to:
  /// **'Change {amount}'**
  String changeDue(String amount);

  /// No description provided for @shortBy.
  ///
  /// In en, this message translates to:
  /// **'Short by {amount}'**
  String shortBy(String amount);

  /// No description provided for @problemOverNonCash.
  ///
  /// In en, this message translates to:
  /// **'UPI, card and credit can\'t be more than the bill'**
  String get problemOverNonCash;

  /// No description provided for @problemUpiUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'Confirm that the UPI payment was received'**
  String get problemUpiUnconfirmed;

  /// No description provided for @problemCreditNeedsCustomer.
  ///
  /// In en, this message translates to:
  /// **'Credit needs a saved customer'**
  String get problemCreditNeedsCustomer;

  /// No description provided for @problemCreditUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The credit book isn\'t on for this shop'**
  String get problemCreditUnavailable;

  /// No description provided for @completePayment.
  ///
  /// In en, this message translates to:
  /// **'Complete'**
  String get completePayment;

  /// No description provided for @paymentFailed.
  ///
  /// In en, this message translates to:
  /// **'A payment couldn\'t be recorded.'**
  String get paymentFailed;

  /// No description provided for @finishWithout.
  ///
  /// In en, this message translates to:
  /// **'Finish without it'**
  String get finishWithout;

  /// No description provided for @leaveBillTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this bill?'**
  String get leaveBillTitle;

  /// No description provided for @leaveBillBody.
  ///
  /// In en, this message translates to:
  /// **'The bill is already made. Cancel it, or stay and take the payment.'**
  String get leaveBillBody;

  /// No description provided for @cancelBill.
  ///
  /// In en, this message translates to:
  /// **'Cancel bill'**
  String get cancelBill;

  /// No description provided for @stay.
  ///
  /// In en, this message translates to:
  /// **'Stay'**
  String get stay;

  /// No description provided for @saleComplete.
  ///
  /// In en, this message translates to:
  /// **'Sale complete'**
  String get saleComplete;

  /// No description provided for @giveChange.
  ///
  /// In en, this message translates to:
  /// **'Give change'**
  String get giveChange;

  /// No description provided for @addedToCredit.
  ///
  /// In en, this message translates to:
  /// **'{amount} added to the customer\'s credit'**
  String addedToCredit(String amount);

  /// No description provided for @paymentsMissing.
  ///
  /// In en, this message translates to:
  /// **'The bill is saved, but {amount} of payments couldn\'t be recorded. Add them from the bill on the web.'**
  String paymentsMissing(String amount);

  /// No description provided for @creditLimitWarning.
  ///
  /// In en, this message translates to:
  /// **'This customer is now over their credit limit.'**
  String get creditLimitWarning;

  /// No description provided for @shareWhatsApp.
  ///
  /// In en, this message translates to:
  /// **'Share on WhatsApp'**
  String get shareWhatsApp;

  /// No description provided for @shareText.
  ///
  /// In en, this message translates to:
  /// **'Bill {number} for {amount}: {url}'**
  String shareText(String number, String amount, String url);

  /// No description provided for @couldNotOpenWhatsApp.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open WhatsApp'**
  String get couldNotOpenWhatsApp;

  /// No description provided for @printReceipt.
  ///
  /// In en, this message translates to:
  /// **'Print'**
  String get printReceipt;

  /// No description provided for @printPreviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Receipt preview'**
  String get printPreviewTitle;

  /// No description provided for @printComingNext.
  ///
  /// In en, this message translates to:
  /// **'Bluetooth printers come next. This is what will print.'**
  String get printComingNext;

  /// No description provided for @newBill.
  ///
  /// In en, this message translates to:
  /// **'New bill'**
  String get newBill;

  /// No description provided for @closeLabel.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get closeLabel;

  /// No description provided for @orderStatusPlaced.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get orderStatusPlaced;

  /// No description provided for @orderStatusConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get orderStatusConfirmed;

  /// No description provided for @orderStatusPacked.
  ///
  /// In en, this message translates to:
  /// **'Packed'**
  String get orderStatusPacked;

  /// No description provided for @orderStatusShipped.
  ///
  /// In en, this message translates to:
  /// **'Shipped'**
  String get orderStatusShipped;

  /// No description provided for @orderStatusDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get orderStatusDelivered;

  /// No description provided for @orderStatusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get orderStatusCancelled;

  /// No description provided for @orderStatusReturned.
  ///
  /// In en, this message translates to:
  /// **'Returned'**
  String get orderStatusReturned;

  /// No description provided for @orderActionConfirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get orderActionConfirm;

  /// No description provided for @orderActionPack.
  ///
  /// In en, this message translates to:
  /// **'Mark packed'**
  String get orderActionPack;

  /// No description provided for @orderActionShip.
  ///
  /// In en, this message translates to:
  /// **'Mark shipped'**
  String get orderActionShip;

  /// No description provided for @orderActionDeliver.
  ///
  /// In en, this message translates to:
  /// **'Mark delivered'**
  String get orderActionDeliver;

  /// No description provided for @orderActionCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel order'**
  String get orderActionCancel;

  /// No description provided for @orderActionReturn.
  ///
  /// In en, this message translates to:
  /// **'Mark returned'**
  String get orderActionReturn;

  /// No description provided for @paymentPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get paymentPaid;

  /// No description provided for @paymentCod.
  ///
  /// In en, this message translates to:
  /// **'COD'**
  String get paymentCod;

  /// No description provided for @paymentPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get paymentPending;

  /// No description provided for @paymentRefunded.
  ///
  /// In en, this message translates to:
  /// **'Refunded'**
  String get paymentRefunded;

  /// No description provided for @paymentPartRefunded.
  ///
  /// In en, this message translates to:
  /// **'Part refunded'**
  String get paymentPartRefunded;

  /// No description provided for @paymentUnpaid.
  ///
  /// In en, this message translates to:
  /// **'Unpaid'**
  String get paymentUnpaid;

  /// No description provided for @channelStore.
  ///
  /// In en, this message translates to:
  /// **'Online store'**
  String get channelStore;

  /// No description provided for @channelManual.
  ///
  /// In en, this message translates to:
  /// **'Manual'**
  String get channelManual;

  /// No description provided for @channelPos.
  ///
  /// In en, this message translates to:
  /// **'Counter'**
  String get channelPos;

  /// No description provided for @channelMarketplace.
  ///
  /// In en, this message translates to:
  /// **'Marketplace'**
  String get channelMarketplace;

  /// No description provided for @ordersAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get ordersAll;

  /// No description provided for @ordersSearch.
  ///
  /// In en, this message translates to:
  /// **'Search orders'**
  String get ordersSearch;

  /// No description provided for @ordersEmpty.
  ///
  /// In en, this message translates to:
  /// **'No orders'**
  String get ordersEmpty;

  /// No description provided for @orderTitle.
  ///
  /// In en, this message translates to:
  /// **'Order {number}'**
  String orderTitle(String number);

  /// No description provided for @orderItems.
  ///
  /// In en, this message translates to:
  /// **'Items'**
  String get orderItems;

  /// No description provided for @shipToLabel.
  ///
  /// In en, this message translates to:
  /// **'Ship to'**
  String get shipToLabel;

  /// No description provided for @customerNoteLabel.
  ///
  /// In en, this message translates to:
  /// **'Customer note'**
  String get customerNoteLabel;

  /// No description provided for @orderShipping.
  ///
  /// In en, this message translates to:
  /// **'Shipping'**
  String get orderShipping;

  /// No description provided for @orderCodFee.
  ///
  /// In en, this message translates to:
  /// **'COD fee'**
  String get orderCodFee;

  /// No description provided for @orderPaidLabel.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get orderPaidLabel;

  /// No description provided for @orderBalance.
  ///
  /// In en, this message translates to:
  /// **'Balance due'**
  String get orderBalance;

  /// No description provided for @orderPayments.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get orderPayments;

  /// No description provided for @orderNoPayments.
  ///
  /// In en, this message translates to:
  /// **'No payments yet'**
  String get orderNoPayments;

  /// No description provided for @orderTimeline.
  ///
  /// In en, this message translates to:
  /// **'Timeline'**
  String get orderTimeline;

  /// No description provided for @orderShipment.
  ///
  /// In en, this message translates to:
  /// **'Shipment'**
  String get orderShipment;

  /// No description provided for @carrierLabel.
  ///
  /// In en, this message translates to:
  /// **'Courier'**
  String get carrierLabel;

  /// No description provided for @trackingNumberLabel.
  ///
  /// In en, this message translates to:
  /// **'Tracking number'**
  String get trackingNumberLabel;

  /// No description provided for @trackingUrlLabel.
  ///
  /// In en, this message translates to:
  /// **'Tracking link'**
  String get trackingUrlLabel;

  /// No description provided for @trackingUrlInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a link starting with http:// or https://'**
  String get trackingUrlInvalid;

  /// No description provided for @shipTitle.
  ///
  /// In en, this message translates to:
  /// **'Ship the order'**
  String get shipTitle;

  /// No description provided for @cancelOrderTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel the order?'**
  String get cancelOrderTitle;

  /// No description provided for @cancelReasonRequired.
  ///
  /// In en, this message translates to:
  /// **'Give a reason'**
  String get cancelReasonRequired;

  /// No description provided for @cancelReasonCustomer.
  ///
  /// In en, this message translates to:
  /// **'Customer asked'**
  String get cancelReasonCustomer;

  /// No description provided for @cancelReasonStock.
  ///
  /// In en, this message translates to:
  /// **'Out of stock'**
  String get cancelReasonStock;

  /// No description provided for @cancelReasonPayment.
  ///
  /// In en, this message translates to:
  /// **'Payment problem'**
  String get cancelReasonPayment;

  /// No description provided for @cancelReasonDuplicate.
  ///
  /// In en, this message translates to:
  /// **'Duplicate order'**
  String get cancelReasonDuplicate;

  /// No description provided for @cancelReasonAddress.
  ///
  /// In en, this message translates to:
  /// **'Address problem'**
  String get cancelReasonAddress;

  /// No description provided for @keepOrder.
  ///
  /// In en, this message translates to:
  /// **'Keep order'**
  String get keepOrder;

  /// No description provided for @returnTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark the order returned?'**
  String get returnTitle;

  /// No description provided for @returnBody.
  ///
  /// In en, this message translates to:
  /// **'The items go back into stock and the invoice is cancelled. Record any refund on the web.'**
  String get returnBody;

  /// No description provided for @skipTo.
  ///
  /// In en, this message translates to:
  /// **'Skip to'**
  String get skipTo;

  /// No description provided for @recordPayment.
  ///
  /// In en, this message translates to:
  /// **'Record payment'**
  String get recordPayment;

  /// No description provided for @orderPayAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount up to {amount}'**
  String orderPayAmountInvalid(String amount);

  /// No description provided for @makeInvoice.
  ///
  /// In en, this message translates to:
  /// **'Make invoice'**
  String get makeInvoice;

  /// No description provided for @invoiceLabel.
  ///
  /// In en, this message translates to:
  /// **'Invoice {number}'**
  String invoiceLabel(String number);

  /// No description provided for @codDeliverNote.
  ///
  /// In en, this message translates to:
  /// **'Marking it delivered records the COD balance as paid.'**
  String get codDeliverNote;

  /// No description provided for @orderChanged.
  ///
  /// In en, this message translates to:
  /// **'This order changed meanwhile. Showing the latest.'**
  String get orderChanged;

  /// No description provided for @eventStatus.
  ///
  /// In en, this message translates to:
  /// **'Moved to {status}'**
  String eventStatus(String status);

  /// No description provided for @eventPayment.
  ///
  /// In en, this message translates to:
  /// **'Payment {amount} · {method}'**
  String eventPayment(String amount, String method);

  /// No description provided for @eventRefund.
  ///
  /// In en, this message translates to:
  /// **'Refund {amount}'**
  String eventRefund(String amount);

  /// No description provided for @eventFulfillment.
  ///
  /// In en, this message translates to:
  /// **'Shipping details updated'**
  String get eventFulfillment;

  /// No description provided for @productsTitle.
  ///
  /// In en, this message translates to:
  /// **'Products'**
  String get productsTitle;

  /// No description provided for @stockTitle.
  ///
  /// In en, this message translates to:
  /// **'Stock'**
  String get stockTitle;

  /// No description provided for @productNew.
  ///
  /// In en, this message translates to:
  /// **'New product'**
  String get productNew;

  /// No description provided for @productsSearch.
  ///
  /// In en, this message translates to:
  /// **'Search by name, SKU or barcode'**
  String get productsSearch;

  /// No description provided for @allCategories.
  ///
  /// In en, this message translates to:
  /// **'All categories'**
  String get allCategories;

  /// No description provided for @productArchived.
  ///
  /// In en, this message translates to:
  /// **'Archived'**
  String get productArchived;

  /// No description provided for @productDraft.
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get productDraft;

  /// No description provided for @productsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No products'**
  String get productsEmpty;

  /// No description provided for @variantsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 variant} other{{count} variants}}'**
  String variantsCount(int count);

  /// No description provided for @stockNotTracked.
  ///
  /// In en, this message translates to:
  /// **'Not tracked'**
  String get stockNotTracked;

  /// No description provided for @stockOut.
  ///
  /// In en, this message translates to:
  /// **'Out of stock'**
  String get stockOut;

  /// No description provided for @stockLow.
  ///
  /// In en, this message translates to:
  /// **'Low · {qty}'**
  String stockLow(String qty);

  /// No description provided for @stockQty.
  ///
  /// In en, this message translates to:
  /// **'{qty} in stock'**
  String stockQty(String qty);

  /// No description provided for @productArchiveTitle.
  ///
  /// In en, this message translates to:
  /// **'Archive this product?'**
  String get productArchiveTitle;

  /// No description provided for @productArchiveBody.
  ///
  /// In en, this message translates to:
  /// **'It disappears from the store and the counter. You can make it active again later.'**
  String get productArchiveBody;

  /// No description provided for @productArchive.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get productArchive;

  /// No description provided for @productUnarchive.
  ///
  /// In en, this message translates to:
  /// **'Make active'**
  String get productUnarchive;

  /// No description provided for @productTax.
  ///
  /// In en, this message translates to:
  /// **'GST {rate}% · {mode}'**
  String productTax(String rate, String mode);

  /// No description provided for @taxIncluded.
  ///
  /// In en, this message translates to:
  /// **'price includes GST'**
  String get taxIncluded;

  /// No description provided for @taxExtra.
  ///
  /// In en, this message translates to:
  /// **'GST added on top'**
  String get taxExtra;

  /// No description provided for @percentOff.
  ///
  /// In en, this message translates to:
  /// **'{percent}% off'**
  String percentOff(int percent);

  /// No description provided for @skuLabel.
  ///
  /// In en, this message translates to:
  /// **'SKU'**
  String get skuLabel;

  /// No description provided for @barcodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Barcode'**
  String get barcodeLabel;

  /// No description provided for @mrpLabel.
  ///
  /// In en, this message translates to:
  /// **'MRP (₹)'**
  String get mrpLabel;

  /// No description provided for @codeFieldInvalid.
  ///
  /// In en, this message translates to:
  /// **'{field}: up to 64 characters, no spaces'**
  String codeFieldInvalid(String field);

  /// No description provided for @variantsFeatureNeeded.
  ///
  /// In en, this message translates to:
  /// **'Only the price can be changed here: MRP, barcode and SKU need the \"Variants and options\" feature.'**
  String get variantsFeatureNeeded;

  /// No description provided for @qtyInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a quantity'**
  String get qtyInvalid;

  /// No description provided for @qtyDecimals.
  ///
  /// In en, this message translates to:
  /// **'Quantity allows up to 3 decimals'**
  String get qtyDecimals;

  /// No description provided for @qtyMoreThanZero.
  ///
  /// In en, this message translates to:
  /// **'Quantity must be more than 0'**
  String get qtyMoreThanZero;

  /// No description provided for @openingStockFailed.
  ///
  /// In en, this message translates to:
  /// **'The product is saved, but the opening stock wasn\'t.'**
  String get openingStockFailed;

  /// No description provided for @productName.
  ///
  /// In en, this message translates to:
  /// **'Product name'**
  String get productName;

  /// No description provided for @categoryLabel.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get categoryLabel;

  /// No description provided for @noCategory.
  ///
  /// In en, this message translates to:
  /// **'No category'**
  String get noCategory;

  /// No description provided for @priceIncludesGst.
  ///
  /// In en, this message translates to:
  /// **'Price includes GST'**
  String get priceIncludesGst;

  /// No description provided for @gstRateLabel.
  ///
  /// In en, this message translates to:
  /// **'GST rate'**
  String get gstRateLabel;

  /// No description provided for @unitLabel.
  ///
  /// In en, this message translates to:
  /// **'Unit'**
  String get unitLabel;

  /// No description provided for @openingStock.
  ///
  /// In en, this message translates to:
  /// **'Opening stock'**
  String get openingStock;

  /// No description provided for @stockValue.
  ///
  /// In en, this message translates to:
  /// **'Stock value {amount}'**
  String stockValue(String amount);

  /// No description provided for @stockLowOut.
  ///
  /// In en, this message translates to:
  /// **'{low} low · {out} out'**
  String stockLowOut(int low, int out);

  /// No description provided for @stockFilterLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get stockFilterLow;

  /// No description provided for @stockFilterOut.
  ///
  /// In en, this message translates to:
  /// **'Out'**
  String get stockFilterOut;

  /// No description provided for @allLocations.
  ///
  /// In en, this message translates to:
  /// **'All locations'**
  String get allLocations;

  /// No description provided for @stockEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing here'**
  String get stockEmpty;

  /// No description provided for @stockAvailable.
  ///
  /// In en, this message translates to:
  /// **'{available} available · {reserved} reserved for orders'**
  String stockAvailable(String available, String reserved);

  /// No description provided for @stockAdjust.
  ///
  /// In en, this message translates to:
  /// **'Adjust stock'**
  String get stockAdjust;

  /// No description provided for @reorderLevel.
  ///
  /// In en, this message translates to:
  /// **'Low-stock level: {qty}'**
  String reorderLevel(String qty);

  /// No description provided for @avgCost.
  ///
  /// In en, this message translates to:
  /// **'Average cost {cost} · value {value}'**
  String avgCost(String cost, String value);

  /// No description provided for @stockMovements.
  ///
  /// In en, this message translates to:
  /// **'Movements'**
  String get stockMovements;

  /// No description provided for @stockNoMovements.
  ///
  /// In en, this message translates to:
  /// **'No movements yet'**
  String get stockNoMovements;

  /// No description provided for @loadMore.
  ///
  /// In en, this message translates to:
  /// **'Load more'**
  String get loadMore;

  /// No description provided for @moveOpening.
  ///
  /// In en, this message translates to:
  /// **'Opening stock'**
  String get moveOpening;

  /// No description provided for @moveAdjustment.
  ///
  /// In en, this message translates to:
  /// **'Adjustment'**
  String get moveAdjustment;

  /// No description provided for @moveSale.
  ///
  /// In en, this message translates to:
  /// **'Sale'**
  String get moveSale;

  /// No description provided for @moveSaleCancel.
  ///
  /// In en, this message translates to:
  /// **'Sale cancelled'**
  String get moveSaleCancel;

  /// No description provided for @moveSaleReturn.
  ///
  /// In en, this message translates to:
  /// **'Sale return'**
  String get moveSaleReturn;

  /// No description provided for @moveSaleReturnCancel.
  ///
  /// In en, this message translates to:
  /// **'Return cancelled'**
  String get moveSaleReturnCancel;

  /// No description provided for @movePurchase.
  ///
  /// In en, this message translates to:
  /// **'Purchase'**
  String get movePurchase;

  /// No description provided for @movePurchaseCancel.
  ///
  /// In en, this message translates to:
  /// **'Purchase cancelled'**
  String get movePurchaseCancel;

  /// No description provided for @moveTransferOut.
  ///
  /// In en, this message translates to:
  /// **'Transfer out'**
  String get moveTransferOut;

  /// No description provided for @moveTransferIn.
  ///
  /// In en, this message translates to:
  /// **'Transfer in'**
  String get moveTransferIn;

  /// No description provided for @stockNow.
  ///
  /// In en, this message translates to:
  /// **'Now: {qty}'**
  String stockNow(String qty);

  /// No description provided for @stockAfter.
  ///
  /// In en, this message translates to:
  /// **'After: {qty}'**
  String stockAfter(String qty);

  /// No description provided for @adjustAdd.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get adjustAdd;

  /// No description provided for @adjustRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get adjustRemove;

  /// No description provided for @adjustSet.
  ///
  /// In en, this message translates to:
  /// **'Set to'**
  String get adjustSet;

  /// No description provided for @stockNegativeWarning.
  ///
  /// In en, this message translates to:
  /// **'Stock will go below zero.'**
  String get stockNegativeWarning;

  /// No description provided for @balanceDueShort.
  ///
  /// In en, this message translates to:
  /// **'Due'**
  String get balanceDueShort;

  /// No description provided for @balanceAdvanceShort.
  ///
  /// In en, this message translates to:
  /// **'Advance'**
  String get balanceAdvanceShort;

  /// No description provided for @balanceSettledShort.
  ///
  /// In en, this message translates to:
  /// **'Settled'**
  String get balanceSettledShort;

  /// No description provided for @ledgerBalDue.
  ///
  /// In en, this message translates to:
  /// **'due'**
  String get ledgerBalDue;

  /// No description provided for @ledgerBalAdvance.
  ///
  /// In en, this message translates to:
  /// **'adv.'**
  String get ledgerBalAdvance;

  /// No description provided for @ledgerTypeOpening.
  ///
  /// In en, this message translates to:
  /// **'Opening balance'**
  String get ledgerTypeOpening;

  /// No description provided for @ledgerTypeInvoice.
  ///
  /// In en, this message translates to:
  /// **'Bill'**
  String get ledgerTypeInvoice;

  /// No description provided for @ledgerTypePayment.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get ledgerTypePayment;

  /// No description provided for @ledgerTypeReceipt.
  ///
  /// In en, this message translates to:
  /// **'Receipt'**
  String get ledgerTypeReceipt;

  /// No description provided for @ledgerTypeCancel.
  ///
  /// In en, this message translates to:
  /// **'Bill cancelled'**
  String get ledgerTypeCancel;

  /// No description provided for @ledgerTypeCreditNote.
  ///
  /// In en, this message translates to:
  /// **'Credit note'**
  String get ledgerTypeCreditNote;

  /// No description provided for @ledgerTypeRefund.
  ///
  /// In en, this message translates to:
  /// **'Refund'**
  String get ledgerTypeRefund;

  /// No description provided for @ageCurrent.
  ///
  /// In en, this message translates to:
  /// **'Not yet due'**
  String get ageCurrent;

  /// No description provided for @age1to30.
  ///
  /// In en, this message translates to:
  /// **'1–30 days'**
  String get age1to30;

  /// No description provided for @age31to60.
  ///
  /// In en, this message translates to:
  /// **'31–60 days'**
  String get age31to60;

  /// No description provided for @age61to90.
  ///
  /// In en, this message translates to:
  /// **'61–90 days'**
  String get age61to90;

  /// No description provided for @age90plus.
  ///
  /// In en, this message translates to:
  /// **'Over 90 days'**
  String get age90plus;

  /// No description provided for @expenseCatRent.
  ///
  /// In en, this message translates to:
  /// **'Rent'**
  String get expenseCatRent;

  /// No description provided for @expenseCatSalaries.
  ///
  /// In en, this message translates to:
  /// **'Salaries'**
  String get expenseCatSalaries;

  /// No description provided for @expenseCatElectricity.
  ///
  /// In en, this message translates to:
  /// **'Electricity'**
  String get expenseCatElectricity;

  /// No description provided for @expenseCatTransport.
  ///
  /// In en, this message translates to:
  /// **'Transport'**
  String get expenseCatTransport;

  /// No description provided for @expenseCatPackaging.
  ///
  /// In en, this message translates to:
  /// **'Packaging'**
  String get expenseCatPackaging;

  /// No description provided for @expenseCatMarketing.
  ///
  /// In en, this message translates to:
  /// **'Marketing'**
  String get expenseCatMarketing;

  /// No description provided for @expenseCatRepairs.
  ///
  /// In en, this message translates to:
  /// **'Repairs'**
  String get expenseCatRepairs;

  /// No description provided for @expenseCatOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get expenseCatOther;

  /// No description provided for @statementMessageDue.
  ///
  /// In en, this message translates to:
  /// **'Hello {name}, your balance with {shop} is {amount}. See your statement: {url}'**
  String statementMessageDue(
      String name, String shop, String amount, String url);

  /// No description provided for @statementMessageAdvance.
  ///
  /// In en, this message translates to:
  /// **'Hello {name}, you have an advance of {amount} with {shop}. See your statement: {url}'**
  String statementMessageAdvance(
      String name, String shop, String amount, String url);

  /// No description provided for @statementMessageSettled.
  ///
  /// In en, this message translates to:
  /// **'Hello {name}, your account with {shop} is fully settled. Thank you! Statement: {url}'**
  String statementMessageSettled(String name, String shop, String url);

  /// No description provided for @sortLabel.
  ///
  /// In en, this message translates to:
  /// **'Sort'**
  String get sortLabel;

  /// No description provided for @sortBiggestDue.
  ///
  /// In en, this message translates to:
  /// **'Biggest dues first'**
  String get sortBiggestDue;

  /// No description provided for @sortOldestDue.
  ///
  /// In en, this message translates to:
  /// **'Oldest due first'**
  String get sortOldestDue;

  /// No description provided for @sortLastPayment.
  ///
  /// In en, this message translates to:
  /// **'Latest payment first'**
  String get sortLastPayment;

  /// No description provided for @sortName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get sortName;

  /// No description provided for @creditBookTitle.
  ///
  /// In en, this message translates to:
  /// **'Credit book'**
  String get creditBookTitle;

  /// No description provided for @toReceive.
  ///
  /// In en, this message translates to:
  /// **'To receive'**
  String get toReceive;

  /// No description provided for @advanceHeld.
  ///
  /// In en, this message translates to:
  /// **'Advance held'**
  String get advanceHeld;

  /// No description provided for @customersWithDues.
  ///
  /// In en, this message translates to:
  /// **'Customers with dues'**
  String get customersWithDues;

  /// No description provided for @creditBookSearch.
  ///
  /// In en, this message translates to:
  /// **'Search by name or phone'**
  String get creditBookSearch;

  /// No description provided for @overdueFor.
  ///
  /// In en, this message translates to:
  /// **'Overdue for'**
  String get overdueFor;

  /// No description provided for @customersNoMatch.
  ///
  /// In en, this message translates to:
  /// **'No matching customers'**
  String get customersNoMatch;

  /// No description provided for @creditBookNoDues.
  ///
  /// In en, this message translates to:
  /// **'No one owes you. Bills given on credit show up here.'**
  String get creditBookNoDues;

  /// No description provided for @creditBookNoAdvances.
  ///
  /// In en, this message translates to:
  /// **'No advances. Money customers pay ahead of their bills shows up here.'**
  String get creditBookNoAdvances;

  /// No description provided for @creditBookEmpty.
  ///
  /// In en, this message translates to:
  /// **'Your credit book is empty. Add customers and bill them on credit to track what they owe.'**
  String get creditBookEmpty;

  /// No description provided for @dueSince.
  ///
  /// In en, this message translates to:
  /// **'Due since {date}'**
  String dueSince(String date);

  /// No description provided for @lastActivity.
  ///
  /// In en, this message translates to:
  /// **'Last activity {date}'**
  String lastActivity(String date);

  /// No description provided for @noActivity.
  ///
  /// In en, this message translates to:
  /// **'No activity yet'**
  String get noActivity;

  /// No description provided for @overdueAmount.
  ///
  /// In en, this message translates to:
  /// **'{amount} overdue'**
  String overdueAmount(String amount);

  /// No description provided for @receiveFrom.
  ///
  /// In en, this message translates to:
  /// **'Receive payment from {name}'**
  String receiveFrom(String name);

  /// No description provided for @remindName.
  ///
  /// In en, this message translates to:
  /// **'Send a reminder to {name}'**
  String remindName(String name);

  /// No description provided for @remindSent.
  ///
  /// In en, this message translates to:
  /// **'Reminder sent to {name}'**
  String remindSent(String name);

  /// No description provided for @remindFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t send the reminder: {reason}'**
  String remindFailed(String reason);

  /// No description provided for @remindViaWhatsApp.
  ///
  /// In en, this message translates to:
  /// **'Use WhatsApp'**
  String get remindViaWhatsApp;

  /// No description provided for @amountRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount'**
  String get amountRequired;

  /// No description provided for @amountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid amount'**
  String get amountInvalid;

  /// No description provided for @dateNotFuture.
  ///
  /// In en, this message translates to:
  /// **'Pick a date up to today'**
  String get dateNotFuture;

  /// No description provided for @tooLong.
  ///
  /// In en, this message translates to:
  /// **'That is too long'**
  String get tooLong;

  /// No description provided for @receivePayment.
  ///
  /// In en, this message translates to:
  /// **'Receive payment'**
  String get receivePayment;

  /// No description provided for @receiveHint.
  ///
  /// In en, this message translates to:
  /// **'From {name}. It settles the oldest bills first; anything extra is kept as advance.'**
  String receiveHint(String name);

  /// No description provided for @amountReceived.
  ///
  /// In en, this message translates to:
  /// **'Amount received'**
  String get amountReceived;

  /// No description provided for @balanceDueOf.
  ///
  /// In en, this message translates to:
  /// **'Balance due: {amount}'**
  String balanceDueOf(String amount);

  /// No description provided for @alreadyAdvance.
  ///
  /// In en, this message translates to:
  /// **'{name} already has {amount} advance.'**
  String alreadyAdvance(String name, String amount);

  /// No description provided for @dateLabel.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get dateLabel;

  /// No description provided for @noteOptional.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get noteOptional;

  /// No description provided for @saveReceipt.
  ///
  /// In en, this message translates to:
  /// **'Save receipt'**
  String get saveReceipt;

  /// No description provided for @receivedAmount.
  ///
  /// In en, this message translates to:
  /// **'{amount} received'**
  String receivedAmount(String amount);

  /// No description provided for @receivedFrom.
  ///
  /// In en, this message translates to:
  /// **'From {name} on {date}'**
  String receivedFrom(String name, String date);

  /// No description provided for @settledAgainst.
  ///
  /// In en, this message translates to:
  /// **'Settled against'**
  String get settledAgainst;

  /// No description provided for @billNumberShort.
  ///
  /// In en, this message translates to:
  /// **'Bill {number}'**
  String billNumberShort(String number);

  /// No description provided for @noOpenBills.
  ///
  /// In en, this message translates to:
  /// **'There were no open bills, so the whole amount is kept as advance.'**
  String get noOpenBills;

  /// No description provided for @keptAsAdvance.
  ///
  /// In en, this message translates to:
  /// **'Kept as advance'**
  String get keptAsAdvance;

  /// No description provided for @done.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get done;

  /// No description provided for @customersTitle.
  ///
  /// In en, this message translates to:
  /// **'Customers'**
  String get customersTitle;

  /// No description provided for @customersHasDues.
  ///
  /// In en, this message translates to:
  /// **'Has dues'**
  String get customersHasDues;

  /// No description provided for @customersAdd.
  ///
  /// In en, this message translates to:
  /// **'Add customer'**
  String get customersAdd;

  /// No description provided for @customersEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit customer'**
  String get customersEdit;

  /// No description provided for @customersSearch.
  ///
  /// In en, this message translates to:
  /// **'Search by name, phone or GSTIN'**
  String get customersSearch;

  /// No description provided for @customersEmpty.
  ///
  /// In en, this message translates to:
  /// **'No customers yet. Save regular customers to bill them faster and track what they owe.'**
  String get customersEmpty;

  /// No description provided for @customersLastBill.
  ///
  /// In en, this message translates to:
  /// **'Last bill {date}'**
  String customersLastBill(String date);

  /// No description provided for @customersOverLimit.
  ///
  /// In en, this message translates to:
  /// **'Over credit limit'**
  String get customersOverLimit;

  /// No description provided for @couldNotOpen.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open that on this phone'**
  String get couldNotOpen;

  /// No description provided for @customerCall.
  ///
  /// In en, this message translates to:
  /// **'Call'**
  String get customerCall;

  /// No description provided for @shareStatement.
  ///
  /// In en, this message translates to:
  /// **'Share statement'**
  String get shareStatement;

  /// No description provided for @sendReminder.
  ///
  /// In en, this message translates to:
  /// **'Send reminder'**
  String get sendReminder;

  /// No description provided for @ledgerTitle.
  ///
  /// In en, this message translates to:
  /// **'Ledger'**
  String get ledgerTitle;

  /// No description provided for @ledgerOf.
  ///
  /// In en, this message translates to:
  /// **'Ledger · {name}'**
  String ledgerOf(String name);

  /// No description provided for @customerBills.
  ///
  /// In en, this message translates to:
  /// **'Bills'**
  String get customerBills;

  /// No description provided for @customerNoBills.
  ///
  /// In en, this message translates to:
  /// **'No bills for this customer yet.'**
  String get customerNoBills;

  /// No description provided for @customerMoreBills.
  ///
  /// In en, this message translates to:
  /// **'{count} older bills on the web'**
  String customerMoreBills(int count);

  /// No description provided for @billBalance.
  ///
  /// In en, this message translates to:
  /// **'Balance {amount}'**
  String billBalance(String amount);

  /// No description provided for @balanceDue.
  ///
  /// In en, this message translates to:
  /// **'Balance due'**
  String get balanceDue;

  /// No description provided for @balanceAdvance.
  ///
  /// In en, this message translates to:
  /// **'Advance received'**
  String get balanceAdvance;

  /// No description provided for @balanceSettled.
  ///
  /// In en, this message translates to:
  /// **'All settled'**
  String get balanceSettled;

  /// No description provided for @balanceDueHint.
  ///
  /// In en, this message translates to:
  /// **'{name} owes you this amount.'**
  String balanceDueHint(String name);

  /// No description provided for @balanceAdvanceHint.
  ///
  /// In en, this message translates to:
  /// **'{name} has paid this much ahead. It will be used for the next bills.'**
  String balanceAdvanceHint(String name);

  /// No description provided for @balanceSettledHint.
  ///
  /// In en, this message translates to:
  /// **'Nothing pending from {name}.'**
  String balanceSettledHint(String name);

  /// No description provided for @creditLimit.
  ///
  /// In en, this message translates to:
  /// **'Credit limit'**
  String get creditLimit;

  /// No description provided for @creditUsed.
  ///
  /// In en, this message translates to:
  /// **'{used} of {limit} used'**
  String creditUsed(String used, String limit);

  /// No description provided for @creditOver.
  ///
  /// In en, this message translates to:
  /// **'Over the limit by {amount}'**
  String creditOver(String amount);

  /// No description provided for @creditAvailable.
  ///
  /// In en, this message translates to:
  /// **'{amount} still available'**
  String creditAvailable(String amount);

  /// No description provided for @creditLimitHint.
  ///
  /// In en, this message translates to:
  /// **'Leave empty for no limit. You\'ll see a warning when a bill crosses it.'**
  String get creditLimitHint;

  /// No description provided for @customerCreated.
  ///
  /// In en, this message translates to:
  /// **'{name} added'**
  String customerCreated(String name);

  /// No description provided for @customerUpdated.
  ///
  /// In en, this message translates to:
  /// **'Customer updated'**
  String get customerUpdated;

  /// No description provided for @customerFormHint.
  ///
  /// In en, this message translates to:
  /// **'Only the name is required. Add a GSTIN for business buyers.'**
  String get customerFormHint;

  /// No description provided for @requiredField.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get requiredField;

  /// No description provided for @customerPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get customerPhone;

  /// No description provided for @customerEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get customerEmail;

  /// No description provided for @customerAddress.
  ///
  /// In en, this message translates to:
  /// **'Address'**
  String get customerAddress;

  /// No description provided for @emailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email'**
  String get emailInvalid;

  /// No description provided for @gstinInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid 15-character GSTIN'**
  String get gstinInvalid;

  /// No description provided for @openingBalance.
  ///
  /// In en, this message translates to:
  /// **'Opening balance'**
  String get openingBalance;

  /// No description provided for @openingBalanceHint.
  ///
  /// In en, this message translates to:
  /// **'Old balance from before you started billing here.'**
  String get openingBalanceHint;

  /// No description provided for @openingOwes.
  ///
  /// In en, this message translates to:
  /// **'They owe me'**
  String get openingOwes;

  /// No description provided for @openingAdvance.
  ///
  /// In en, this message translates to:
  /// **'Paid in advance'**
  String get openingAdvance;

  /// No description provided for @expensesTitle.
  ///
  /// In en, this message translates to:
  /// **'Expenses'**
  String get expensesTitle;

  /// No description provided for @expenseTitle.
  ///
  /// In en, this message translates to:
  /// **'Expense'**
  String get expenseTitle;

  /// No description provided for @expenseAdd.
  ///
  /// In en, this message translates to:
  /// **'Add expense'**
  String get expenseAdd;

  /// No description provided for @expenseCategories.
  ///
  /// In en, this message translates to:
  /// **'Categories'**
  String get expenseCategories;

  /// No description provided for @periodThisMonth.
  ///
  /// In en, this message translates to:
  /// **'This month'**
  String get periodThisMonth;

  /// No description provided for @periodLastMonth.
  ///
  /// In en, this message translates to:
  /// **'Last month'**
  String get periodLastMonth;

  /// No description provided for @periodThisFy.
  ///
  /// In en, this message translates to:
  /// **'This financial year'**
  String get periodThisFy;

  /// No description provided for @periodCustom.
  ///
  /// In en, this message translates to:
  /// **'Pick dates'**
  String get periodCustom;

  /// No description provided for @periodRange.
  ///
  /// In en, this message translates to:
  /// **'{from} – {to}'**
  String periodRange(String from, String to);

  /// No description provided for @summaryFor.
  ///
  /// In en, this message translates to:
  /// **'Summary for {from} – {to}'**
  String summaryFor(String from, String to);

  /// No description provided for @expensesSpent.
  ///
  /// In en, this message translates to:
  /// **'Spent'**
  String get expensesSpent;

  /// No description provided for @expensesGst.
  ///
  /// In en, this message translates to:
  /// **'GST paid'**
  String get expensesGst;

  /// No description provided for @expensesEntries.
  ///
  /// In en, this message translates to:
  /// **'Entries'**
  String get expensesEntries;

  /// No description provided for @expensesByCategory.
  ///
  /// In en, this message translates to:
  /// **'Spent by category'**
  String get expensesByCategory;

  /// No description provided for @expensesListTotals.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 expense} other{{count} expenses}} · {amount} · GST {gst}'**
  String expensesListTotals(int count, String amount, String gst);

  /// No description provided for @expensesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No expenses in this period. Record rent, salaries and bills here to see your real profit.'**
  String get expensesEmpty;

  /// No description provided for @expenseCancelledBadge.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get expenseCancelledBadge;

  /// No description provided for @expensePickCategory.
  ///
  /// In en, this message translates to:
  /// **'Choose a category'**
  String get expensePickCategory;

  /// No description provided for @expenseCreated.
  ///
  /// In en, this message translates to:
  /// **'Expense of {amount} recorded'**
  String expenseCreated(String amount);

  /// No description provided for @expenseUpdated.
  ///
  /// In en, this message translates to:
  /// **'Expense saved'**
  String get expenseUpdated;

  /// No description provided for @expenseCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel expense'**
  String get expenseCancel;

  /// No description provided for @expenseCancelTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this expense?'**
  String get expenseCancelTitle;

  /// No description provided for @expenseCancelBody.
  ///
  /// In en, this message translates to:
  /// **'It stays on record, marked cancelled, and is left out of totals and the profit report.'**
  String get expenseCancelBody;

  /// No description provided for @expenseCancelled.
  ///
  /// In en, this message translates to:
  /// **'Expense cancelled'**
  String get expenseCancelled;

  /// No description provided for @expenseCancelledHint.
  ///
  /// In en, this message translates to:
  /// **'This expense is cancelled and left out of totals.'**
  String get expenseCancelledHint;

  /// No description provided for @keepIt.
  ///
  /// In en, this message translates to:
  /// **'Keep it'**
  String get keepIt;

  /// No description provided for @expenseAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount'**
  String get expenseAmount;

  /// No description provided for @expenseAmountHint.
  ///
  /// In en, this message translates to:
  /// **'Enter the amount you paid, including GST.'**
  String get expenseAmountHint;

  /// No description provided for @expenseCategory.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get expenseCategory;

  /// No description provided for @expensePaidBy.
  ///
  /// In en, this message translates to:
  /// **'Paid by'**
  String get expensePaidBy;

  /// No description provided for @expenseNoteHint.
  ///
  /// In en, this message translates to:
  /// **'What was it for?'**
  String get expenseNoteHint;

  /// No description provided for @expenseReferenceHint.
  ///
  /// In en, this message translates to:
  /// **'Bill no., UPI ref or cheque no.'**
  String get expenseReferenceHint;

  /// No description provided for @expenseGstInside.
  ///
  /// In en, this message translates to:
  /// **'GST {gst} inside the amount · ITC {itc}'**
  String expenseGstInside(String gst, String itc);

  /// No description provided for @categoriesHint.
  ///
  /// In en, this message translates to:
  /// **'Group your spending. Built-in categories can be renamed but not deleted.'**
  String get categoriesHint;

  /// No description provided for @categoryNew.
  ///
  /// In en, this message translates to:
  /// **'New category name'**
  String get categoryNew;

  /// No description provided for @categoryAdd.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get categoryAdd;

  /// No description provided for @categoryRename.
  ///
  /// In en, this message translates to:
  /// **'Rename'**
  String get categoryRename;

  /// No description provided for @categoryBuiltin.
  ///
  /// In en, this message translates to:
  /// **'Built-in category'**
  String get categoryBuiltin;

  /// No description provided for @categoryDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete the {name} category?'**
  String categoryDeleteTitle(String name);

  /// No description provided for @categoryDeleteBody.
  ///
  /// In en, this message translates to:
  /// **'Only categories with no expenses can be deleted.'**
  String get categoryDeleteBody;

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @ledgerEmpty.
  ///
  /// In en, this message translates to:
  /// **'No entries in this period. Pick a longer date range to see older entries.'**
  String get ledgerEmpty;

  /// No description provided for @ledgerBilled.
  ///
  /// In en, this message translates to:
  /// **'Billed'**
  String get ledgerBilled;

  /// No description provided for @ledgerReceived.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get ledgerReceived;

  /// No description provided for @ledgerClosing.
  ///
  /// In en, this message translates to:
  /// **'Closing balance'**
  String get ledgerClosing;

  /// No description provided for @ledgerBroughtForward.
  ///
  /// In en, this message translates to:
  /// **'Balance as of {date}'**
  String ledgerBroughtForward(String date);

  /// No description provided for @useAsTerminal.
  ///
  /// In en, this message translates to:
  /// **'Use this phone as a POS terminal'**
  String get useAsTerminal;

  /// No description provided for @pairTitle.
  ///
  /// In en, this message translates to:
  /// **'Pair this phone with a terminal'**
  String get pairTitle;

  /// No description provided for @pairSubtitle.
  ///
  /// In en, this message translates to:
  /// **'In srikit on the web, open Settings → POS terminals, pick the terminal and show its pairing code.'**
  String get pairSubtitle;

  /// No description provided for @pairScan.
  ///
  /// In en, this message translates to:
  /// **'Scan the pairing QR'**
  String get pairScan;

  /// No description provided for @pairCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Pairing code'**
  String get pairCodeLabel;

  /// No description provided for @pairButton.
  ///
  /// In en, this message translates to:
  /// **'Pair'**
  String get pairButton;

  /// No description provided for @pairing.
  ///
  /// In en, this message translates to:
  /// **'Pairing…'**
  String get pairing;

  /// No description provided for @pairBackToSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in as owner or staff instead'**
  String get pairBackToSignIn;

  /// No description provided for @pairErrorFormat.
  ///
  /// In en, this message translates to:
  /// **'Enter the 8-character code, like ABCD-2345'**
  String get pairErrorFormat;

  /// No description provided for @pairErrorInvalid.
  ///
  /// In en, this message translates to:
  /// **'This pairing code is wrong or has expired. Ask for a new one.'**
  String get pairErrorInvalid;

  /// No description provided for @pairErrorTooMany.
  ///
  /// In en, this message translates to:
  /// **'Too many tries. Wait a few minutes and try again.'**
  String get pairErrorTooMany;

  /// No description provided for @pairErrorFeatureOff.
  ///
  /// In en, this message translates to:
  /// **'POS terminals are not on for this shop\'s plan.'**
  String get pairErrorFeatureOff;

  /// No description provided for @pairRevoked.
  ///
  /// In en, this message translates to:
  /// **'This phone was unpaired from its terminal. Pair it again.'**
  String get pairRevoked;

  /// No description provided for @terminalOffline.
  ///
  /// In en, this message translates to:
  /// **'Can\'t reach the server. Check the internet and try again.'**
  String get terminalOffline;

  /// No description provided for @terminalFeatureOff.
  ///
  /// In en, this message translates to:
  /// **'This terminal can\'t be used: the feature is off for the shop.'**
  String get terminalFeatureOff;

  /// No description provided for @lockTitle.
  ///
  /// In en, this message translates to:
  /// **'Enter your PIN'**
  String get lockTitle;

  /// No description provided for @shopAndTerminal.
  ///
  /// In en, this message translates to:
  /// **'{shop} · {terminal}'**
  String shopAndTerminal(String shop, String terminal);

  /// No description provided for @unlock.
  ///
  /// In en, this message translates to:
  /// **'Unlock'**
  String get unlock;

  /// No description provided for @pinInvalid.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Wrong PIN.} =1{Wrong PIN. 1 try left.} other{Wrong PIN. {count} tries left.}}'**
  String pinInvalid(int count);

  /// No description provided for @pinWrong.
  ///
  /// In en, this message translates to:
  /// **'Wrong PIN.'**
  String get pinWrong;

  /// No description provided for @pinLocked.
  ///
  /// In en, this message translates to:
  /// **'Too many wrong PINs. Try again in {time}.'**
  String pinLocked(String time);

  /// No description provided for @pinNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'You can\'t use this terminal. Ask the owner for access.'**
  String get pinNotAllowed;

  /// No description provided for @lockedIdle.
  ///
  /// In en, this message translates to:
  /// **'Locked after a while without use.'**
  String get lockedIdle;

  /// No description provided for @sessionEnded.
  ///
  /// In en, this message translates to:
  /// **'Your session ended. Enter your PIN again.'**
  String get sessionEnded;

  /// No description provided for @teamMember.
  ///
  /// In en, this message translates to:
  /// **'Team member'**
  String get teamMember;

  /// No description provided for @noPinYet.
  ///
  /// In en, this message translates to:
  /// **'No PIN yet'**
  String get noPinYet;

  /// No description provided for @pinClear.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get pinClear;

  /// No description provided for @pinBack.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get pinBack;

  /// No description provided for @lockButton.
  ///
  /// In en, this message translates to:
  /// **'Lock'**
  String get lockButton;

  /// No description provided for @switchCashier.
  ///
  /// In en, this message translates to:
  /// **'Switch cashier'**
  String get switchCashier;

  /// No description provided for @cashierLabel.
  ///
  /// In en, this message translates to:
  /// **'Cashier: {name}'**
  String cashierLabel(String name);

  /// No description provided for @terminalSettings.
  ///
  /// In en, this message translates to:
  /// **'Terminal'**
  String get terminalSettings;

  /// No description provided for @syncItems.
  ///
  /// In en, this message translates to:
  /// **'Sync items'**
  String get syncItems;

  /// No description provided for @catalogueStatus.
  ///
  /// In en, this message translates to:
  /// **'{count} items · synced {time}'**
  String catalogueStatus(int count, String time);

  /// No description provided for @catalogueNotSynced.
  ///
  /// In en, this message translates to:
  /// **'Items not synced yet'**
  String get catalogueNotSynced;

  /// No description provided for @catalogueSyncFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not sync items: {error}'**
  String catalogueSyncFailed(String error);

  /// No description provided for @unpairPhone.
  ///
  /// In en, this message translates to:
  /// **'Unpair this phone'**
  String get unpairPhone;

  /// No description provided for @unpairTitle.
  ///
  /// In en, this message translates to:
  /// **'Unpair this phone?'**
  String get unpairTitle;

  /// No description provided for @unpairBody.
  ///
  /// In en, this message translates to:
  /// **'It stops being {terminal}. To use it again, pair it with a new code.'**
  String unpairBody(String terminal);

  /// No description provided for @unpair.
  ///
  /// In en, this message translates to:
  /// **'Unpair'**
  String get unpair;

  /// No description provided for @enterWeightTitle.
  ///
  /// In en, this message translates to:
  /// **'Weight of {item}'**
  String enterWeightTitle(String item);

  /// No description provided for @weightKgLabel.
  ///
  /// In en, this message translates to:
  /// **'Weight (kg)'**
  String get weightKgLabel;

  /// No description provided for @weightInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a weight above 0, up to 999.999 kg'**
  String get weightInvalid;

  /// No description provided for @add.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get add;

  /// No description provided for @ticketAdded.
  ///
  /// In en, this message translates to:
  /// **'Weigh ticket {code} added'**
  String ticketAdded(String code);

  /// No description provided for @ticketNotFound.
  ///
  /// In en, this message translates to:
  /// **'No weigh ticket {code}.'**
  String ticketNotFound(String code);

  /// No description provided for @ticketUsed.
  ///
  /// In en, this message translates to:
  /// **'Ticket {code} is already billed.'**
  String ticketUsed(String code);

  /// No description provided for @ticketExpired.
  ///
  /// In en, this message translates to:
  /// **'Ticket {code} has expired (tickets are valid for the day).'**
  String ticketExpired(String code);

  /// No description provided for @ticketCancelled.
  ///
  /// In en, this message translates to:
  /// **'Ticket {code} was cancelled.'**
  String ticketCancelled(String code);

  /// No description provided for @ticketDuplicate.
  ///
  /// In en, this message translates to:
  /// **'Ticket {code} is already on this bill.'**
  String ticketDuplicate(String code);

  /// No description provided for @ticketEmpty.
  ///
  /// In en, this message translates to:
  /// **'Ticket {code} has no lines.'**
  String ticketEmpty(String code);

  /// No description provided for @ticketLabel.
  ///
  /// In en, this message translates to:
  /// **'Ticket {code}'**
  String ticketLabel(String code);

  /// No description provided for @removeTicketTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove ticket {code}?'**
  String removeTicketTitle(String code);

  /// No description provided for @removeTicketBody.
  ///
  /// In en, this message translates to:
  /// **'All its lines leave the bill.'**
  String get removeTicketBody;

  /// No description provided for @ticketUseFailed.
  ///
  /// In en, this message translates to:
  /// **'Ticket {code} could not be marked as billed: {error}'**
  String ticketUseFailed(String code, String error);

  /// No description provided for @weighingTitle.
  ///
  /// In en, this message translates to:
  /// **'Weighing station'**
  String get weighingTitle;

  /// No description provided for @weighItem.
  ///
  /// In en, this message translates to:
  /// **'Weigh {item}'**
  String weighItem(String item);

  /// No description provided for @countItem.
  ///
  /// In en, this message translates to:
  /// **'How many {item}?'**
  String countItem(String item);

  /// No description provided for @grossLabel.
  ///
  /// In en, this message translates to:
  /// **'Weight on the scale (kg)'**
  String get grossLabel;

  /// No description provided for @tareLabel.
  ///
  /// In en, this message translates to:
  /// **'Tare (kg)'**
  String get tareLabel;

  /// No description provided for @netWeight.
  ///
  /// In en, this message translates to:
  /// **'Net {kg} kg'**
  String netWeight(String kg);

  /// No description provided for @netInvalid.
  ///
  /// In en, this message translates to:
  /// **'Net weight must be more than 0 and at most 999.999 kg'**
  String get netInvalid;

  /// No description provided for @manualScale.
  ///
  /// In en, this message translates to:
  /// **'No scale connected: type the weight.'**
  String get manualScale;

  /// No description provided for @addToTicket.
  ///
  /// In en, this message translates to:
  /// **'Add to ticket'**
  String get addToTicket;

  /// No description provided for @ticketLines.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No lines yet} =1{1 line} other{{count} lines}}'**
  String ticketLines(int count);

  /// No description provided for @issueTicket.
  ///
  /// In en, this message translates to:
  /// **'Issue ticket · ≈ {amount}'**
  String issueTicket(String amount);

  /// No description provided for @issuing.
  ///
  /// In en, this message translates to:
  /// **'Issuing…'**
  String get issuing;

  /// No description provided for @ticketTitle.
  ///
  /// In en, this message translates to:
  /// **'Weigh ticket'**
  String get ticketTitle;

  /// No description provided for @ticketHint.
  ///
  /// In en, this message translates to:
  /// **'Hand this to the customer; the counter scans the code.'**
  String get ticketHint;

  /// No description provided for @printTicket.
  ///
  /// In en, this message translates to:
  /// **'Print ticket'**
  String get printTicket;

  /// No description provided for @nextCustomer.
  ///
  /// In en, this message translates to:
  /// **'Next customer'**
  String get nextCustomer;

  /// No description provided for @todayTickets.
  ///
  /// In en, this message translates to:
  /// **'Today\'s tickets'**
  String get todayTickets;

  /// No description provided for @noTicketsToday.
  ///
  /// In en, this message translates to:
  /// **'No tickets today'**
  String get noTicketsToday;

  /// No description provided for @cancelTicket.
  ///
  /// In en, this message translates to:
  /// **'Cancel ticket'**
  String get cancelTicket;

  /// No description provided for @cancelTicketTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel ticket {code}?'**
  String cancelTicketTitle(String code);

  /// No description provided for @ticketStatusOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get ticketStatusOpen;

  /// No description provided for @ticketStatusUsed.
  ///
  /// In en, this message translates to:
  /// **'Billed'**
  String get ticketStatusUsed;

  /// No description provided for @ticketStatusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get ticketStatusCancelled;

  /// No description provided for @byWeight.
  ///
  /// In en, this message translates to:
  /// **'By weight'**
  String get byWeight;

  /// No description provided for @weighFirst.
  ///
  /// In en, this message translates to:
  /// **'Pick an item to weigh'**
  String get weighFirst;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'ta'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'ta':
      return AppLocalizationsTa();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
