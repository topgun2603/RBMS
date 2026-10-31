// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Tamil (`ta`).
class AppLocalizationsTa extends AppLocalizations {
  AppLocalizationsTa([String locale = 'ta']) : super(locale);

  @override
  String get appTitle => 'RBMS Business';

  @override
  String get loading => 'திறக்கிறது…';

  @override
  String get restoreFailedTitle => 'srikit-ஐ அணுக முடியவில்லை';

  @override
  String get retry => 'மீண்டும் முயற்சிக்கவும்';

  @override
  String get cancel => 'ரத்துசெய்';

  @override
  String get signInTitle => 'உள்நுழைக';

  @override
  String get signInSubtitle =>
      'உங்கள் கைபேசி எண்ணை உள்ளிடவும். 6 இலக்கக் குறியீட்டை அனுப்புவோம்.';

  @override
  String get phoneLabel => 'கைபேசி எண்';

  @override
  String get phoneInvalid => 'சரியான 10 இலக்கக் கைபேசி எண்ணை உள்ளிடவும்';

  @override
  String get emailLabel => 'மின்னஞ்சல்';

  @override
  String get useEmail => 'மின்னஞ்சல் மூலம் உள்நுழைக';

  @override
  String get usePhone => 'கைபேசி எண் மூலம் உள்நுழைக';

  @override
  String get sendCode => 'குறியீட்டை அனுப்பு';

  @override
  String codeSentTo(String phone) {
    return '$phone எண்ணுக்கு அனுப்பிய குறியீட்டை உள்ளிடவும்';
  }

  @override
  String get codeLabel => '6 இலக்கக் குறியீடு';

  @override
  String get codeInvalid => '6 இலக்கக் குறியீட்டை உள்ளிடவும்';

  @override
  String get verifyCode => 'சரிபார்த்து உள்நுழைக';

  @override
  String get changeNumber => 'எண்ணை மாற்று';

  @override
  String get resendCode => 'குறியீட்டை மீண்டும் அனுப்பு';

  @override
  String get codeResent => 'புதிய குறியீடு அனுப்பப்படுகிறது';

  @override
  String get testNumberHint =>
      'இது சோதனை எண்: சோதனைக் குறியீட்டைப் பயன்படுத்தவும்.';

  @override
  String get errorNetwork =>
      'சர்வருடன் இணைப்பு இல்லை. இணையத்தைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.';

  @override
  String get errorTimeout =>
      'சர்வர் பதில் தர நீண்ட நேரம் ஆகிறது. மீண்டும் முயற்சிக்கவும்.';

  @override
  String get errorGeneric => 'ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.';

  @override
  String get pickShopTitle => 'கடையைத் தேர்ந்தெடுக்கவும்';

  @override
  String get noShops =>
      'நீங்கள் இன்னும் எந்தக் கடையிலும் சேர்க்கப்படவில்லை. உங்கள் எண்ணைச் சேர்க்கும்படி கடை உரிமையாளரிடம் கேளுங்கள், அல்லது srikit இணையதளத்தில் புதிய கடையைத் தொடங்குங்கள்.';

  @override
  String get shopSuspended => 'இடைநிறுத்தப்பட்டது';

  @override
  String openingShop(String shop) {
    return '$shop திறக்கிறது…';
  }

  @override
  String get roleOwner => 'உரிமையாளர்';

  @override
  String get roleAdmin => 'நிர்வாகி';

  @override
  String get roleStaff => 'பணியாளர்';

  @override
  String get roleMember => 'உறுப்பினர்';

  @override
  String get tabHome => 'முகப்பு';

  @override
  String get tabBill => 'பில்';

  @override
  String get tabOrders => 'ஆர்டர்கள்';

  @override
  String get tabMore => 'மேலும்';

  @override
  String hello(String name) {
    return 'வணக்கம், $name';
  }

  @override
  String get dashThisMonth => 'இந்த மாதம்';

  @override
  String get dashBilled => 'பில் தொகை';

  @override
  String get dashCollected => 'வசூலானது';

  @override
  String get dashBills => 'பில்கள்';

  @override
  String get dashToCollect => 'வசூலிக்க வேண்டியது';

  @override
  String dashLastMonth(String amount) {
    return 'கடந்த மாதம் $amount';
  }

