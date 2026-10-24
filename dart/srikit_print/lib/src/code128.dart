/// Code 128 for weigh tickets ("W" + 11 digits), ported from packages/pos-ui/src/lib/code128.ts so the phone draws the
/// same bars as the web: code set B for text (C for an even run of digits only), modulo-103 check symbol, stop.
library;

/// Bar/space widths of symbol values 0..106 (106 = stop, 7 elements).
const code128Patterns = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', //
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const _startB = 104;
const _startC = 105;
const _stop = 106;

/// Symbol values (start, data, check, stop) for [text] (printable ASCII 32..126). Throws [ArgumentError] otherwise.
List<int> code128Values(String text) {
  final values = <int>[];
  if (text.length >= 2 && text.length.isEven && RegExp(r'^\d+$').hasMatch(text)) {
    values.add(_startC);
    for (var i = 0; i < text.length; i += 2) {
      values.add(int.parse(text.substring(i, i + 2)));
    }
  } else {
    values.add(_startB);
    for (final c in text.codeUnits) {
      if (c < 32 || c > 126) throw ArgumentError.value(text, 'text', 'Code 128 B can only encode printable ASCII');
      values.add(c - 32);
    }
  }
  var sum = values[0];
  for (var i = 1; i < values.length; i++) {
    sum += values[i] * i;
  }
  values
    ..add(sum % 103)
    ..add(_stop);
  return values;
}

/// Element widths in modules, bar first, alternating bar / space (the last element is a bar).
List<int> code128Widths(String text) =>
    [for (final v in code128Values(text)) ...code128Patterns[v].split('').map(int.parse)];

/// A bar at [x] modules, [w] modules wide.
class Code128Bar {
  const Code128Bar(this.x, this.w);
  final int x;
  final int w;
}

/// The bars of [text] and the total width in modules (without quiet zones; leave 10 modules on each side).
({List<Code128Bar> bars, int modules}) code128Bars(String text) {
  final widths = code128Widths(text);
  final bars = <Code128Bar>[];
  var x = 0;
  for (var i = 0; i < widths.length; i++) {
    if (i.isEven) bars.add(Code128Bar(x, widths[i]));
    x += widths[i];
  }
  return (bars: bars, modules: x);
}
