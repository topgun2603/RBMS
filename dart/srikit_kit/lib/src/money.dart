/// Formats paise as rupees with Indian digit grouping: `12345678` → `₹1,23,456.78`.
///
/// [paise] is the API's money unit. [symbol] adds `₹`; [decimals] false drops the paise (rounding half away from
/// zero), for dashboard cards: `₹1,23,457`.
String formatPaise(int paise, {bool symbol = true, bool decimals = true}) {
  final negative = paise < 0;
  var abs = paise.abs();
  if (!decimals) abs = ((abs + 50) ~/ 100) * 100;
  final rupees = abs ~/ 100;
  final fraction = (abs % 100).toString().padLeft(2, '0');
  final grouped = groupIndian(rupees.toString());
  return '${negative && abs > 0 ? '-' : ''}${symbol ? '₹' : ''}$grouped${decimals ? '.$fraction' : ''}';
}

/// Indian grouping of a run of digits: the last three, then pairs (`1234567` → `12,34,567`).
String groupIndian(String digits) {
  if (digits.length <= 3) return digits;
  final last3 = digits.substring(digits.length - 3);
  var rest = digits.substring(0, digits.length - 3);
  final parts = <String>[];
  while (rest.length > 2) {
    parts.insert(0, rest.substring(rest.length - 2));
    rest = rest.substring(0, rest.length - 2);
  }
  if (rest.isNotEmpty) parts.insert(0, rest);
  return '${parts.join(',')},$last3';
}
