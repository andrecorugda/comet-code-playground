// star-burxt — a .sbmx document becomes a component, or a refusal naming what is wrong.
//
// star's generator is compiled from its published surface to wasm, so the whole pipeline runs in the
// page: BMX's parser refuses malformed markup with `BMX-Ennn`, star refuses a document that is not a
// component with `STAR-Ennn`, and anything that survives both is shown as the Burxt it became.
//
// **Seven imports, and two of them are traps.** `memcpy` stubbed traps immediately inside the
// generator — loud, minutes lost. `snprintf` stubbed loses every POSITION while every message still
// reads correctly: `BMX-E001 at :` instead of `at 45:`. Both are implemented properly below.
import comet from '../comet.js';

let mem = null;
let brk = 0;
let received = '';
const u8 = () => new Uint8Array(mem.buffer);
const dv = () => new DataView(mem.buffer);

// A Burxt String is LENGTH-PREFIXED: eight little-endian bytes, then the bytes, then a NUL, and the
// pointer that crosses the boundary points at the bytes. Reading one as a C string gives a plausible
// WRONG answer, which is how it cost an hour: `STAR-E003: declares no props block`, about a document
// whose first line declares props.
const readBx = (p) => {
  const len = Number(dv().getBigUint64(p - 8, true));
  return new TextDecoder().decode(u8().subarray(p, p + len));
};
const cstr = (p) => {
  const b = u8();
  let e = p;
  while (b[e] !== 0) e += 1;
  return new TextDecoder().decode(b.subarray(p, e));
};

const hostMalloc = (n) => {
  n = Number(n);
  if (!brk) brk = mem.buffer.byteLength;
  const need = brk + n;
  if (need > mem.buffer.byteLength) {
    mem.grow(Math.ceil((need - mem.buffer.byteLength) / 65536) + 1);
  }
  const p = brk;
  brk = need;
  return p;
};

// Enough of printf for the diagnostics: `%s` and the integer conversions, which is what a position is.
const format = (f, va) => {
  const d = dv();
  let a = va;
  let s = '';
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] !== '%') { s += f[i]; continue; }
    i += 1;
    let flags = '';
    while ('-+ #0'.includes(f[i])) { flags += f[i]; i += 1; }
    let width = '';
    while (f[i] >= '0' && f[i] <= '9') { width += f[i]; i += 1; }
    let length = '';
    while ('hlLzjt'.includes(f[i])) { length += f[i]; i += 1; }
    const c = f[i];
    if (c === '%') { s += '%'; continue; }
    let text;
    if (c === 's') {
      text = cstr(d.getUint32(a, true));
      a += 4;
    } else {
      let v;
      if (length.includes('l') || length.includes('z')) {
        a = (a + 7) - ((a + 7) % 8);
        v = c === 'u' ? d.getBigUint64(a, true) : d.getBigInt64(a, true);
        a += 8;
      } else {
        v = c === 'u' ? BigInt(d.getUint32(a, true)) : BigInt(d.getInt32(a, true));
        a += 4;
      }
      text = v.toString();
    }
    const n = width ? parseInt(width, 10) : 0;
    if (text.length < n) text = text.padStart(n, flags.includes('0') && c !== 's' ? '0' : ' ');
    s += text;
  }
  return s;
};


async function loadGenerator(base) {
  const bytes = await (await fetch(base + 'star-generate.wasm')).arrayBuffer();
  const env = {
    malloc: hostMalloc,
    memcpy: (d, s, n) => { u8().copyWithin(d, s, s + Number(n)); return d; },
    snprintf: (buf, n, fmt, va) => {
      n = Number(n);
      const b = new TextEncoder().encode(format(cstr(fmt), va));
      const k = Math.min(b.length, n - 1);
      u8().set(b.subarray(0, k), buf);
      u8()[buf + k] = 0;
      return b.length;
    },
    fprintf: () => 0,
    fwrite: () => 0,
    exit: (c) => { throw new Error('burxt exit ' + c); },
    host_result: (p) => { received = readBx(Number(p)); return 0; },
  };
  const { instance } = await WebAssembly.instantiate(bytes, { env });
  mem = instance.exports.memory;
  const alloc = instance.exports['burxt.alloc'];
  const play = instance.exports['bx.play'];
  generate = (source) => {
    const b = new TextEncoder().encode(source);
    const p = Number(alloc(BigInt(8 + b.length + 1)));
    dv().setBigUint64(p, BigInt(b.length), true);
    u8().set(b, p + 8);
    u8()[p + 8 + b.length] = 0;
    received = '';
    play(p + 8);
    return received;
  };
}

let generate = null;
let loading = null;

async function load(base) {
  const bytes = await (await fetch(base + 'star-generate.wasm')).arrayBuffer();
  const env = {
    malloc: hostMalloc,
    memcpy: (d, s, n) => { u8().copyWithin(d, s, s + Number(n)); return d; },
    snprintf: (buf, n, fmt, va) => {
      n = Number(n);
      const b = new TextEncoder().encode(format(cstr(fmt), va));
      const k = Math.min(b.length, n - 1);
      u8().set(b.subarray(0, k), buf);
      u8()[buf + k] = 0;
      return b.length;
    },
    fprintf: () => 0,
    fwrite: () => 0,
    exit: (c) => { throw new Error('burxt exit ' + c); },
    host_result: (p) => { received = readBx(Number(p)); return 0; },
  };
  const { instance } = await WebAssembly.instantiate(bytes, { env });
  mem = instance.exports.memory;
  const alloc = instance.exports['burxt.alloc'];
  const play = instance.exports['bx.play'];
  generate = (source) => {
    const b = new TextEncoder().encode(source);
    const p = Number(alloc(BigInt(8 + b.length + 1)));
    dv().setBigUint64(p, BigInt(b.length), true);
    u8().set(b, p + 8);
    u8()[p + 8 + b.length] = 0;
    received = '';
    play(p + 8);
    return received;
  };
}

comet.register({
  id: 'sbmx',
  label: 'star-burxt',
  async run({ source }) {
    if (!source.trim()) return { output: '' };
    // Loaded once, on first use, so a page that never opens this tab never downloads it.
    if (!generate) {
      if (!loading) loading = load(new URL('.', import.meta.url).href.replace(/adapters\/$/, ''));
      await loading;
    }
    const answer = generate(source);
    // A refusal from either layer starts with its code; anything else is the component it made.
    return /^(BMX|STAR)-E\d+/.test(answer) ? { error: answer } : { output: answer };
  },
});
