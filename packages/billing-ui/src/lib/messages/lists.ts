import type { Messages } from "@rbms/i18n/client";

/**
 * billing.* strings of the server-driven list pages (columns, filters, pills): customers, credit book, items, stock,
 * purchases, suppliers, credit notes and expenses. Keep the en and ta key sets identical.
 */
export const en: Messages = {
  "billing.common.actions": "Actions",

  // customers
  "billing.customers.all": "All",
  "billing.customers.filter.balance": "Balance",
  "billing.customers.filter.creditLimit": "Credit limit",
  "billing.customers.balance.due": "Has dues",
  "billing.customers.balance.advance": "Advance",
  "billing.customers.balance.settled": "Settled",
  "billing.customers.overLimit": "Over credit limit",
  "billing.customers.withinLimit": "Within limit",
  "billing.customers.col.name": "Customer",
  "billing.customers.col.phone": "Phone",
  "billing.customers.col.lastBill": "Last bill",
  "billing.customers.col.billed": "Total billed",
  "billing.customers.col.balance": "Balance",
  "billing.customers.col.status": "Status",
  "billing.customers.lastBillOn": "Last bill {date}",

  // credit book
  "billing.creditBook.ageFilter": "Overdue for",
  "billing.creditBook.age.current": "Not yet due",
  "billing.creditBook.age.1-30": "1–30 days",
  "billing.creditBook.age.31-60": "31–60 days",
  "billing.creditBook.age.61-90": "61–90 days",
  "billing.creditBook.age.90+": "Over 90 days",
  "billing.creditBook.col.customer": "Customer",
  "billing.creditBook.col.oldestDue": "Oldest due",
  "billing.creditBook.col.overdue": "Overdue",
  "billing.creditBook.col.lastPayment": "Last payment",
  "billing.creditBook.col.balance": "Balance",
  "billing.creditBook.col.status": "Status",
  "billing.creditBook.oldestDueOn": "Due since {date}",

  // items
  "billing.items.count": "{count, plural, one {# item} other {# items}}",
  "billing.items.filter.category": "Category",
  "billing.items.filter.stock": "Stock",
  "billing.items.filter.active": "Active",
  "billing.items.stock.in": "In stock",
  "billing.items.stock.low": "Low",
  "billing.items.stock.out": "Out of stock",
  "billing.items.active": "Active",
  "billing.items.inactive": "Inactive",
  "billing.items.noCategory": "No category",
  "billing.items.col.name": "Item",
  "billing.items.col.category": "Category",
  "billing.items.col.stock": "Stock",
  "billing.items.col.gst": "GST",
  "billing.items.col.price": "Price",

  // stock
  "billing.stock.statusFilter.in": "In stock",
  "billing.stock.statusFilter.low": "Low",
  "billing.stock.statusFilter.out": "Out of stock",
  "billing.stock.statusFilter.untracked": "Not tracked",
  "billing.stock.filter.location": "Location",

  // purchases
  "billing.purchases.all": "All",
  "billing.purchases.countAll": "{count, plural, one {# purchase} other {# purchases}}",
  "billing.purchases.filter.status": "Status",
  "billing.purchases.filter.date": "Bill date",
  "billing.purchases.status.unpaid": "Unpaid",
  "billing.purchases.status.paid": "Paid",
  "billing.purchases.status.cancelled": "Cancelled",
  "billing.purchases.col.number": "Bill no.",
  "billing.purchases.col.date": "Date",
  "billing.purchases.col.supplier": "Supplier",
  "billing.purchases.col.status": "Status",
  "billing.purchases.col.total": "Total",
  "billing.purchases.col.balance": "To pay",
  "billing.purchases.toPay": "To pay {amount}",

  // suppliers
  "billing.suppliers.count": "{count, plural, one {# supplier} other {# suppliers}}",
  "billing.suppliers.col.name": "Supplier",
  "billing.suppliers.col.gstin": "GSTIN",
  "billing.suppliers.col.lastPurchase": "Last purchase",
  "billing.suppliers.col.balance": "To pay",
  "billing.suppliers.lastPurchaseOn": "Last purchase {date}",

  // credit notes
  "billing.cn.col.number": "Credit note",
  "billing.cn.col.date": "Date",
  "billing.cn.col.customer": "Customer",
  "billing.cn.col.bill": "Bill",
  "billing.cn.col.refund": "Refund",
  "billing.cn.col.total": "Total",
  "billing.cn.refundedIn": "{amount} back in {mode}",

  // expenses
  "billing.expenses.filter.status": "Status",
  "billing.expenses.status.recorded": "Recorded",
  "billing.expenses.summaryPeriod": "Summary for {from} – {to}",
  "billing.expenses.listTotals": "{count, plural, one {# expense} other {# expenses}} · {amount} · GST {gst}",
};

