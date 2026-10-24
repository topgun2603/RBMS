// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'srikit Business';

  @override
  String get loading => 'Opening…';

  @override
  String get restoreFailedTitle => 'Couldn\'t reach srikit';

  @override
  String get retry => 'Try again';

  @override
  String get cancel => 'Cancel';

  @override
  String get signInTitle => 'Sign in';

  @override
  String get signInSubtitle =>
      'Enter your mobile number. We\'ll send you a 6-digit code.';

  @override
  String get phoneLabel => 'Mobile number';

  @override
  String get phoneInvalid => 'Enter a valid 10-digit mobile number';

  @override
  String get emailLabel => 'Email';

  @override
  String get useEmail => 'Sign in with email instead';

  @override
  String get usePhone => 'Sign in with mobile number';

  @override
  String get sendCode => 'Send code';

  @override
  String codeSentTo(String phone) {
    return 'Enter the code sent to $phone';
  }

  @override
  String get codeLabel => '6-digit code';

  @override
  String get codeInvalid => 'Enter the 6-digit code';

  @override
  String get verifyCode => 'Verify and sign in';

  @override
  String get changeNumber => 'Change number';

  @override
  String get resendCode => 'Send the code again';

  @override
  String get codeResent => 'A new code is on its way';

  @override
  String get testNumberHint => 'This is a test number: use the test code.';

  @override
  String get errorNetwork =>
      'No connection to the server. Check your internet and try again.';

  @override
  String get errorTimeout => 'The server is taking too long. Try again.';

  @override
  String get errorGeneric => 'Something went wrong. Try again.';

  @override
  String get pickShopTitle => 'Choose a shop';

  @override
  String get noShops =>
      'You\'re not part of any shop yet. Ask the owner to add your number, or start a shop on the srikit website.';

  @override
  String get shopSuspended => 'Suspended';

  @override
  String openingShop(String shop) {
    return 'Opening $shop…';
  }

  @override
  String get roleOwner => 'Owner';

  @override
  String get roleAdmin => 'Admin';

  @override
  String get roleStaff => 'Staff';

  @override
  String get roleMember => 'Member';

  @override
  String get tabHome => 'Home';

  @override
  String get tabBill => 'Bill';

  @override
  String get tabOrders => 'Orders';

  @override
  String get tabMore => 'More';

  @override
  String hello(String name) {
    return 'Hello, $name';
  }

  @override
  String get dashThisMonth => 'This month';

  @override
  String get dashBilled => 'Billed';

  @override
  String get dashCollected => 'Collected';

  @override
  String get dashBills => 'Bills';

  @override
  String get dashToCollect => 'To collect';

  @override
  String dashLastMonth(String amount) {
    return 'Last month $amount';
  }

  @override
  String dashOverdue(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count overdue bills',
      one: '1 overdue bill',
      zero: 'No overdue bills',
    );
    return '$_temp0';
  }

  @override
  String get dashRecent => 'Recent bills';

  @override
  String get dashNoBills => 'No bills yet';

  @override
  String get dashDraft => 'Draft';

  @override
  String get dashBillingOff => 'Billing isn\'t turned on for this shop.';

  @override
  String get dashNoAccess =>
      'Ask the shop owner for staff access to see the day\'s numbers.';

  @override
  String get moreShop => 'Shop';

  @override
  String get switchShop => 'Switch shop';

  @override
  String get language => 'Language';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageTamil => 'தமிழ்';

  @override
  String get signOut => 'Sign out';

  @override
  String get signOutConfirm => 'Sign out of srikit Business on this phone?';

  @override
  String signedInAs(String name) {
    return 'Signed in as $name';
  }

  @override
  String appVersion(String version) {
    return 'Version $version';
  }

  @override
  String get updateRequiredTitle => 'Update the app';

  @override
  String get updateRequiredBody =>
      'This version of srikit Business is no longer supported. Update it from the store to keep billing and managing your shop.';

  @override
  String updateVersions(String current, String minimum) {
    return 'Your version $current · needed $minimum or newer';
  }

  @override
  String updateYourVersion(String current) {
    return 'Your version $current';
  }

  @override
  String get updateNow => 'Update';

  @override
  String get updateCheckAgain => 'I\'ve updated, check again';

  @override
  String get updateAvailable =>
      'A new version of srikit Business is available.';

  @override
  String get updateLater => 'Later';

  @override
  String get tillNotOpened => 'Day not opened';

  @override
  String tillOpenSince(String time) {
    return 'Day open · $time';
  }

  @override
  String get tillClosed => 'Day closed';

  @override
  String get tillOpenDay => 'Open day';

  @override
  String get tillRegister => 'Counter name';

  @override
  String get tillOpeningCash => 'Cash in the drawer to start (₹)';

  @override
  String get tillNoPermission => 'You don\'t have permission for the till.';

  @override
  String get tillNotOpenedHint =>
      'You can bill without opening the day, but those bills won\'t count in the till.';

  @override
  String get tillToday => 'Today (X report)';

  @override
  String get tillCashInOut => 'Cash in / out';

  @override
  String get tillCloseDay => 'Close day';

  @override
  String get tillBills => 'Bills';

  @override
  String get tillSales => 'Sales';

  @override
  String get tillCashExpected => 'Cash expected';

  @override
  String get tillOpening => 'Opening cash';

  @override
  String get tillOnCredit => 'On credit';

  @override
  String get tillRefunds => 'Refunds';

  @override
  String get tillCashNet => 'Cash in/out (net)';

  @override
  String get tillCashIn => 'Cash in';

  @override
  String get tillCashOut => 'Cash out';

  @override
  String get tillAmount => 'Amount (₹)';

  @override
  String get tillReason => 'Reason';

  @override
  String get tillNoEntries => 'No cash in or out yet';

  @override
  String get tillCounted => 'Cash counted (₹)';

  @override
  String get tillCountedLabel => 'Counted';

  @override
  String get tillNote => 'Note (optional)';

  @override
  String get tillDifference => 'Difference';

  @override
  String get tillMatches => 'Matches';

  @override
  String tillExtra(String amount) {
    return 'Extra $amount';
  }

  @override
  String tillShort(String amount) {
    return 'Short $amount';
  }

  @override
  String get save => 'Save';

  @override
  String get methodCash => 'Cash';

  @override
  String get methodUpi => 'UPI';

  @override
  String get methodCard => 'Card';

  @override
  String get methodBank => 'Bank';

  @override
  String get methodCheque => 'Cheque';

  @override
  String get methodOther => 'Other';

  @override
  String get methodCredit => 'On credit';

  @override
  String get searchItems => 'Search items or type a code';

  @override
  String get scanBarcode => 'Scan barcode';

  @override
  String get scanHint => 'Point the camera at a barcode';

  @override
  String codeNotFound(String code) {
    return 'No item for $code';
  }

  @override
  String get noResults => 'No items found';

  @override
  String get cartEmpty => 'Search or scan to add items';

  @override
  String itemAdded(String name) {
    return 'Added $name';
  }

  @override
  String get remove => 'Remove';

  @override
  String get editLine => 'Edit line';

  @override
  String get qtyLabel => 'Quantity';

  @override
  String get priceLabel => 'Price (₹)';

  @override
  String get priceLocked =>
      'Changing the price or discount needs the discount permission';

  @override
  String get discountLabel => 'Discount';

  @override
  String get discountRupees => '₹ off';

  @override
  String get discountPercent => '% off';

  @override
  String get apply => 'Apply';

  @override
  String serialLabel(String serial) {
    return 'S/N $serial';
  }

  @override
  String get customerTitle => 'Customer';

  @override
  String get customerNone => 'No customer';

  @override
  String get customerWalkIn => 'Walk-in';

  @override
  String get walkInDefaultName => 'Walk-in Customer';

  @override
  String get customerSearch => 'Search by mobile or name';

  @override
  String get customerAdd => 'Add customer';

  @override
  String get customerName => 'Name';

  @override
  String get customerPhoneOptional => 'Mobile (optional)';

  @override
  String get customerUseWalkIn => 'Bill as walk-in';

  @override
  String get customerClear => 'Remove customer';

  @override
  String customerOwes(String amount) {
    return 'Owes $amount';
  }

  @override
  String get customerNameRequired => 'Enter a name';

  @override
  String get estimate => 'Estimate';

  @override
  String get estimateNote =>
      'The final total is worked out when the bill is made';

  @override
  String itemsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count items',
      one: '1 item',
    );
    return '$_temp0';
  }

  @override
  String charge(String amount) {
    return 'Charge ≈ $amount';
  }

  @override
  String get makingBill => 'Making the bill…';

  @override
  String billNumber(String number) {
    return 'Bill $number';
  }

  @override
  String get subtotalLabel => 'Subtotal';

  @override
  String get taxableLabel => 'Taxable value';

  @override
  String get cgstLabel => 'CGST';

  @override
  String get sgstLabel => 'SGST';

  @override
  String get igstLabel => 'IGST';

  @override
  String get roundOffLabel => 'Round off';

  @override
  String get totalLabel => 'Total';

  @override
  String toPay(String amount) {
    return 'To pay $amount';
  }

  @override
  String get cashReceived => 'Cash received (₹)';

  @override
  String get upiAmount => 'UPI (₹)';

  @override
  String get cardAmount => 'Card (₹)';

  @override
  String get creditAmount => 'On credit (₹)';

  @override
  String get upiReceived => 'UPI payment received';

  @override
  String get referenceOptional => 'Reference (optional)';

  @override
  String changeDue(String amount) {
    return 'Change $amount';
  }

  @override
  String shortBy(String amount) {
    return 'Short by $amount';
  }

  @override
  String get problemOverNonCash =>
      'UPI, card and credit can\'t be more than the bill';

  @override
  String get problemUpiUnconfirmed =>
      'Confirm that the UPI payment was received';

  @override
  String get problemCreditNeedsCustomer => 'Credit needs a saved customer';

  @override
  String get problemCreditUnavailable =>
      'The credit book isn\'t on for this shop';

  @override
  String get completePayment => 'Complete';

  @override
  String get paymentFailed => 'A payment couldn\'t be recorded.';

  @override
  String get finishWithout => 'Finish without it';

  @override
  String get leaveBillTitle => 'Cancel this bill?';

  @override
  String get leaveBillBody =>
      'The bill is already made. Cancel it, or stay and take the payment.';

  @override
  String get cancelBill => 'Cancel bill';

  @override
  String get stay => 'Stay';

  @override
  String get saleComplete => 'Sale complete';

  @override
  String get giveChange => 'Give change';

  @override
  String addedToCredit(String amount) {
    return '$amount added to the customer\'s credit';
  }

  @override
  String paymentsMissing(String amount) {
    return 'The bill is saved, but $amount of payments couldn\'t be recorded. Add them from the bill on the web.';
  }

  @override
  String get creditLimitWarning =>
      'This customer is now over their credit limit.';

  @override
  String get shareWhatsApp => 'Share on WhatsApp';

  @override
  String shareText(String number, String amount, String url) {
    return 'Bill $number for $amount: $url';
  }

  @override
  String get couldNotOpenWhatsApp => 'Couldn\'t open WhatsApp';

  @override
  String get printReceipt => 'Print';

  @override
  String get printPreviewTitle => 'Receipt preview';

  @override
  String get printComingNext =>
      'Bluetooth printers come next. This is what will print.';

  @override
  String get newBill => 'New bill';

  @override
  String get closeLabel => 'Close';

  @override
  String get orderStatusPlaced => 'New';

  @override
  String get orderStatusConfirmed => 'Confirmed';

  @override
  String get orderStatusPacked => 'Packed';

  @override
  String get orderStatusShipped => 'Shipped';

  @override
  String get orderStatusDelivered => 'Delivered';

  @override
  String get orderStatusCancelled => 'Cancelled';

  @override
  String get orderStatusReturned => 'Returned';

  @override
  String get orderActionConfirm => 'Confirm';

  @override
  String get orderActionPack => 'Mark packed';

  @override
  String get orderActionShip => 'Mark shipped';

  @override
  String get orderActionDeliver => 'Mark delivered';

  @override
  String get orderActionCancel => 'Cancel order';

  @override
  String get orderActionReturn => 'Mark returned';

  @override
  String get paymentPaid => 'Paid';

  @override
  String get paymentCod => 'COD';

  @override
  String get paymentPending => 'Pending';

  @override
  String get paymentRefunded => 'Refunded';

  @override
  String get paymentPartRefunded => 'Part refunded';

  @override
  String get paymentUnpaid => 'Unpaid';

  @override
  String get channelStore => 'Online store';

  @override
  String get channelManual => 'Manual';

  @override
  String get channelPos => 'Counter';

  @override
  String get channelMarketplace => 'Marketplace';

  @override
  String get ordersAll => 'All';

  @override
  String get ordersSearch => 'Search orders';

  @override
  String get ordersEmpty => 'No orders';

  @override
  String orderTitle(String number) {
    return 'Order $number';
  }

  @override
  String get orderItems => 'Items';

  @override
  String get shipToLabel => 'Ship to';

  @override
  String get customerNoteLabel => 'Customer note';

  @override
  String get orderShipping => 'Shipping';

  @override
  String get orderCodFee => 'COD fee';

  @override
  String get orderPaidLabel => 'Paid';

  @override
  String get orderBalance => 'Balance due';

  @override
  String get orderPayments => 'Payments';

  @override
  String get orderNoPayments => 'No payments yet';

  @override
  String get orderTimeline => 'Timeline';

  @override
  String get orderShipment => 'Shipment';

  @override
  String get carrierLabel => 'Courier';

  @override
  String get trackingNumberLabel => 'Tracking number';

  @override
  String get trackingUrlLabel => 'Tracking link';

  @override
  String get trackingUrlInvalid =>
      'Enter a link starting with http:// or https://';

  @override
  String get shipTitle => 'Ship the order';

  @override
  String get cancelOrderTitle => 'Cancel the order?';

  @override
  String get cancelReasonRequired => 'Give a reason';

  @override
  String get cancelReasonCustomer => 'Customer asked';

  @override
  String get cancelReasonStock => 'Out of stock';

  @override
  String get cancelReasonPayment => 'Payment problem';

  @override
  String get cancelReasonDuplicate => 'Duplicate order';

  @override
  String get cancelReasonAddress => 'Address problem';

  @override
  String get keepOrder => 'Keep order';

  @override
  String get returnTitle => 'Mark the order returned?';

  @override
  String get returnBody =>
      'The items go back into stock and the invoice is cancelled. Record any refund on the web.';

  @override
  String get skipTo => 'Skip to';

  @override
  String get recordPayment => 'Record payment';

  @override
  String orderPayAmountInvalid(String amount) {
    return 'Enter an amount up to $amount';
  }

  @override
  String get makeInvoice => 'Make invoice';

  @override
  String invoiceLabel(String number) {
    return 'Invoice $number';
  }

  @override
  String get codDeliverNote =>
      'Marking it delivered records the COD balance as paid.';

  @override
  String get orderChanged =>
      'This order changed meanwhile. Showing the latest.';

  @override
  String eventStatus(String status) {
    return 'Moved to $status';
  }

  @override
  String eventPayment(String amount, String method) {
    return 'Payment $amount · $method';
  }

  @override
  String eventRefund(String amount) {
    return 'Refund $amount';
  }

  @override
  String get eventFulfillment => 'Shipping details updated';

  @override
  String get productsTitle => 'Products';

  @override
  String get stockTitle => 'Stock';

  @override
  String get productNew => 'New product';

  @override
  String get productsSearch => 'Search by name, SKU or barcode';

  @override
  String get allCategories => 'All categories';

  @override
  String get productArchived => 'Archived';

  @override
  String get productDraft => 'Draft';

  @override
  String get productsEmpty => 'No products';

  @override
  String variantsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count variants',
      one: '1 variant',
    );
    return '$_temp0';
  }

  @override
  String get stockNotTracked => 'Not tracked';

  @override
  String get stockOut => 'Out of stock';

  @override
  String stockLow(String qty) {
    return 'Low · $qty';
  }

  @override
  String stockQty(String qty) {
    return '$qty in stock';
  }

  @override
  String get productArchiveTitle => 'Archive this product?';

  @override
  String get productArchiveBody =>
      'It disappears from the store and the counter. You can make it active again later.';

  @override
  String get productArchive => 'Archive';

  @override
  String get productUnarchive => 'Make active';

  @override
  String productTax(String rate, String mode) {
    return 'GST $rate% · $mode';
  }

  @override
  String get taxIncluded => 'price includes GST';

  @override
  String get taxExtra => 'GST added on top';

  @override
  String percentOff(int percent) {
    return '$percent% off';
  }

  @override
  String get skuLabel => 'SKU';

  @override
  String get barcodeLabel => 'Barcode';

  @override
  String get mrpLabel => 'MRP (₹)';

  @override
  String codeFieldInvalid(String field) {
    return '$field: up to 64 characters, no spaces';
  }

  @override
  String get variantsFeatureNeeded =>
      'Only the price can be changed here: MRP, barcode and SKU need the \"Variants and options\" feature.';

  @override
  String get qtyInvalid => 'Enter a quantity';

  @override
  String get qtyDecimals => 'Quantity allows up to 3 decimals';

  @override
  String get qtyMoreThanZero => 'Quantity must be more than 0';

  @override
  String get openingStockFailed =>
      'The product is saved, but the opening stock wasn\'t.';

  @override
  String get productName => 'Product name';

  @override
  String get categoryLabel => 'Category';

  @override
  String get noCategory => 'No category';

  @override
  String get priceIncludesGst => 'Price includes GST';

  @override
  String get gstRateLabel => 'GST rate';

  @override
  String get unitLabel => 'Unit';

  @override
  String get openingStock => 'Opening stock';

  @override
  String stockValue(String amount) {
    return 'Stock value $amount';
  }

  @override
  String stockLowOut(int low, int out) {
    return '$low low · $out out';
  }

  @override
  String get stockFilterLow => 'Low';

  @override
  String get stockFilterOut => 'Out';

  @override
  String get allLocations => 'All locations';

  @override
  String get stockEmpty => 'Nothing here';

  @override
  String stockAvailable(String available, String reserved) {
    return '$available available · $reserved reserved for orders';
  }

  @override
  String get stockAdjust => 'Adjust stock';

  @override
  String reorderLevel(String qty) {
    return 'Low-stock level: $qty';
  }

  @override
  String avgCost(String cost, String value) {
    return 'Average cost $cost · value $value';
  }

  @override
  String get stockMovements => 'Movements';

  @override
  String get stockNoMovements => 'No movements yet';

  @override
  String get loadMore => 'Load more';

  @override
  String get moveOpening => 'Opening stock';

  @override
  String get moveAdjustment => 'Adjustment';

  @override
  String get moveSale => 'Sale';

  @override
  String get moveSaleCancel => 'Sale cancelled';

  @override
  String get moveSaleReturn => 'Sale return';

  @override
  String get moveSaleReturnCancel => 'Return cancelled';

  @override
  String get movePurchase => 'Purchase';

  @override
  String get movePurchaseCancel => 'Purchase cancelled';

  @override
  String get moveTransferOut => 'Transfer out';

  @override
  String get moveTransferIn => 'Transfer in';

  @override
  String stockNow(String qty) {
    return 'Now: $qty';
  }

  @override
  String stockAfter(String qty) {
    return 'After: $qty';
  }

  @override
  String get adjustAdd => 'Add';

  @override
  String get adjustRemove => 'Remove';

  @override
  String get adjustSet => 'Set to';

  @override
  String get stockNegativeWarning => 'Stock will go below zero.';

  @override
  String get balanceDueShort => 'Due';

  @override
  String get balanceAdvanceShort => 'Advance';

  @override
  String get balanceSettledShort => 'Settled';

  @override
  String get ledgerBalDue => 'due';

  @override
  String get ledgerBalAdvance => 'adv.';

  @override
  String get ledgerTypeOpening => 'Opening balance';

  @override
  String get ledgerTypeInvoice => 'Bill';

  @override
  String get ledgerTypePayment => 'Payment';

  @override
  String get ledgerTypeReceipt => 'Receipt';

  @override
  String get ledgerTypeCancel => 'Bill cancelled';

  @override
  String get ledgerTypeCreditNote => 'Credit note';

  @override
  String get ledgerTypeRefund => 'Refund';

  @override
  String get ageCurrent => 'Not yet due';

  @override
  String get age1to30 => '1–30 days';

  @override
  String get age31to60 => '31–60 days';

  @override
  String get age61to90 => '61–90 days';

  @override
  String get age90plus => 'Over 90 days';

  @override
  String get expenseCatRent => 'Rent';

  @override
  String get expenseCatSalaries => 'Salaries';

  @override
  String get expenseCatElectricity => 'Electricity';

  @override
  String get expenseCatTransport => 'Transport';

  @override
  String get expenseCatPackaging => 'Packaging';

  @override
  String get expenseCatMarketing => 'Marketing';

  @override
  String get expenseCatRepairs => 'Repairs';

  @override
  String get expenseCatOther => 'Other';

  @override
  String statementMessageDue(
      String name, String shop, String amount, String url) {
    return 'Hello $name, your balance with $shop is $amount. See your statement: $url';
  }

  @override
  String statementMessageAdvance(
      String name, String shop, String amount, String url) {
    return 'Hello $name, you have an advance of $amount with $shop. See your statement: $url';
  }

  @override
  String statementMessageSettled(String name, String shop, String url) {
    return 'Hello $name, your account with $shop is fully settled. Thank you! Statement: $url';
  }

  @override
  String get sortLabel => 'Sort';

  @override
  String get sortBiggestDue => 'Biggest dues first';

  @override
  String get sortOldestDue => 'Oldest due first';

  @override
  String get sortLastPayment => 'Latest payment first';

  @override
  String get sortName => 'Name';

  @override
  String get creditBookTitle => 'Credit book';

  @override
  String get toReceive => 'To receive';

  @override
  String get advanceHeld => 'Advance held';

  @override
  String get customersWithDues => 'Customers with dues';

  @override
  String get creditBookSearch => 'Search by name or phone';

  @override
  String get overdueFor => 'Overdue for';

  @override
  String get customersNoMatch => 'No matching customers';

  @override
  String get creditBookNoDues =>
      'No one owes you. Bills given on credit show up here.';

  @override
  String get creditBookNoAdvances =>
      'No advances. Money customers pay ahead of their bills shows up here.';

  @override
  String get creditBookEmpty =>
      'Your credit book is empty. Add customers and bill them on credit to track what they owe.';

  @override
  String dueSince(String date) {
    return 'Due since $date';
  }

  @override
  String lastActivity(String date) {
    return 'Last activity $date';
  }

  @override
  String get noActivity => 'No activity yet';

  @override
  String overdueAmount(String amount) {
    return '$amount overdue';
  }

  @override
  String receiveFrom(String name) {
    return 'Receive payment from $name';
  }

  @override
  String remindName(String name) {
    return 'Send a reminder to $name';
  }

  @override
  String remindSent(String name) {
    return 'Reminder sent to $name';
  }

  @override
  String remindFailed(String reason) {
    return 'Couldn\'t send the reminder: $reason';
  }

  @override
  String get remindViaWhatsApp => 'Use WhatsApp';

  @override
  String get amountRequired => 'Enter an amount';

  @override
  String get amountInvalid => 'Enter a valid amount';

  @override
  String get dateNotFuture => 'Pick a date up to today';

  @override
  String get tooLong => 'That is too long';

  @override
  String get receivePayment => 'Receive payment';

  @override
  String receiveHint(String name) {
    return 'From $name. It settles the oldest bills first; anything extra is kept as advance.';
  }

  @override
  String get amountReceived => 'Amount received';

  @override
  String balanceDueOf(String amount) {
    return 'Balance due: $amount';
  }

  @override
  String alreadyAdvance(String name, String amount) {
    return '$name already has $amount advance.';
  }

  @override
  String get dateLabel => 'Date';

  @override
  String get noteOptional => 'Note (optional)';

  @override
  String get saveReceipt => 'Save receipt';

  @override
  String receivedAmount(String amount) {
    return '$amount received';
  }

  @override
  String receivedFrom(String name, String date) {
    return 'From $name on $date';
  }

  @override
  String get settledAgainst => 'Settled against';

  @override
  String billNumberShort(String number) {
    return 'Bill $number';
  }

  @override
  String get noOpenBills =>
      'There were no open bills, so the whole amount is kept as advance.';

  @override
  String get keptAsAdvance => 'Kept as advance';

  @override
  String get done => 'Done';

  @override
  String get customersTitle => 'Customers';

  @override
  String get customersHasDues => 'Has dues';

  @override
  String get customersAdd => 'Add customer';

  @override
  String get customersEdit => 'Edit customer';

  @override
  String get customersSearch => 'Search by name, phone or GSTIN';

  @override
  String get customersEmpty =>
      'No customers yet. Save regular customers to bill them faster and track what they owe.';

  @override
  String customersLastBill(String date) {
    return 'Last bill $date';
  }

  @override
  String get customersOverLimit => 'Over credit limit';

  @override
  String get couldNotOpen => 'Couldn\'t open that on this phone';

  @override
  String get customerCall => 'Call';

  @override
  String get shareStatement => 'Share statement';

  @override
  String get sendReminder => 'Send reminder';

  @override
  String get ledgerTitle => 'Ledger';

  @override
  String ledgerOf(String name) {
    return 'Ledger · $name';
  }

  @override
  String get customerBills => 'Bills';

  @override
  String get customerNoBills => 'No bills for this customer yet.';

  @override
  String customerMoreBills(int count) {
    return '$count older bills on the web';
  }

  @override
  String billBalance(String amount) {
    return 'Balance $amount';
  }

  @override
  String get balanceDue => 'Balance due';

  @override
  String get balanceAdvance => 'Advance received';

  @override
  String get balanceSettled => 'All settled';

  @override
  String balanceDueHint(String name) {
    return '$name owes you this amount.';
  }

  @override
  String balanceAdvanceHint(String name) {
    return '$name has paid this much ahead. It will be used for the next bills.';
  }

  @override
  String balanceSettledHint(String name) {
    return 'Nothing pending from $name.';
  }

  @override
  String get creditLimit => 'Credit limit';

  @override
  String creditUsed(String used, String limit) {
    return '$used of $limit used';
  }

  @override
  String creditOver(String amount) {
    return 'Over the limit by $amount';
  }

  @override
  String creditAvailable(String amount) {
    return '$amount still available';
  }

  @override
  String get creditLimitHint =>
      'Leave empty for no limit. You\'ll see a warning when a bill crosses it.';

  @override
  String customerCreated(String name) {
    return '$name added';
  }

  @override
  String get customerUpdated => 'Customer updated';

  @override
  String get customerFormHint =>
      'Only the name is required. Add a GSTIN for business buyers.';

  @override
  String get requiredField => 'Required';

  @override
  String get customerPhone => 'Phone';

  @override
  String get customerEmail => 'Email';

  @override
  String get customerAddress => 'Address';

  @override
  String get emailInvalid => 'Enter a valid email';

  @override
  String get gstinInvalid => 'Enter a valid 15-character GSTIN';

  @override
  String get openingBalance => 'Opening balance';

  @override
  String get openingBalanceHint =>
      'Old balance from before you started billing here.';

  @override
  String get openingOwes => 'They owe me';

  @override
  String get openingAdvance => 'Paid in advance';

  @override
  String get expensesTitle => 'Expenses';

  @override
  String get expenseTitle => 'Expense';

  @override
  String get expenseAdd => 'Add expense';

  @override
  String get expenseCategories => 'Categories';

  @override
  String get periodThisMonth => 'This month';

  @override
  String get periodLastMonth => 'Last month';

  @override
  String get periodThisFy => 'This financial year';

  @override
  String get periodCustom => 'Pick dates';

  @override
  String periodRange(String from, String to) {
    return '$from – $to';
  }

  @override
  String summaryFor(String from, String to) {
    return 'Summary for $from – $to';
  }

  @override
  String get expensesSpent => 'Spent';

  @override
  String get expensesGst => 'GST paid';

  @override
  String get expensesEntries => 'Entries';

  @override
  String get expensesByCategory => 'Spent by category';

  @override
  String expensesListTotals(int count, String amount, String gst) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count expenses',
      one: '1 expense',
    );
    return '$_temp0 · $amount · GST $gst';
  }

  @override
  String get expensesEmpty =>
      'No expenses in this period. Record rent, salaries and bills here to see your real profit.';

  @override
  String get expenseCancelledBadge => 'Cancelled';

  @override
  String get expensePickCategory => 'Choose a category';

  @override
  String expenseCreated(String amount) {
    return 'Expense of $amount recorded';
  }

  @override
  String get expenseUpdated => 'Expense saved';

  @override
  String get expenseCancel => 'Cancel expense';

  @override
  String get expenseCancelTitle => 'Cancel this expense?';

  @override
  String get expenseCancelBody =>
      'It stays on record, marked cancelled, and is left out of totals and the profit report.';

  @override
  String get expenseCancelled => 'Expense cancelled';

  @override
  String get expenseCancelledHint =>
      'This expense is cancelled and left out of totals.';

  @override
  String get keepIt => 'Keep it';

  @override
  String get expenseAmount => 'Amount';

  @override
  String get expenseAmountHint => 'Enter the amount you paid, including GST.';

  @override
  String get expenseCategory => 'Category';

  @override
  String get expensePaidBy => 'Paid by';

  @override
  String get expenseNoteHint => 'What was it for?';

  @override
  String get expenseReferenceHint => 'Bill no., UPI ref or cheque no.';

  @override
  String expenseGstInside(String gst, String itc) {
    return 'GST $gst inside the amount · ITC $itc';
  }

  @override
  String get categoriesHint =>
      'Group your spending. Built-in categories can be renamed but not deleted.';

  @override
  String get categoryNew => 'New category name';

  @override
  String get categoryAdd => 'Add';

  @override
  String get categoryRename => 'Rename';

  @override
  String get categoryBuiltin => 'Built-in category';

  @override
  String categoryDeleteTitle(String name) {
    return 'Delete the $name category?';
  }

  @override
  String get categoryDeleteBody =>
      'Only categories with no expenses can be deleted.';

  @override
  String get delete => 'Delete';

  @override
  String get ledgerEmpty =>
      'No entries in this period. Pick a longer date range to see older entries.';

  @override
  String get ledgerBilled => 'Billed';

  @override
  String get ledgerReceived => 'Received';

  @override
  String get ledgerClosing => 'Closing balance';

  @override
  String ledgerBroughtForward(String date) {
    return 'Balance as of $date';
  }

  @override
  String get useAsTerminal => 'Use this phone as a POS terminal';

  @override
  String get pairTitle => 'Pair this phone with a terminal';

  @override
  String get pairSubtitle =>
      'In srikit on the web, open Settings → POS terminals, pick the terminal and show its pairing code.';

  @override
  String get pairScan => 'Scan the pairing QR';

  @override
  String get pairCodeLabel => 'Pairing code';

  @override
  String get pairButton => 'Pair';

  @override
  String get pairing => 'Pairing…';

  @override
  String get pairBackToSignIn => 'Sign in as owner or staff instead';

  @override
  String get pairErrorFormat => 'Enter the 8-character code, like ABCD-2345';

  @override
  String get pairErrorInvalid =>
      'This pairing code is wrong or has expired. Ask for a new one.';

  @override
  String get pairErrorTooMany =>
      'Too many tries. Wait a few minutes and try again.';

  @override
  String get pairErrorFeatureOff =>
      'POS terminals are not on for this shop\'s plan.';

  @override
  String get pairRevoked =>
      'This phone was unpaired from its terminal. Pair it again.';

  @override
  String get terminalOffline =>
      'Can\'t reach the server. Check the internet and try again.';

  @override
  String get terminalFeatureOff =>
      'This terminal can\'t be used: the feature is off for the shop.';

  @override
  String get lockTitle => 'Enter your PIN';

  @override
  String shopAndTerminal(String shop, String terminal) {
    return '$shop · $terminal';
  }

  @override
  String get unlock => 'Unlock';

  @override
  String pinInvalid(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Wrong PIN. $count tries left.',
      one: 'Wrong PIN. 1 try left.',
      zero: 'Wrong PIN.',
    );
    return '$_temp0';
  }

  @override
  String get pinWrong => 'Wrong PIN.';

  @override
  String pinLocked(String time) {
    return 'Too many wrong PINs. Try again in $time.';
  }

  @override
  String get pinNotAllowed =>
      'You can\'t use this terminal. Ask the owner for access.';

  @override
  String get lockedIdle => 'Locked after a while without use.';

  @override
  String get sessionEnded => 'Your session ended. Enter your PIN again.';

  @override
  String get teamMember => 'Team member';

  @override
  String get noPinYet => 'No PIN yet';

  @override
  String get pinClear => 'Clear';

  @override
  String get pinBack => 'Delete';

  @override
  String get lockButton => 'Lock';

  @override
  String get switchCashier => 'Switch cashier';

  @override
  String cashierLabel(String name) {
    return 'Cashier: $name';
  }

  @override
  String get terminalSettings => 'Terminal';

  @override
  String get syncItems => 'Sync items';

  @override
  String catalogueStatus(int count, String time) {
    return '$count items · synced $time';
  }

  @override
  String get catalogueNotSynced => 'Items not synced yet';

  @override
  String catalogueSyncFailed(String error) {
    return 'Could not sync items: $error';
  }

  @override
  String get unpairPhone => 'Unpair this phone';

  @override
  String get unpairTitle => 'Unpair this phone?';

  @override
  String unpairBody(String terminal) {
    return 'It stops being $terminal. To use it again, pair it with a new code.';
  }

  @override
  String get unpair => 'Unpair';

  @override
  String enterWeightTitle(String item) {
    return 'Weight of $item';
  }

  @override
  String get weightKgLabel => 'Weight (kg)';

  @override
  String get weightInvalid => 'Enter a weight above 0, up to 999.999 kg';

  @override
  String get add => 'Add';

  @override
  String ticketAdded(String code) {
    return 'Weigh ticket $code added';
  }

  @override
  String ticketNotFound(String code) {
    return 'No weigh ticket $code.';
  }

  @override
  String ticketUsed(String code) {
    return 'Ticket $code is already billed.';
  }

  @override
  String ticketExpired(String code) {
    return 'Ticket $code has expired (tickets are valid for the day).';
  }

  @override
  String ticketCancelled(String code) {
    return 'Ticket $code was cancelled.';
  }

  @override
  String ticketDuplicate(String code) {
    return 'Ticket $code is already on this bill.';
  }

  @override
  String ticketEmpty(String code) {
    return 'Ticket $code has no lines.';
  }

  @override
  String ticketLabel(String code) {
    return 'Ticket $code';
  }

  @override
  String removeTicketTitle(String code) {
    return 'Remove ticket $code?';
  }

  @override
  String get removeTicketBody => 'All its lines leave the bill.';

  @override
  String ticketUseFailed(String code, String error) {
    return 'Ticket $code could not be marked as billed: $error';
  }

  @override
  String get weighingTitle => 'Weighing station';

  @override
  String weighItem(String item) {
    return 'Weigh $item';
  }

  @override
  String countItem(String item) {
    return 'How many $item?';
  }

  @override
  String get grossLabel => 'Weight on the scale (kg)';

  @override
  String get tareLabel => 'Tare (kg)';

  @override
  String netWeight(String kg) {
    return 'Net $kg kg';
  }

  @override
  String get netInvalid =>
      'Net weight must be more than 0 and at most 999.999 kg';

  @override
  String get manualScale => 'No scale connected: type the weight.';

  @override
  String get addToTicket => 'Add to ticket';

  @override
  String ticketLines(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count lines',
      one: '1 line',
      zero: 'No lines yet',
    );
    return '$_temp0';
  }

  @override
  String issueTicket(String amount) {
    return 'Issue ticket · ≈ $amount';
  }

  @override
  String get issuing => 'Issuing…';

  @override
  String get ticketTitle => 'Weigh ticket';

  @override
  String get ticketHint =>
      'Hand this to the customer; the counter scans the code.';

  @override
  String get printTicket => 'Print ticket';

  @override
  String get nextCustomer => 'Next customer';

  @override
  String get todayTickets => 'Today\'s tickets';

  @override
  String get noTicketsToday => 'No tickets today';

  @override
  String get cancelTicket => 'Cancel ticket';

  @override
  String cancelTicketTitle(String code) {
    return 'Cancel ticket $code?';
  }

  @override
  String get ticketStatusOpen => 'Open';

  @override
  String get ticketStatusUsed => 'Billed';

  @override
  String get ticketStatusCancelled => 'Cancelled';

  @override
  String get byWeight => 'By weight';

  @override
  String get weighFirst => 'Pick an item to weigh';
}
