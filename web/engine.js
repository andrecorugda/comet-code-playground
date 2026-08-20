// The one place JavaScript is unavoidable: handing a WebAssembly module its imports.
//
// **Nothing here decides anything.** Every answer the playground gives is computed in Burxt, inside
// `comet-engine.wasm` — star's generator and BMX's renderer, both compiled from source that is already
// a dependency. This file allocates a string, calls a function, and reads a string back.
//
// It exists because a wasm module cannot supply its own imports and a browser has no entry point that
// is not JavaScript. That is the boundary, and it is the whole of it. When something here starts making
// a decision, that decision belongs in Burxt instead.
//
// **Two of the seven imports are traps.** `memcpy` stubbed to 0 traps immediately inside the module —
// loud, minutes lost. `snprintf` stubbed to 0 loses every POSITION while every message still reads
// correctly: `BMX-E001 at :` instead of `at 45:`. A diagnostic that keeps its words and drops its
// offset is worse than one that fails.
//
// `__multi3` is implemented because star's own driver implements it and explains why: clang emits it for
// any `Int` multiplication whose overflow must be detected exactly, and a stub returning 0 produces
// wrong products that then trip the overflow check on a correct program.

let mem = null;
let brk = 0;
let received = '';

const u8 = () => new Uint8Array(mem.buffer);
const dv = () => new DataView(mem.buffer);

// A Burxt String is length-prefixed: eight little-endian bytes, then the bytes, then a NUL, and the
// pointer that crosses the boundary points at the bytes. Reading one as a C string gives a plausible
// WRONG answer rather than a crash, which is how it cost an hour.
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

const malloc = (n) => {
  n = Number(n);
  if (!brk) brk = mem.buffer.byteLength;
  const need = brk + n;
  if (need > mem.buffer.byteLength) mem.grow(Math.ceil((need - mem.buffer.byteLength) / 65536) + 1);
  const p = brk;
  brk = need;
  return p;
};

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

let calls = null;
let loading = null;

async function load(url) {
  const bytes = await (await fetch(url)).arrayBuffer();
  const env = {
    malloc,
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
    __multi3: (ret, alo, ahi, blo, bhi) => {
      const a = BigInt.asIntN(128, (BigInt.asUintN(64, ahi) << 64n) | BigInt.asUintN(64, alo));
      const b = BigInt.asIntN(128, (BigInt.asUintN(64, bhi) << 64n) | BigInt.asUintN(64, blo));
      const r = BigInt.asUintN(128, a * b);
      dv().setBigUint64(ret, r & 0xffffffffffffffffn, true);
      dv().setBigUint64(ret + 8, r >> 64n, true);
      return 0;
    },
  };
  const { instance } = await WebAssembly.instantiate(bytes, { env });
  mem = instance.exports.memory;
  const alloc = instance.exports['burxt.alloc'];
  if (!alloc) throw new Error("link with --export='burxt.alloc'");

  // Strings are allocated by the MODULE, never by the host — a host bump pointer in the same linear
  // memory collides with the arena the module is growing.
  const put = (text) => {
    const b = new TextEncoder().encode(text);
    const p = Number(alloc(BigInt(8 + b.length + 1)));
    dv().setBigUint64(p, BigInt(b.length), true);
    u8().set(b, p + 8);
    u8()[p + 8 + b.length] = 0;
    return p + 8;
  };

  calls = {
    play: (source) => { received = ''; instance.exports['bx.play'](put(source)); return received; },
    render: (source, scope) => {
      received = '';
      instance.exports['bx.render'](put(source), put(scope));
      return received;
    },
  };
}

/** Load once, on first use. */
export async function engine(base = './') {
  if (!calls) {
    if (!loading) loading = load(base + 'comet-engine.wasm');
    await loading;
  }
  return calls;
}