export const ta: Messages = {
  "billing.common.actions": "செயல்கள்",

  // customers
  "billing.customers.all": "அனைத்தும்",
  "billing.customers.filter.balance": "நிலுவை",
  "billing.customers.filter.creditLimit": "கடன் வரம்பு",
  "billing.customers.balance.due": "நிலுவை உள்ளவர்கள்",
  "billing.customers.balance.advance": "முன்பணம்",
  "billing.customers.balance.settled": "தீர்ந்தது",
  "billing.customers.overLimit": "கடன் வரம்பைத் தாண்டியது",
  "billing.customers.withinLimit": "வரம்புக்குள்",
  "billing.customers.col.name": "வாடிக்கையாளர்",
  "billing.customers.col.phone": "தொலைபேசி",
  "billing.customers.col.lastBill": "கடைசி பில்",
  "billing.customers.col.billed": "மொத்த பில்",
  "billing.customers.col.balance": "நிலுவை",
  "billing.customers.col.status": "நிலை",
  "billing.customers.lastBillOn": "கடைசி பில் {date}",

  // credit book
  "billing.creditBook.ageFilter": "தாமதம்",
  "billing.creditBook.age.current": "இன்னும் கெடு வரவில்லை",
  "billing.creditBook.age.1-30": "1–30 நாட்கள்",
  "billing.creditBook.age.31-60": "31–60 நாட்கள்",
  "billing.creditBook.age.61-90": "61–90 நாட்கள்",
  "billing.creditBook.age.90+": "90 நாட்களுக்கு மேல்",
  "billing.creditBook.col.customer": "வாடிக்கையாளர்",
  "billing.creditBook.col.oldestDue": "பழைய நிலுவை",
  "billing.creditBook.col.overdue": "கெடு தாண்டியது",
  "billing.creditBook.col.lastPayment": "கடைசி வரவு",
  "billing.creditBook.col.balance": "நிலுவை",
  "billing.creditBook.col.status": "நிலை",
  "billing.creditBook.oldestDueOn": "{date} முதல் நிலுவை",

  // items
  "billing.items.count": "{count, plural, one {# பொருள்} other {# பொருட்கள்}}",
  "billing.items.filter.category": "வகை",
  "billing.items.filter.stock": "இருப்பு",
  "billing.items.filter.active": "செயலில்",
  "billing.items.stock.in": "இருப்பில் உள்ளது",
  "billing.items.stock.low": "குறைவு",
  "billing.items.stock.out": "இருப்பு இல்லை",
  "billing.items.active": "செயலில்",
  "billing.items.inactive": "செயலில் இல்லை",
  "billing.items.noCategory": "வகை இல்லை",
  "billing.items.col.name": "பொருள்",
  "billing.items.col.category": "வகை",
  "billing.items.col.stock": "இருப்பு",
  "billing.items.col.gst": "GST",
  "billing.items.col.price": "விலை",

  // stock
  "billing.stock.statusFilter.in": "இருப்பில் உள்ளது",
  "billing.stock.statusFilter.low": "குறைவு",
  "billing.stock.statusFilter.out": "இருப்பு இல்லை",
  "billing.stock.statusFilter.untracked": "கணக்கிடப்படாதவை",
  "billing.stock.filter.location": "இடம்",

  // purchases
  "billing.purchases.all": "அனைத்தும்",
  "billing.purchases.countAll": "{count, plural, one {# கொள்முதல்} other {# கொள்முதல்கள்}}",
  "billing.purchases.filter.status": "நிலை",
  "billing.purchases.filter.date": "பில் தேதி",
  "billing.purchases.status.unpaid": "செலுத்தவில்லை",
  "billing.purchases.status.paid": "செலுத்தப்பட்டது",
  "billing.purchases.status.cancelled": "ரத்தானது",
  "billing.purchases.col.number": "பில் எண்",
  "billing.purchases.col.date": "தேதி",
  "billing.purchases.col.supplier": "சப்ளையர்",
  "billing.purchases.col.status": "நிலை",
  "billing.purchases.col.total": "மொத்தம்",
  "billing.purchases.col.balance": "செலுத்த வேண்டியது",
  "billing.purchases.toPay": "செலுத்த வேண்டியது {amount}",

  // suppliers
  "billing.suppliers.count": "{count, plural, one {# சப்ளையர்} other {# சப்ளையர்கள்}}",
  "billing.suppliers.col.name": "சப்ளையர்",
  "billing.suppliers.col.gstin": "GSTIN",
  "billing.suppliers.col.lastPurchase": "கடைசி கொள்முதல்",
  "billing.suppliers.col.balance": "செலுத்த வேண்டியது",
  "billing.suppliers.lastPurchaseOn": "கடைசி கொள்முதல் {date}",

  // credit notes
  "billing.cn.col.number": "வரவுக் குறிப்பு",
  "billing.cn.col.date": "தேதி",
  "billing.cn.col.customer": "வாடிக்கையாளர்",
  "billing.cn.col.bill": "பில்",
  "billing.cn.col.refund": "திருப்பித் தந்தது",
  "billing.cn.col.total": "மொத்தம்",
  "billing.cn.refundedIn": "{mode} மூலம் {amount} திருப்பித் தரப்பட்டது",

  // expenses
  "billing.expenses.filter.status": "நிலை",
  "billing.expenses.status.recorded": "பதிவானது",
  "billing.expenses.summaryPeriod": "{from} – {to} சுருக்கம்",
  "billing.expenses.listTotals": "{count, plural, one {# செலவு} other {# செலவுகள்}} · {amount} · GST {gst}",
};
