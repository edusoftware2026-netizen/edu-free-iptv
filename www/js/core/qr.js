/* Generador mínimo de Código QR (Byte mode, ECC-L) en SVG puro sin dependencias externas. */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// Capacidades ECC-L (bytes totales, bytes datos, ec por bloque, bloques) para versiones 1..6
const VERSIONS = [
  null,
  { size: 21, total: 26, data: 19, ec: 7, align: [] },
  { size: 25, total: 44, data: 34, ec: 10, align: [6, 18] },
  { size: 29, total: 70, data: 55, ec: 15, align: [6, 22] },
  { size: 33, total: 100, data: 80, ec: 20, align: [6, 26] },
  { size: 37, total: 134, data: 108, ec: 26, align: [6, 30] },
  { size: 41, total: 172, data: 136, ec: 18, blocks: 2, align: [6, 34] },
];

export function renderQrSvg(text, px = 200) {
  const bytes = new TextEncoder().encode(String(text || ''));
  let ver = 1;
  while (ver <= 6 && VERSIONS[ver].data < bytes.length + 2) ver++;
  if (ver > 6) return '';

  const spec = VERSIONS[ver];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);
  pushBits(0, Math.min(4, spec.data * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    dataBytes.push(v);
  }
  const pad = [0xec, 0x11];
  let pi = 0;
  while (dataBytes.length < spec.data) {
    dataBytes.push(pad[pi++ % 2]);
  }

  let codewords;
  if (spec.blocks === 2) {
    const half = spec.data / 2;
    const b1 = dataBytes.slice(0, half);
    const b2 = dataBytes.slice(half);
    const e1 = rsEncode(b1, spec.ec);
    const e2 = rsEncode(b2, spec.ec);
    codewords = [];
    for (let i = 0; i < half; i++) { codewords.push(b1[i], b2[i]); }
    for (let i = 0; i < spec.ec; i++) { codewords.push(e1[i], e2[i]); }
  } else {
    const ec = rsEncode(dataBytes, spec.ec);
    codewords = [...dataBytes, ...ec];
  }

  const n = spec.size;
  const mat = Array.from({ length: n }, () => new Int8Array(n).fill(-1));
  const reserved = Array.from({ length: n }, () => new Uint8Array(n));

  const setMod = (r, c, v, res = true) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    mat[r][c] = v ? 1 : 0;
    if (res) reserved[r][c] = 1;
  };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setMod(rr, cc, on, true);
      }
    }
  };

  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);

  if (spec.align.length) {
    const pos = spec.align[1];
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const on = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
        setMod(pos + r, pos + c, on, true);
      }
    }
  }

  for (let i = 8; i < n - 8; i++) {
    setMod(6, i, i % 2 === 0, true);
    setMod(i, 6, i % 2 === 0, true);
  }
  setMod(n - 8, 8, 1, true);

  // Reservar áreas de formato
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = 1;
      reserved[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][n - 1 - i] = 1;
    reserved[n - 1 - i][8] = 1;
  }

  // Colocar bits en zigzag
  const allBits = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) allBits.push((cw >> i) & 1);
  }

  let bi = 0;
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!reserved[r][c]) {
          const bit = bi < allBits.length ? allBits[bi++] : 0;
          const masked = ((r + c) % 2 === 0) ? bit ^ 1 : bit; // Mask 0
          mat[r][c] = masked;
        }
      }
    }
    up = !up;
  }

  // Formato ECC-L (01) + Mask 0 (000) -> BCH = 111011111000100
  const fmt = 0b111011111000100;
  for (let i = 0; i < 6; i++) {
    const b = (fmt >> (14 - i)) & 1;
    mat[8][i] = b;
    mat[n - 1 - i][8] = b;
  }
  mat[8][7] = (fmt >> 8) & 1;
  mat[8][8] = (fmt >> 7) & 1;
  mat[7][8] = (fmt >> 6) & 1;
  mat[n - 7][8] = (fmt >> 8) & 1;
  for (let i = 0; i < 7; i++) {
    const b = (fmt >> (6 - i)) & 1;
    if (i > 0) mat[6 - i][8] = b;
    mat[8][n - 7 + i] = b;
  }
  mat[8][n - 8] = (fmt >> 7) & 1;

  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mat[r][c] === 1) rects += `<rect x="${c}" y="${r}" width="1" height="1"/>`;
    }
  }
  const vb = n + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${vb} ${vb}" width="${px}" height="${px}" shape-rendering="crispEdges" style="background:#fff;border-radius:12px"><g fill="#05050a">${rects}</g></svg>`;
}
