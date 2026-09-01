// Code-128 (subset B) barcode encoder → SVG string.
// Used for barcode-ready part labels (Module D).

// Bar/space width patterns for code values 0..106 (6 modules each).
const PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212',
  '221213','221312','231212','112232','122132','122231','113222','123122','123221',
  '223211','221132','221231','213212','223112','312131','311222','321122','321221',
  '312212','322112','322211','212123','212321','232121','111323','131123','131321',
  '112313','132113','132311','211313','231113','231311','112133','112331','132131',
  '113123','113321','133121','313121','211331','231131','213113','213311','213131',
  '311123','311321','331121','312113','312311','332111','314111','221411','431111',
  '111224','111422','121124','121421','141122','141221','112214','112412','122114',
  '122411','142112','142211','241211','221114','413111','241112','134111','111242',
  '121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311',
  '113141','114131','311141','411131','211412','211214','211232',
  '2331112', // 106: Stop (7 modules)
];

const START_B = 104;
const STOP = 106;

function value(charCode) {
  // Code 128 subset B: value = ASCII - 32 for space..DEL
  return charCode - 32;
}

export function code128(text) {
  if (!text) return '';
  const chars = [...text];
  const codes = [];
  let sum = START_B;
  codes.push(START_B);
  chars.forEach((ch, i) => {
    const v = value(ch.codePointAt(0));
    if (v < 0 || v > 95) throw new Error(`Code-128B cannot encode ${JSON.stringify(ch)}`);
    codes.push(v);
    sum += v * (i + 1);
  });
  codes.push(sum % 103);
  codes.push(STOP);

  // Build the module pattern.
  let modules = '';
  for (const c of codes) modules += PATTERNS[c];
  modules += '11'; // termination bar (2 modules)

  // Total width in modules = sum of the width digits (each is 1-4 modules).
  const width = [...modules].reduce((a, c) => a + parseInt(c, 10), 0);
  const height = 1; // normalized; rendered scaled by viewBox

  let bars = '';
  let x = 0;
  for (let i = 0; i < modules.length; i++) {
    const w = parseInt(modules[i], 10);
    if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`;
    x += w;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="background:#fff">${bars}</svg>`;
}
