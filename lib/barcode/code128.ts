/**
 * Code 128 (subset B) encoder. Ticket codes are uppercase letters, digits
 * and "-", all of which live in subset B. Returns the barcode as a string of
 * modules: "1" = bar, "0" = space (start, data, checksum and stop included).
 */

// Bar/space widths (in modules) for symbol values 0–105, alternating bar,
// space, bar, space, bar, space. Each row sums to 11.
const WIDTHS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232",
];
const STOP_WIDTHS = "2331112"; // value 106; 7 elements, ends in a 2-module bar
const START_B = 104;

function widthsToModules(widths: string): string {
  let bar = true;
  let out = "";
  for (const w of widths) {
    out += (bar ? "1" : "0").repeat(Number(w));
    bar = !bar;
  }
  return out;
}

export function encodeCode128B(text: string): string {
  if (text.length === 0) throw new Error("Nothing to encode.");
  const values: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Code 128B can't encode "${ch}".`);
    values.push(code - 32);
  }
  const checksum = (START_B + values.reduce((sum, value, i) => sum + value * (i + 1), 0)) % 103;
  return (
    [START_B, ...values, checksum].map((v) => widthsToModules(WIDTHS[v])).join("") +
    widthsToModules(STOP_WIDTHS)
  );
}
