// The playground, in a real browser.
//
//     node tests/browser.mjs
//     node tests/browser.mjs --prove-it     # the negative control
//
// **A claim about a browser is checked in a browser.** Everything under this repository could be
// asserted in node — the wasm instantiates, the generator answers, `render` escapes — and all of it
// would still be worthless if the page could not mount. BMX shipped exactly that: `reference/bmx.js`
// passed its whole conformance suite in node while a bare `process.argv[1]` made the module
// unimportable in a browser, so it threw `ReferenceError: process is not defined` before one export
// was reachable. Their portability test was *named* for the question and asked a narrower one.
//
// Chrome is driven as a BINARY with `--headless --dump-dom`, and the pages are served by `node:http`.
// No puppeteer, no dependency — copied from star's `tools/gallery.mjs`, which took that shape because
// its sibling needed puppeteer as a module and could not run on this machine.
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, extname } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const WEB = join(HERE, '..', 'web');
const prove = process.argv.includes('--prove-it');
let failures = 0;

const check = (ok, okLine, failLine) => {
  if (ok) console.log(`  ok    ${okLine}`);
  else { failures += 1; console.log(`  FAIL  ${failLine}`); }
};

const chrome = () => {
  const roots = [join(process.env.HOME, '.cache', 'puppeteer', 'chrome')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).sort().reverse()) {
      for (const tail of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = join(root, dir, tail);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
                '.wasm': 'application/wasm', '.css': 'text/css' };

// The harness serves the page AND receives its report, so the run ends when the page says so.
// **Chrome is killed and the sockets are dropped, or nothing here ever exits.** `server.close()` waits
// for open connections to end and a headless browser holds keep-alive sockets open indefinitely, so the
// first version printed its results and then hung until an outer `timeout` killed it — a passing check
// that never returns is indistinguishable from a broken one.
const serveAndWait = () => new Promise((resolve, reject) => {
  let server;
  let child = null;
  const done = () => {
    if (child) { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } }
    if (server) { server.closeAllConnections(); server.close(); }
  };
  const timer = setTimeout(() => {
    done();
    reject(new Error('the page never reported — it did not reach either branch of its own try/catch'));
  }, 45000);
  server = createServer((req, res) => {
    if (req.url === '/report') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(204); res.end();
        clearTimeout(timer); done();
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('unreadable report: ' + body.slice(0, 200))); }
      });
      return;
    }
    const name = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = join(WEB, name);
    if (!existsSync(file)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    child = execFile(bin, ['--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
                           `http://127.0.0.1:${port}/index.html`], () => {});
  });
});

const bin = chrome();
if (!bin) {
  console.log('  no Chrome found — a claim about a browser cannot be checked without one');
  process.exit(1);
}

let outcome;
try {
  outcome = await serveAndWait();
} catch (e) {
  outcome = { mounted: false, error: e.message };
}
let dom = outcome.html || '';
if (outcome.mounted) dom += ' data-comet-ready="yes"';

if (process.argv.includes('--show')) console.log('--- reported html ---\n' + dom.slice(0, 900) + '\n---\n');
if (prove) {
  dom = dom.replace('data-comet-ready="yes"', 'data-comet-ready="no"').replace(/A-1042/g, '');
  outcome.modes = ['bmx'];
}

// ---- the accepting case, first and fatally --------------------------------------------------------
//
// A page that fails to mount fails every assertion below for the same reason, and a suite of those
// reads as many defects rather than one. So this is the gate: nothing under it means anything.
check(dom.includes('data-comet-ready="yes"'),
      'the playground mounts in Chrome',
      // **The page's own error, not a search of the DOM for one.** The first version looked for
      // `MOUNT FAILED:` in the markup and printed "(no reason in the DOM)" when the page had reported
      // a full stack trace — a harness withholding the answer it was handed.
      `the page did not mount — everything below is the same defect:\n        ${
        (outcome.error || '(the page reported no error)').split('\n').slice(0, 4).join('\n        ')}`);

// BMX rendered, by the format's own implementation, with the values pane as its bindings.
check(/A-1042/.test(dom) && /data-comet-rendered/.test(dom),
      'BMX rendered a page from the document and the values beside it',
      'the result pane holds no rendered page — the default document did not render');

// Every adapter that registered is a mode the reader can reach.
check(Array.isArray(outcome.modes) && ['bmx', 'sbmx', 'burxt'].every((m) => outcome.modes.includes(m)),
      `three languages registered through the public API (${(outcome.modes || []).join(', ')})`,
      `the registry holds ${(outcome.modes || []).join(', ') || 'nothing'} — an adapter failed to register,`
      + ' and a missing tab is indistinguishable from a broken one');

console.log();
if (prove) {
  if (failures) {
    console.log('the control failed as it must — a page that does not mount, and an output pane with '
                + 'no component in it, are both caught');
    process.exit(0);
  }
  console.log('THE CONTROL DID NOT FAIL, so this check cannot see the defects it exists for');
  process.exit(1);
}
if (failures) {
  console.log(`${failures} thing${failures === 1 ? '' : 's'} wrong in the browser`);
  process.exit(1);
}
console.log('the playground mounts and star answers, in a real browser');