  @override
  String dashOverdue(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'நிலுவைத் தேதி கடந்த $count பில்கள்',
      one: 'நிலுவைத் தேதி கடந்த 1 பில்',
      zero: 'நிலுவைத் தேதி கடந்த பில்கள் இல்லை',
    );
    return '$_temp0';
  }

  @override
  String get dashRecent => 'சமீபத்திய பில்கள்';

  @override
  String get dashNoBills => 'இன்னும் பில்கள் இல்லை';

  @override
  String get dashDraft => 'வரைவு';

  @override
  String get dashBillingOff => 'இந்தக் கடைக்கு பில்லிங் இயக்கப்படவில்லை.';

  @override
  String get dashNoAccess =>
      'இன்றைய கணக்குகளைப் பார்க்க, கடை உரிமையாளரிடம் பணியாளர் அனுமதி கேளுங்கள்.';

  @override
  String get moreShop => 'கடை';

  @override
  String get switchShop => 'கடையை மாற்று';

  @override
  String get language => 'மொழி';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageTamil => 'தமிழ்';

  @override
  String get signOut => 'வெளியேறு';

  @override
  String get signOutConfirm =>
      'இந்தக் கைபேசியில் RBMS Business-இலிருந்து வெளியேறவா?';

  @override
  String signedInAs(String name) {
    return '$name ஆக உள்நுழைந்துள்ளீர்கள்';
  }

  @override
  String appVersion(String version) {
    return 'பதிப்பு $version';
  }

  @override
  String get updateRequiredTitle => 'செயலியைப் புதுப்பிக்கவும்';

  @override
  String get updateRequiredBody =>
      'RBMS Business-இன் இந்தப் பதிப்பு இனி ஆதரிக்கப்படாது. பில்லிங்கையும் கடை நிர்வாகத்தையும் தொடர, ஸ்டோரில் இருந்து புதுப்பிக்கவும்.';

  @override
  String updateVersions(String current, String minimum) {
    return 'உங்கள் பதிப்பு $current · தேவை $minimum அல்லது அதற்குப் பிந்தையது';
  }

  @override
  String updateYourVersion(String current) {
    return 'உங்கள் பதிப்பு $current';
  }

  @override
  String get updateNow => 'புதுப்பி';

  @override
  String get updateCheckAgain => 'புதுப்பித்துவிட்டேன், மீண்டும் சரிபார்';

  @override
  String get updateAvailable => 'RBMS Business-இன் புதிய பதிப்பு கிடைக்கிறது.';

  @override
  String get updateLater => 'பிறகு';

  @override
  String get tillNotOpened => 'நாள் தொடங்கப்படவில்லை';

  @override
  String tillOpenSince(String time) {
    return 'நாள் திறந்துள்ளது · $time';
  }

  @override
  String get tillClosed => 'நாள் முடிந்தது';

  @override
  String get tillOpenDay => 'நாளைத் தொடங்கு';

  @override
  String get tillRegister => 'கவுண்டர் பெயர்';

  @override
  String get tillOpeningCash => 'தொடக்கத்தில் டிராயரில் உள்ள பணம் (₹)';

  @override
  String get tillNoPermission => 'டில்லைக் கையாள உங்களுக்கு அனுமதி இல்லை.';

  @override
  String get tillNotOpenedHint =>
      'நாளைத் தொடங்காமலும் பில் போடலாம்; ஆனால் அவை டில் கணக்கில் சேராது.';

  @override
  String get tillToday => 'இன்று (X அறிக்கை)';

  @override
  String get tillCashInOut => 'பணம் உள்ளே / வெளியே';

  @override
  String get tillCloseDay => 'நாளை முடி';

  @override
  String get tillBills => 'பில்கள்';

  @override
  String get tillSales => 'விற்பனை';

  @override
  String get tillCashExpected => 'எதிர்பார்க்கும் பணம்';

  @override
  String get tillOpening => 'தொடக்கப் பணம்';

  @override
  String get tillOnCredit => 'கடனில்';

  @override
  String get tillRefunds => 'திருப்பித் தந்தவை';

  @override
  String get tillCashNet => 'பணம் உள்ளே/வெளியே (நிகரம்)';

  @override
  String get tillCashIn => 'பணம் உள்ளே';

  @override
  String get tillCashOut => 'பணம் வெளியே';

  @override
  String get tillAmount => 'தொகை (₹)';

  @override
  String get tillReason => 'காரணம்';

  @override
  String get tillNoEntries => 'இன்னும் பணம் உள்ளே/வெளியே பதிவு இல்லை';

  @override
  String get tillCounted => 'எண்ணிய பணம் (₹)';

  @override
  String get tillCountedLabel => 'எண்ணியது';

  @override
  String get tillNote => 'குறிப்பு (விருப்பம்)';

  @override
  String get tillDifference => 'வித்தியாசம்';

  @override
  String get tillMatches => 'சரியாக உள்ளது';

  @override
  String tillExtra(String amount) {
    return 'கூடுதல் $amount';
  }

  @override
  String tillShort(String amount) {
    return 'குறைவு $amount';
  }

  @override
  String get save => 'சேமி';

  @override
  String get methodCash => 'ரொக்கம்';

  @override
  String get methodUpi => 'UPI';

  @override
  String get methodCard => 'கார்டு';

  @override
  String get methodBank => 'வங்கி';

  @override
  String get methodCheque => 'காசோலை';

  @override
  String get methodOther => 'மற்றவை';

  @override
  String get methodCredit => 'கடன்';

  @override
  String get searchItems => 'பொருளைத் தேடவும் அல்லது குறியீட்டை உள்ளிடவும்';

  @override
  String get scanBarcode => 'பார்கோடை ஸ்கேன் செய்';

  @override
  String get scanHint => 'கேமராவை பார்கோடை நோக்கிக் காட்டவும்';

  @override
  String codeNotFound(String code) {
    return '$code குறியீட்டுக்கு எந்தப் பொருளும் இல்லை';
  }

  @override
  String get noResults => 'பொருட்கள் எதுவும் கிடைக்கவில்லை';

  @override
  String get cartEmpty => 'பொருட்களைச் சேர்க்க தேடவும் அல்லது ஸ்கேன் செய்யவும்';

  @override
  String itemAdded(String name) {
    return '$name சேர்க்கப்பட்டது';
  }

  @override
  String get remove => 'நீக்கு';

  @override
  String get editLine => 'வரியைத் திருத்து';

  @override
  String get qtyLabel => 'அளவு';

  @override
  String get priceLabel => 'விலை (₹)';

  @override
  String get priceLocked => 'விலை அல்லது தள்ளுபடியை மாற்ற தள்ளுபடி அனுமதி தேவை';

  @override
  String get discountLabel => 'தள்ளுபடி';

  @override
  String get discountRupees => '₹ குறைப்பு';

  @override
  String get discountPercent => '% குறைப்பு';

  @override
  String get apply => 'பயன்படுத்து';

  @override
  String serialLabel(String serial) {
    return 'வரிசை எண் $serial';
  }

  @override
  String get customerTitle => 'வாடிக்கையாளர்';

  @override
  String get customerNone => 'வாடிக்கையாளர் இல்லை';

  @override
  String get customerWalkIn => 'நேரடி வாடிக்கையாளர்';

  @override
  String get walkInDefaultName => 'நேரடி வாடிக்கையாளர்';

  @override
  String get customerSearch => 'கைபேசி எண் அல்லது பெயரால் தேடவும்';

  @override
  String get customerAdd => 'வாடிக்கையாளரைச் சேர்';

  @override
  String get customerName => 'பெயர்';

  @override
  String get customerPhoneOptional => 'கைபேசி எண் (விருப்பம்)';

  @override
  String get customerUseWalkIn => 'நேரடி வாடிக்கையாளராக பில் போடு';

  @override
  String get customerClear => 'வாடிக்கையாளரை நீக்கு';

  @override
  String customerOwes(String amount) {
    return 'நிலுவை $amount';
  }

  @override
  String get customerNameRequired => 'பெயரை உள்ளிடவும்';

  @override
  String get estimate => 'மதிப்பீடு';

  @override
  String get estimateNote => 'இறுதித் தொகை பில் போடும்போது கணக்கிடப்படும்';

  @override
  String itemsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count பொருட்கள்',
      one: '1 பொருள்',
    );
    return '$_temp0';
  }

  @override
  String charge(String amount) {
    return 'வசூலி ≈ $amount';
  }

  @override
  String get makingBill => 'பில் தயாராகிறது…';

  @override
  String billNumber(String number) {
    return 'பில் $number';
  }

  @override
  String get subtotalLabel => 'கூட்டுத்தொகை';

  @override
  String get taxableLabel => 'வரி விதிக்கத்தக்க மதிப்பு';

  @override
  String get cgstLabel => 'CGST';

  @override
  String get sgstLabel => 'SGST';

  @override
  String get igstLabel => 'IGST';

  @override
  String get roundOffLabel => 'முழுமையாக்கல்';

  @override
  String get totalLabel => 'மொத்தம்';

  @override
  String toPay(String amount) {
    return 'செலுத்த வேண்டியது $amount';
  }

  @override
  String get cashReceived => 'பெற்ற ரொக்கம் (₹)';

  @override
  String get upiAmount => 'UPI (₹)';

  @override
  String get cardAmount => 'கார்டு (₹)';

  @override
  String get creditAmount => 'கடனில் (₹)';

  @override
  String get upiReceived => 'UPI பணம் வந்துவிட்டது';

  @override
  String get referenceOptional => 'குறிப்பு எண் (விருப்பம்)';

  @override
  String changeDue(String amount) {
    return 'மீதி $amount';
  }

  @override
  String shortBy(String amount) {
    return '$amount குறைவு';
  }

  @override
  String get problemOverNonCash =>
      'UPI, கார்டு, கடன் ஆகியவை பில் தொகையை விட அதிகமாக இருக்கக்கூடாது';

  @override
  String get problemUpiUnconfirmed => 'UPI பணம் வந்ததை உறுதிசெய்யவும்';

  @override
  String get problemCreditNeedsCustomer =>
      'கடனுக்கு சேமித்த வாடிக்கையாளர் தேவை';

  @override
  String get problemCreditUnavailable =>
      'இந்தக் கடைக்குக் கடன் புத்தகம் இயக்கப்படவில்லை';

  @override
  String get completePayment => 'முடி';

  @override
  String get paymentFailed => 'ஒரு பணப்பதிவைச் சேமிக்க முடியவில்லை.';

  @override
  String get finishWithout => 'அது இல்லாமல் முடி';

  @override
  String get leaveBillTitle => 'இந்த பில்லை ரத்து செய்யவா?';

  @override
  String get leaveBillBody =>
      'பில் ஏற்கெனவே போடப்பட்டுவிட்டது. அதை ரத்து செய்யவும், அல்லது இங்கேயே இருந்து பணத்தைப் பெறவும்.';

  @override
  String get cancelBill => 'பில்லை ரத்து செய்';

  @override
  String get stay => 'இங்கேயே இரு';

  @override
  String get saleComplete => 'விற்பனை முடிந்தது';

  @override
  String get giveChange => 'மீதி கொடுக்கவும்';

  @override
  String addedToCredit(String amount) {
    return '$amount வாடிக்கையாளரின் கடனில் சேர்க்கப்பட்டது';
  }

  @override
  String paymentsMissing(String amount) {
    return 'பில் சேமிக்கப்பட்டது, ஆனால் $amount பணப்பதிவு சேமிக்கப்படவில்லை. இணையத்தில் அந்த பில்லில் சேர்க்கவும்.';
  }

  @override
  String get creditLimitWarning =>
      'இந்த வாடிக்கையாளர் கடன் வரம்பைத் தாண்டிவிட்டார்.';

  @override
  String get shareWhatsApp => 'WhatsApp-இல் பகிர்';

  @override
  String shareText(String number, String amount, String url) {
    return 'பில் $number, தொகை $amount: $url';
  }

  @override
  String get couldNotOpenWhatsApp => 'WhatsApp-ஐத் திறக்க முடியவில்லை';

  @override
  String get printReceipt => 'அச்சிடு';

  @override
  String get printPreviewTitle => 'ரசீது முன்னோட்டம்';

  @override
  String get printComingNext =>
      'புளூடூத் பிரிண்டர்கள் அடுத்து வருகின்றன. அச்சாகப் போவது இதுதான்.';

  @override
  String get newBill => 'புதிய பில்';

  @override
  String get closeLabel => 'மூடு';

  @override
  String get orderStatusPlaced => 'புதியது';

  @override
  String get orderStatusConfirmed => 'உறுதிசெய்யப்பட்டது';

  @override
  String get orderStatusPacked => 'பேக் செய்யப்பட்டது';

  @override
  String get orderStatusShipped => 'அனுப்பப்பட்டது';

  @override
  String get orderStatusDelivered => 'டெலிவரி ஆனது';

  @override
  String get orderStatusCancelled => 'ரத்து செய்யப்பட்டது';

  @override
  String get orderStatusReturned => 'திருப்பப்பட்டது';

  @override
  String get orderActionConfirm => 'உறுதிசெய்';

  @override
  String get orderActionPack => 'பேக் ஆனதாகக் குறி';

  @override
  String get orderActionShip => 'அனுப்பியதாகக் குறி';

  @override
  String get orderActionDeliver => 'டெலிவரி ஆனதாகக் குறி';

  @override
  String get orderActionCancel => 'ஆர்டரை ரத்து செய்';

  @override
  String get orderActionReturn => 'திருப்பியதாகக் குறி';

  @override
  String get paymentPaid => 'செலுத்தப்பட்டது';

  @override
  String get paymentCod => 'COD';

  @override
  String get paymentPending => 'நிலுவையில்';

  @override
  String get paymentRefunded => 'திருப்பித் தரப்பட்டது';

  @override
  String get paymentPartRefunded => 'பகுதி திருப்பித் தரப்பட்டது';

  @override
  String get paymentUnpaid => 'செலுத்தப்படவில்லை';

  @override
  String get channelStore => 'ஆன்லைன் கடை';

  @override
  String get channelManual => 'நேரடி';

  @override
  String get channelPos => 'கவுண்டர்';

  @override
  String get channelMarketplace => 'சந்தை';

  @override
  String get ordersAll => 'அனைத்தும்';

  @override
  String get ordersSearch => 'ஆர்டர்களைத் தேடு';

  @override
  String get ordersEmpty => 'ஆர்டர்கள் இல்லை';

  @override
  String orderTitle(String number) {
    return 'ஆர்டர் $number';
  }

  @override
  String get orderItems => 'பொருட்கள்';

  @override
  String get shipToLabel => 'அனுப்ப வேண்டிய முகவரி';

  @override
  String get customerNoteLabel => 'வாடிக்கையாளர் குறிப்பு';

  @override
  String get orderShipping => 'டெலிவரி கட்டணம்';

  @override
  String get orderCodFee => 'COD கட்டணம்';

  @override
  String get orderPaidLabel => 'செலுத்தியது';

  @override
  String get orderBalance => 'நிலுவைத் தொகை';

  @override
  String get orderPayments => 'பணப்பதிவுகள்';

  @override
  String get orderNoPayments => 'இன்னும் பணப்பதிவு இல்லை';

  @override
  String get orderTimeline => 'நிகழ்வுகள்';

  @override
  String get orderShipment => 'அனுப்புதல்';

  @override
  String get carrierLabel => 'கூரியர்';

  @override
  String get trackingNumberLabel => 'டிராக்கிங் எண்';

  @override
  String get trackingUrlLabel => 'டிராக்கிங் இணைப்பு';

  @override
  String get trackingUrlInvalid =>
      'http:// அல்லது https:// என்று தொடங்கும் இணைப்பை உள்ளிடவும்';

  @override
  String get shipTitle => 'ஆர்டரை அனுப்பு';

  @override
  String get cancelOrderTitle => 'ஆர்டரை ரத்து செய்யவா?';

  @override
  String get cancelReasonRequired => 'காரணத்தைக் கூறவும்';

  @override
  String get cancelReasonCustomer => 'வாடிக்கையாளர் கேட்டார்';

  @override
  String get cancelReasonStock => 'கையிருப்பு இல்லை';

  @override
  String get cancelReasonPayment => 'பணம் செலுத்துவதில் சிக்கல்';

  @override
  String get cancelReasonDuplicate => 'இரட்டை ஆர்டர்';

  @override
  String get cancelReasonAddress => 'முகவரிச் சிக்கல்';

  @override
  String get keepOrder => 'ஆர்டரை வைத்திரு';

  @override
  String get returnTitle => 'ஆர்டர் திருப்பப்பட்டதாகக் குறிக்கவா?';

  @override
  String get returnBody =>
      'பொருட்கள் கையிருப்பில் சேரும், இன்வாய்ஸ் ரத்தாகும். பணத்தைத் திருப்பித் தந்தால் அதை இணையத்தில் பதிவு செய்யவும்.';

  @override
  String get skipTo => 'நேரடியாக';

  @override
  String get recordPayment => 'பணத்தைப் பதிவு செய்';

  @override
  String orderPayAmountInvalid(String amount) {
    return '$amount வரையிலான தொகையை உள்ளிடவும்';
  }

  @override
  String get makeInvoice => 'இன்வாய்ஸ் உருவாக்கு';

  @override
  String invoiceLabel(String number) {
    return 'இன்வாய்ஸ் $number';
  }

  @override
  String get codDeliverNote =>
      'டெலிவரி ஆனதாகக் குறித்தால் COD நிலுவை செலுத்தப்பட்டதாகப் பதிவாகும்.';

  @override
  String get orderChanged =>
      'இந்த ஆர்டர் இடையில் மாறிவிட்டது. சமீபத்திய நிலையைக் காட்டுகிறோம்.';

  @override
  String eventStatus(String status) {
    return '$status நிலைக்கு மாற்றப்பட்டது';
  }

  @override
  String eventPayment(String amount, String method) {
    return 'பணம் $amount · $method';
  }

  @override
  String eventRefund(String amount) {
    return 'திருப்பித் தந்தது $amount';
  }

  @override
  String get eventFulfillment => 'அனுப்புதல் விவரங்கள் புதுப்பிக்கப்பட்டன';

  @override
  String get productsTitle => 'பொருட்கள்';

  @override
  String get stockTitle => 'கையிருப்பு';

  @override
  String get productNew => 'புதிய பொருள்';

  @override
  String get productsSearch => 'பெயர், SKU அல்லது பார்கோடால் தேடவும்';

  @override
  String get allCategories => 'அனைத்து வகைகளும்';

  @override
  String get productArchived => 'காப்பகத்தில்';

  @override
  String get productDraft => 'வரைவு';

  @override
  String get productsEmpty => 'பொருட்கள் இல்லை';

  @override
  String variantsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count வகைகள்',
      one: '1 வகை',
    );
    return '$_temp0';
  }

  @override
  String get stockNotTracked => 'கண்காணிக்கப்படவில்லை';

  @override
  String get stockOut => 'கையிருப்பு இல்லை';

  @override
  String stockLow(String qty) {
    return 'குறைவு · $qty';
  }

  @override
  String stockQty(String qty) {
    return 'கையிருப்பு $qty';
  }

  @override
  String get productArchiveTitle => 'இந்தப் பொருளைக் காப்பகத்துக்கு அனுப்பவா?';

  @override
  String get productArchiveBody =>
      'இது கடையிலும் கவுண்டரிலும் தெரியாது. பிறகு மீண்டும் செயல்படுத்தலாம்.';

  @override
  String get productArchive => 'காப்பகத்துக்கு அனுப்பு';

  @override
  String get productUnarchive => 'செயல்படுத்து';

  @override
  String productTax(String rate, String mode) {
    return 'GST $rate% · $mode';
  }

  @override
  String get taxIncluded => 'விலையில் GST அடங்கும்';

  @override
  String get taxExtra => 'GST கூடுதலாகச் சேர்க்கப்படும்';

  @override
  String percentOff(int percent) {
    return '$percent% தள்ளுபடி';
  }

  @override
  String get skuLabel => 'SKU';

  @override
  String get barcodeLabel => 'பார்கோடு';

  @override
  String get mrpLabel => 'MRP (₹)';

  @override
  String codeFieldInvalid(String field) {
    return '$field: அதிகபட்சம் 64 எழுத்துகள், இடைவெளி இல்லாமல்';
  }

  @override
  String get variantsFeatureNeeded =>
      'இங்கே விலையை மட்டுமே மாற்றலாம்: MRP, பார்கோடு, SKU ஆகியவற்றுக்கு \"வகைகள் மற்றும் விருப்பங்கள்\" அம்சம் தேவை.';

  @override
  String get qtyInvalid => 'அளவை உள்ளிடவும்';

  @override
  String get qtyDecimals => 'அளவில் அதிகபட்சம் 3 தசம இலக்கங்கள்';

  @override
  String get qtyMoreThanZero => 'அளவு 0-ஐ விட அதிகமாக இருக்க வேண்டும்';

  @override
  String get openingStockFailed =>
      'பொருள் சேமிக்கப்பட்டது, ஆனால் தொடக்கக் கையிருப்பு சேமிக்கப்படவில்லை.';

  @override
  String get productName => 'பொருளின் பெயர்';

  @override
  String get categoryLabel => 'வகை';

  @override
  String get noCategory => 'வகை இல்லை';

  @override
  String get priceIncludesGst => 'விலையில் GST அடங்கும்';

  @override
  String get gstRateLabel => 'GST விகிதம்';

  @override
  String get unitLabel => 'அலகு';

  @override
  String get openingStock => 'தொடக்கக் கையிருப்பு';

  @override
  String stockValue(String amount) {
    return 'கையிருப்பு மதிப்பு $amount';
  }

  @override
  String stockLowOut(int low, int out) {
    return '$low குறைவு · $out இல்லை';
  }

  @override
  String get stockFilterLow => 'குறைவு';

  @override
  String get stockFilterOut => 'இல்லை';

  @override
  String get allLocations => 'அனைத்து இடங்களும்';

  @override
  String get stockEmpty => 'எதுவும் இல்லை';

  @override
  String stockAvailable(String available, String reserved) {
    return '$available கிடைக்கிறது · $reserved ஆர்டர்களுக்கு ஒதுக்கப்பட்டது';
  }

  @override
  String get stockAdjust => 'கையிருப்பைச் சரிசெய்';

  @override
  String reorderLevel(String qty) {
    return 'குறைந்த கையிருப்பு அளவு: $qty';
  }

  @override
  String avgCost(String cost, String value) {
    return 'சராசரி விலை $cost · மதிப்பு $value';
  }

  @override
  String get stockMovements => 'இயக்கங்கள்';

  @override
  String get stockNoMovements => 'இன்னும் இயக்கங்கள் இல்லை';

  @override
  String get loadMore => 'மேலும் காட்டு';

  @override
  String get moveOpening => 'தொடக்கக் கையிருப்பு';

  @override
  String get moveAdjustment => 'சரிசெய்தல்';

  @override
  String get moveSale => 'விற்பனை';

  @override
  String get moveSaleCancel => 'விற்பனை ரத்து';

  @override
  String get moveSaleReturn => 'விற்பனை திருப்பம்';

  @override
  String get moveSaleReturnCancel => 'திருப்பம் ரத்து';

  @override
  String get movePurchase => 'கொள்முதல்';

  @override
  String get movePurchaseCancel => 'கொள்முதல் ரத்து';

  @override
  String get moveTransferOut => 'இடமாற்றம் (வெளியே)';

  @override
  String get moveTransferIn => 'இடமாற்றம் (உள்ளே)';

  @override
  String stockNow(String qty) {
    return 'இப்போது: $qty';
  }

  @override
  String stockAfter(String qty) {
    return 'பிறகு: $qty';
  }

  @override
  String get adjustAdd => 'சேர்';

  @override
  String get adjustRemove => 'குறை';

  @override
  String get adjustSet => 'இதுவாக அமை';

  @override
  String get stockNegativeWarning =>
      'கையிருப்பு பூஜ்ஜியத்துக்குக் கீழே போகும்.';

  @override
  String get balanceDueShort => 'நிலுவை';

  @override
  String get balanceAdvanceShort => 'முன்பணம்';

  @override
  String get balanceSettledShort => 'தீர்ந்தது';

  @override
  String get ledgerBalDue => 'நிலுவை';

  @override
  String get ledgerBalAdvance => 'முன்.';

  @override
  String get ledgerTypeOpening => 'தொடக்க இருப்பு';

  @override
  String get ledgerTypeInvoice => 'பில்';

  @override
  String get ledgerTypePayment => 'பணம் செலுத்தல்';

  @override
  String get ledgerTypeReceipt => 'ரசீது';

  @override
  String get ledgerTypeCancel => 'பில் ரத்து';

  @override
  String get ledgerTypeCreditNote => 'வரவுக் குறிப்பு';

  @override
  String get ledgerTypeRefund => 'திருப்பித் தந்தது';

  @override
  String get ageCurrent => 'இன்னும் கெடு வரவில்லை';

  @override
  String get age1to30 => '1–30 நாட்கள்';

  @override
  String get age31to60 => '31–60 நாட்கள்';

  @override
  String get age61to90 => '61–90 நாட்கள்';

  @override
  String get age90plus => '90 நாட்களுக்கு மேல்';

  @override
  String get expenseCatRent => 'வாடகை';

  @override
  String get expenseCatSalaries => 'சம்பளம்';

  @override
  String get expenseCatElectricity => 'மின்கட்டணம்';

  @override
  String get expenseCatTransport => 'போக்குவரத்து';

  @override
  String get expenseCatPackaging => 'பேக்கிங்';

  @override
  String get expenseCatMarketing => 'விளம்பரம்';

  @override
  String get expenseCatRepairs => 'பழுதுபார்ப்பு';

  @override
  String get expenseCatOther => 'பிற';

  @override
  String statementMessageDue(
      String name, String shop, String amount, String url) {
    return 'வணக்கம் $name, $shop கடையில் உங்கள் நிலுவை $amount. உங்கள் கணக்கைப் பார்க்க: $url';
  }

  @override
  String statementMessageAdvance(
      String name, String shop, String amount, String url) {
    return 'வணக்கம் $name, $shop கடையில் உங்கள் முன்பணம் $amount உள்ளது. உங்கள் கணக்கைப் பார்க்க: $url';
  }

  @override
  String statementMessageSettled(String name, String shop, String url) {
    return 'வணக்கம் $name, $shop கடையில் உங்கள் கணக்கு முழுமையாகத் தீர்ந்தது. நன்றி! கணக்கு: $url';
  }

  @override
  String get sortLabel => 'வரிசைப்படுத்து';

  @override
  String get sortBiggestDue => 'அதிக நிலுவை முதலில்';

  @override
  String get sortOldestDue => 'பழைய நிலுவை முதலில்';

  @override
  String get sortLastPayment => 'சமீபத்திய பணம் முதலில்';

  @override
  String get sortName => 'பெயர்';

  @override
  String get creditBookTitle => 'கடன் கணக்கு';

  @override
  String get toReceive => 'வர வேண்டியது';

  @override
  String get advanceHeld => 'பெற்ற முன்பணம்';

  @override
  String get customersWithDues => 'நிலுவை உள்ள வாடிக்கையாளர்கள்';

  @override
  String get creditBookSearch => 'பெயர் அல்லது தொலைபேசி மூலம் தேடு';

  @override
  String get overdueFor => 'தாமதம்';

  @override
  String get customersNoMatch => 'பொருந்தும் வாடிக்கையாளர் இல்லை';

  @override
  String get creditBookNoDues =>
      'யாரும் நிலுவை வைக்கவில்லை. கடனுக்குக் கொடுத்த பில்கள் இங்கே தெரியும்.';

  @override
  String get creditBookNoAdvances =>
      'முன்பணம் இல்லை. பில்லுக்கு முன்பே வாடிக்கையாளர்கள் தரும் பணம் இங்கே தெரியும்.';

  @override
  String get creditBookEmpty =>
      'கடன் கணக்கு காலியாக உள்ளது. வாடிக்கையாளர்களைச் சேர்த்து கடனுக்கு பில் போட்டால், நிலுவையை இங்கே கண்காணிக்கலாம்.';

  @override
  String dueSince(String date) {
    return '$date முதல் நிலுவை';
  }

  @override
  String lastActivity(String date) {
    return 'கடைசி பரிவர்த்தனை $date';
  }

  @override
  String get noActivity => 'இன்னும் பரிவர்த்தனை இல்லை';

  @override
  String overdueAmount(String amount) {
    return '$amount தவணை கடந்தது';
  }

  @override
  String receiveFrom(String name) {
    return '$name-இடமிருந்து பணம் பெறு';
  }

  @override
  String remindName(String name) {
    return '$name-க்கு நினைவூட்டல் அனுப்பு';
  }

  @override
  String remindSent(String name) {
    return '$name-க்கு நினைவூட்டல் அனுப்பப்பட்டது';
  }

  @override
  String remindFailed(String reason) {
    return 'நினைவூட்டல் அனுப்ப முடியவில்லை: $reason';
  }

  @override
  String get remindViaWhatsApp => 'WhatsApp-இல் அனுப்பு';

  @override
  String get amountRequired => 'தொகையை உள்ளிடவும்';

  @override
  String get amountInvalid => 'சரியான தொகையை உள்ளிடவும்';

  @override
  String get dateNotFuture =>
      'இன்று அல்லது அதற்கு முந்தைய தேதியைத் தேர்ந்தெடுக்கவும்';

  @override
  String get tooLong => 'இது மிக நீளமாக உள்ளது';

  @override
  String get receivePayment => 'பணம் பெறு';

  @override
  String receiveHint(String name) {
    return '$name-இடமிருந்து. பழைய பில்களுக்கு முதலில் கழிக்கப்படும்; மீதி முன்பணமாக வைக்கப்படும்.';
  }

  @override
  String get amountReceived => 'பெற்ற தொகை';

  @override
  String balanceDueOf(String amount) {
    return 'நிலுவை: $amount';
  }

  @override
  String alreadyAdvance(String name, String amount) {
    return '$name-இடம் ஏற்கனவே $amount முன்பணம் உள்ளது.';
  }

  @override
  String get dateLabel => 'தேதி';

  @override
  String get noteOptional => 'குறிப்பு (விருப்பம்)';

  @override
  String get saveReceipt => 'ரசீதைச் சேமி';

  @override
  String receivedAmount(String amount) {
    return '$amount பெறப்பட்டது';
  }

  @override
  String receivedFrom(String name, String date) {
    return '$name-இடமிருந்து, $date';
  }

  @override
  String get settledAgainst => 'கழிக்கப்பட்ட பில்கள்';

  @override
  String billNumberShort(String number) {
    return 'பில் $number';
  }

  @override
  String get noOpenBills =>
      'திறந்த பில்கள் இல்லை, அதனால் முழுத் தொகையும் முன்பணமாக வைக்கப்பட்டது.';

  @override
  String get keptAsAdvance => 'முன்பணமாக வைக்கப்பட்டது';

  @override
  String get done => 'முடிந்தது';

  @override
  String get customersTitle => 'வாடிக்கையாளர்கள்';

  @override
  String get customersHasDues => 'நிலுவை உள்ளவர்கள்';

  @override
  String get customersAdd => 'வாடிக்கையாளர் சேர்';

  @override
  String get customersEdit => 'வாடிக்கையாளரைத் திருத்து';

  @override
  String get customersSearch => 'பெயர், தொலைபேசி அல்லது GSTIN மூலம் தேடு';

  @override
  String get customersEmpty =>
      'இன்னும் வாடிக்கையாளர்கள் இல்லை. வழக்கமான வாடிக்கையாளர்களைச் சேமித்தால் விரைவாக பில் போடலாம், நிலுவையையும் கண்காணிக்கலாம்.';

  @override
  String customersLastBill(String date) {
    return 'கடைசி பில் $date';
  }

  @override
  String get customersOverLimit => 'கடன் வரம்பைத் தாண்டியது';

  @override
  String get couldNotOpen => 'இந்த போனில் அதைத் திறக்க முடியவில்லை';

  @override
  String get customerCall => 'அழை';

  @override
  String get shareStatement => 'கணக்கு அறிக்கையைப் பகிர்';

  @override
  String get sendReminder => 'நினைவூட்டல் அனுப்பு';

  @override
  String get ledgerTitle => 'பேரேடு';

  @override
  String ledgerOf(String name) {
    return 'பேரேடு · $name';
  }

  @override
  String get customerBills => 'பில்கள்';

  @override
  String get customerNoBills => 'இந்த வாடிக்கையாளருக்கு இன்னும் பில் இல்லை.';

  @override
  String customerMoreBills(int count) {
    return 'மேலும் $count பழைய பில்கள் இணையத்தில்';
  }

  @override
  String billBalance(String amount) {
    return 'நிலுவை $amount';
  }

  @override
  String get balanceDue => 'நிலுவைத் தொகை';

  @override
  String get balanceAdvance => 'பெற்ற முன்பணம்';

  @override
  String get balanceSettled => 'எல்லாம் தீர்ந்தது';

  @override
  String balanceDueHint(String name) {
    return '$name உங்களுக்கு இந்தத் தொகை தர வேண்டும்.';
  }

  @override
  String balanceAdvanceHint(String name) {
    return '$name இவ்வளவு முன்பணம் தந்துள்ளார். அடுத்த பில்களுக்கு இது கழிக்கப்படும்.';
  }

  @override
  String balanceSettledHint(String name) {
    return '$name-இடமிருந்து எதுவும் நிலுவையில் இல்லை.';
  }

  @override
  String get creditLimit => 'கடன் வரம்பு';

  @override
  String creditUsed(String used, String limit) {
    return '$limit-இல் $used பயன்பட்டது';
  }

  @override
  String creditOver(String amount) {
    return 'வரம்பை $amount தாண்டியது';
  }

  @override
  String creditAvailable(String amount) {
    return 'இன்னும் $amount கொடுக்கலாம்';
  }

  @override
  String get creditLimitHint =>
      'வரம்பு வேண்டாம் என்றால் காலியாக விடவும். ஒரு பில் இதைத் தாண்டினால் எச்சரிக்கை வரும்.';

  @override
  String customerCreated(String name) {
    return '$name சேர்க்கப்பட்டார்';
  }

  @override
  String get customerUpdated => 'வாடிக்கையாளர் விவரம் புதுப்பிக்கப்பட்டது';

  @override
  String get customerFormHint =>
      'பெயர் மட்டும் கட்டாயம். வணிக வாங்குபவர்களுக்கு GSTIN சேர்க்கவும்.';

  @override
  String get requiredField => 'கட்டாயம்';

  @override
  String get customerPhone => 'தொலைபேசி';

  @override
  String get customerEmail => 'மின்னஞ்சல்';

  @override
  String get customerAddress => 'முகவரி';

  @override
  String get emailInvalid => 'சரியான மின்னஞ்சலை உள்ளிடவும்';

  @override
  String get gstinInvalid => 'சரியான 15 எழுத்து GSTIN-ஐ உள்ளிடவும்';

  @override
  String get openingBalance => 'தொடக்க இருப்பு';

  @override
  String get openingBalanceHint =>
      'இங்கே பில் போடத் தொடங்கும் முன் இருந்த பழைய இருப்பு.';

  @override
  String get openingOwes => 'அவர் தர வேண்டும்';

  @override
  String get openingAdvance => 'முன்பணம் தந்துள்ளார்';

  @override
  String get expensesTitle => 'செலவுகள்';

  @override
  String get expenseTitle => 'செலவு';

  @override
  String get expenseAdd => 'செலவைச் சேர்';

  @override
  String get expenseCategories => 'வகைகள்';

  @override
  String get periodThisMonth => 'இந்த மாதம்';

  @override
  String get periodLastMonth => 'கடந்த மாதம்';

  @override
  String get periodThisFy => 'இந்த நிதியாண்டு';

  @override
  String get periodCustom => 'தேதிகளைத் தேர்ந்தெடு';

  @override
  String periodRange(String from, String to) {
    return '$from – $to';
  }

  @override
  String summaryFor(String from, String to) {
    return '$from – $to சுருக்கம்';
  }

  @override
  String get expensesSpent => 'செலவிட்டது';

  @override
  String get expensesGst => 'செலுத்திய GST';

  @override
  String get expensesEntries => 'பதிவுகள்';

  @override
  String get expensesByCategory => 'வகைவாரியான செலவு';

  @override
  String expensesListTotals(int count, String amount, String gst) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count செலவுகள்',
      one: '1 செலவு',
    );
    return '$_temp0 · $amount · GST $gst';
  }

  @override
  String get expensesEmpty =>
      'இந்தக் காலத்தில் செலவுகள் இல்லை. உண்மையான லாபத்தை அறிய வாடகை, சம்பளம், கட்டணங்களை இங்கே பதிவு செய்யுங்கள்.';

  @override
  String get expenseCancelledBadge => 'ரத்து';

  @override
  String get expensePickCategory => 'வகையைத் தேர்ந்தெடுக்கவும்';

  @override
  String expenseCreated(String amount) {
    return '$amount செலவு பதிவு செய்யப்பட்டது';
  }

  @override
  String get expenseUpdated => 'செலவு சேமிக்கப்பட்டது';

  @override
  String get expenseCancel => 'செலவை ரத்து செய்';

  @override
  String get expenseCancelTitle => 'இந்தச் செலவை ரத்து செய்யவா?';

  @override
  String get expenseCancelBody =>
      'ரத்து எனக் குறிக்கப்பட்டுப் பதிவில் இருக்கும்; மொத்தங்களிலும் லாப அறிக்கையிலும் சேர்க்கப்படாது.';

  @override
  String get expenseCancelled => 'செலவு ரத்து செய்யப்பட்டது';

  @override
  String get expenseCancelledHint =>
      'இந்தச் செலவு ரத்து செய்யப்பட்டது; மொத்தங்களில் சேர்க்கப்படாது.';

  @override
  String get keepIt => 'அப்படியே வை';

  @override
  String get expenseAmount => 'தொகை';

  @override
  String get expenseAmountHint =>
      'GST உட்பட நீங்கள் செலுத்திய தொகையை உள்ளிடவும்.';

  @override
  String get expenseCategory => 'வகை';

  @override
  String get expensePaidBy => 'செலுத்திய முறை';

  @override
  String get expenseNoteHint => 'எதற்கான செலவு?';

  @override
  String get expenseReferenceHint => 'பில் எண், UPI குறிப்பு அல்லது காசோலை எண்';

  @override
  String expenseGstInside(String gst, String itc) {
    return 'தொகையில் GST $gst · ITC $itc';
  }

  @override
  String get categoriesHint =>
      'உங்கள் செலவுகளைப் பிரித்து வையுங்கள். உள்ளமைந்த வகைகளின் பெயரை மாற்றலாம், நீக்க முடியாது.';

  @override
  String get categoryNew => 'புதிய வகையின் பெயர்';

  @override
  String get categoryAdd => 'சேர்';

  @override
  String get categoryRename => 'பெயர் மாற்று';

  @override
  String get categoryBuiltin => 'உள்ளமைந்த வகை';

  @override
  String categoryDeleteTitle(String name) {
    return '$name வகையை நீக்கவா?';
  }

  @override
  String get categoryDeleteBody =>
      'செலவுகள் இல்லாத வகைகளை மட்டுமே நீக்க முடியும்.';

  @override
  String get delete => 'நீக்கு';

  @override
  String get ledgerEmpty =>
      'இந்தக் காலத்தில் பதிவுகள் இல்லை. பழைய பதிவுகளைப் பார்க்க நீண்ட தேதி வரம்பைத் தேர்ந்தெடுக்கவும்.';

  @override
  String get ledgerBilled => 'பில்';

  @override
  String get ledgerReceived => 'பெற்றது';

  @override
  String get ledgerClosing => 'இறுதி இருப்பு';

  @override
  String ledgerBroughtForward(String date) {
    return '$date அன்று இருப்பு';
  }

  @override
  String get useAsTerminal => 'இந்த ஃபோனை POS டெர்மினலாகப் பயன்படுத்து';

  @override
  String get pairTitle => 'இந்த ஃபோனை ஒரு டெர்மினலுடன் இணைக்கவும்';

  @override
  String get pairSubtitle =>
      'இணையத்தில் srikit-ல் அமைப்புகள் → POS டெர்மினல்கள் திறந்து, டெர்மினலைத் தேர்ந்தெடுத்து அதன் இணைப்புக் குறியீட்டைக் காட்டவும்.';

  @override
  String get pairScan => 'இணைப்பு QR-ஐ ஸ்கேன் செய்யவும்';

  @override
  String get pairCodeLabel => 'இணைப்புக் குறியீடு';

  @override
  String get pairButton => 'இணை';

  @override
  String get pairing => 'இணைக்கிறது…';

  @override
  String get pairBackToSignIn => 'பதிலாக உரிமையாளர் / பணியாளராக உள்நுழைக';

  @override
  String get pairErrorFormat =>
      '8 எழுத்துக் குறியீட்டை உள்ளிடவும், எ.கா. ABCD-2345';

  @override
  String get pairErrorInvalid =>
      'இந்த இணைப்புக் குறியீடு தவறு அல்லது காலாவதியானது. புதியதைக் கேளுங்கள்.';

  @override
  String get pairErrorTooMany =>
      'அதிக முயற்சிகள். சில நிமிடங்கள் கழித்து மீண்டும் முயலவும்.';

  @override
  String get pairErrorFeatureOff =>
      'இந்தக் கடையின் திட்டத்தில் POS டெர்மினல்கள் இல்லை.';

  @override
  String get pairRevoked =>
      'இந்த ஃபோன் அதன் டெர்மினலில் இருந்து நீக்கப்பட்டது. மீண்டும் இணைக்கவும்.';

  @override
  String get terminalOffline =>
      'சர்வரை அடைய முடியவில்லை. இணையத்தைச் சரிபார்த்து மீண்டும் முயலவும்.';

  @override
  String get terminalFeatureOff =>
      'இந்த டெர்மினலைப் பயன்படுத்த முடியாது: கடைக்கு இந்த வசதி முடக்கப்பட்டுள்ளது.';

  @override
  String get lockTitle => 'உங்கள் PIN-ஐ உள்ளிடவும்';

  @override
  String shopAndTerminal(String shop, String terminal) {
    return '$shop · $terminal';
  }

  @override
  String get unlock => 'திற';

  @override
  String pinInvalid(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'தவறான PIN. இன்னும் $count முயற்சிகள்.',
      one: 'தவறான PIN. இன்னும் 1 முயற்சி.',
      zero: 'தவறான PIN.',
    );
    return '$_temp0';
  }

  @override
  String get pinWrong => 'தவறான PIN.';

  @override
  String pinLocked(String time) {
    return 'பல தவறான PIN-கள். $time கழித்து முயலவும்.';
  }

  @override
  String get pinNotAllowed =>
      'இந்த டெர்மினலைப் பயன்படுத்த உங்களுக்கு அனுமதி இல்லை. உரிமையாளரிடம் கேளுங்கள்.';

  @override
  String get lockedIdle => 'சிறிது நேரம் பயன்படுத்தாததால் பூட்டப்பட்டது.';

  @override
  String get sessionEnded =>
      'உங்கள் அமர்வு முடிந்தது. மீண்டும் PIN-ஐ உள்ளிடவும்.';

  @override
  String get teamMember => 'குழு உறுப்பினர்';

  @override
  String get noPinYet => 'இன்னும் PIN இல்லை';

  @override
  String get pinClear => 'அழி';

  @override
  String get pinBack => 'நீக்கு';

  @override
  String get lockButton => 'பூட்டு';

  @override
  String get switchCashier => 'காசாளரை மாற்று';

  @override
  String cashierLabel(String name) {
    return 'காசாளர்: $name';
  }

  @override
  String get terminalSettings => 'டெர்மினல்';

  @override
  String get syncItems => 'பொருட்களை ஒத்திசை';

  @override
  String catalogueStatus(int count, String time) {
    return '$count பொருட்கள் · $time ஒத்திசைந்தது';
  }

  @override
  String get catalogueNotSynced => 'பொருட்கள் இன்னும் ஒத்திசைக்கப்படவில்லை';

  @override
  String catalogueSyncFailed(String error) {
    return 'பொருட்களை ஒத்திசைக்க முடியவில்லை: $error';
  }

  @override
  String get unpairPhone => 'இந்த ஃபோனை நீக்கு';

  @override
  String get unpairTitle => 'இந்த ஃபோனை நீக்கவா?';

  @override
  String unpairBody(String terminal) {
    return 'இது இனி $terminal ஆக இருக்காது. மீண்டும் பயன்படுத்த புதிய குறியீட்டுடன் இணைக்கவும்.';
  }

  @override
  String get unpair => 'நீக்கு';

  @override
  String enterWeightTitle(String item) {
    return '$item எடை';
  }

  @override
  String get weightKgLabel => 'எடை (கி.கி)';

  @override
  String get weightInvalid => '0-க்கு மேல், 999.999 கி.கி வரை எடையை உள்ளிடவும்';

  @override
  String get add => 'சேர்';

  @override
  String ticketAdded(String code) {
    return 'எடைச் சீட்டு $code சேர்க்கப்பட்டது';
  }

  @override
  String ticketNotFound(String code) {
    return '$code என்ற எடைச் சீட்டு இல்லை.';
  }

  @override
  String ticketUsed(String code) {
    return 'சீட்டு $code ஏற்கனவே பில் செய்யப்பட்டது.';
  }

  @override
  String ticketExpired(String code) {
    return 'சீட்டு $code காலாவதியானது (சீட்டுகள் அன்று மட்டுமே செல்லும்).';
  }

  @override
  String ticketCancelled(String code) {
    return 'சீட்டு $code ரத்து செய்யப்பட்டது.';
  }

  @override
  String ticketDuplicate(String code) {
    return 'சீட்டு $code ஏற்கனவே இந்த பில்லில் உள்ளது.';
  }

  @override
  String ticketEmpty(String code) {
    return 'சீட்டு $code-ல் வரிகள் இல்லை.';
  }

  @override
  String ticketLabel(String code) {
    return 'சீட்டு $code';
  }

  @override
  String removeTicketTitle(String code) {
    return 'சீட்டு $code-ஐ நீக்கவா?';
  }

  @override
  String get removeTicketBody =>
      'அதன் எல்லா வரிகளும் பில்லில் இருந்து நீங்கும்.';

  @override
  String ticketUseFailed(String code, String error) {
    return 'சீட்டு $code-ஐ பில் செய்ததாகக் குறிக்க முடியவில்லை: $error';
  }

  @override
  String get weighingTitle => 'எடை நிலையம்';

  @override
  String weighItem(String item) {
    return '$item எடை போடு';
  }

  @override
  String countItem(String item) {
    return 'எத்தனை $item?';
  }

  @override
  String get grossLabel => 'தராசில் எடை (கி.கி)';

  @override
  String get tareLabel => 'பாத்திர எடை (கி.கி)';

  @override
  String netWeight(String kg) {
    return 'நிகர $kg கி.கி';
  }

  @override
  String get netInvalid =>
      'நிகர எடை 0-க்கு மேல், அதிகபட்சம் 999.999 கி.கி இருக்க வேண்டும்';

  @override
  String get manualScale =>
      'தராசு இணைக்கப்படவில்லை: எடையைத் தட்டச்சு செய்யவும்.';

  @override
  String get addToTicket => 'சீட்டில் சேர்';

  @override
  String ticketLines(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count வரிகள்',
      one: '1 வரி',
      zero: 'இன்னும் வரிகள் இல்லை',
    );
    return '$_temp0';
  }

  @override
  String issueTicket(String amount) {
    return 'சீட்டு வழங்கு · ≈ $amount';
  }

  @override
  String get issuing => 'வழங்குகிறது…';

  @override
  String get ticketTitle => 'எடைச் சீட்டு';

  @override
  String get ticketHint =>
      'இதை வாடிக்கையாளரிடம் கொடுங்கள்; கவுண்டரில் குறியீடு ஸ்கேன் செய்யப்படும்.';

  @override
  String get printTicket => 'சீட்டை அச்சிடு';

  @override
  String get nextCustomer => 'அடுத்த வாடிக்கையாளர்';

  @override
  String get todayTickets => 'இன்றைய சீட்டுகள்';

  @override
  String get noTicketsToday => 'இன்று சீட்டுகள் இல்லை';

  @override
  String get cancelTicket => 'சீட்டை ரத்து செய்';

  @override
  String cancelTicketTitle(String code) {
    return 'சீட்டு $code-ஐ ரத்து செய்யவா?';
  }

  @override
  String get ticketStatusOpen => 'திறந்தது';

  @override
  String get ticketStatusUsed => 'பில் ஆனது';

  @override
  String get ticketStatusCancelled => 'ரத்து';

  @override
  String get byWeight => 'எடைப்படி';

  @override
  String get weighFirst => 'எடை போட ஒரு பொருளைத் தேர்ந்தெடுக்கவும்';
}
