// not-burxt: platform — the registry an embedder calls: `comet.register({id, label, run})` and
//            `comet.mount(...)`. It is the public API of a browser library, so it is reached by a
//            `<script type="module">` on somebody else's page. A Burxt module cannot be imported by one
// comet — an embeddable, client-only code playground with a language registry.
//
// **This file knows nothing about any language.** It owns an editor, a result pane, a scope pane, and
// a table of adapters. Everything that understands a syntax is registered from outside through the
// contract below, including the three that ship with it — they are the first consumers of the
// extension point rather than special cases inside it, which is the only way to know the point works.
//
// ---- the adapter contract ------------------------------------------------------------------------
//
//     comet.register({
//       id:    'mylang',                  // the mode name; appears in the tab strip
//       label: 'My Language',             // optional, defaults to id
//       async run({ source, bindings }) { // called on every edit, debounced by the caller
//         return { output: '…' }          // text to show — diagnostics, generated code, anything
//         // or   { html:   '…' }         // a rendered preview, inserted as markup (see below)
//         // or   { error:  '…' }         // a refusal; shown as-is, so include the position
//       },
//     })
//
// `run` may be async and may reject; a rejection is shown as an error rather than swallowed, because a
// playground that goes quiet is worse than one that says it broke.
//
// **`html` is inserted as markup and an adapter that returns it is trusted.** That is stated rather
// than defended: an adapter is code the embedder chose to load, so it already runs with the page's
// privileges and escaping its output would protect nothing. What must not happen is a *document* in the
// editor becoming markup, so `output` is always inserted as text and only `html` is not. An adapter
// whose language renders — as BMX's does — is responsible for escaping the values it substitutes, which
// is exactly the rule its own specification already puts on it.
//
// **Nothing leaves the page.** No adapter is given a network, no state is shared, and persistence is
// `localStorage` under a per-mode key. One person's edits cannot reach anybody else because there is
// nowhere for them to go.

// The marker that tells a rendered preview from text, with its length taken from the constant rather
// than counted by hand — the first version was `'html'` and `slice(6)`, which eats two characters off
// every preview and reads as a styling bug.
const PREVIEW = 'comet:html:';

const adapters = new Map();

/** Register a language. Later registrations of the same `id` replace earlier ones. */
export function register(adapter) {
  if (!adapter || typeof adapter.id !== 'string' || !adapter.id) {
    throw new Error('comet.register needs an { id }');
  }
  // **An adapter answers in the browser or names a service, and it must do one of them.** A language
  // whose toolchain cannot be compiled to wasm — most of them — supplies `service: '<env>'` and the
  // control plane runs it in a sandbox. A language that can, supplies `run` and needs no service at all,
  // which is what keeps a GitHub Pages embed working with no backend behind it.
  if (typeof adapter.run !== 'function' && typeof adapter.service !== 'string') {
    throw new Error(`comet.register('${adapter.id}') needs either a run({ source, bindings }) function `
      + `or service: '<environment>' naming an environment the control plane has provisioned`);
  }
  adapters.set(adapter.id, { label: adapter.id, ...adapter });
  return adapter.id;
}

// Where the control plane is, if there is one. Set by `mount({ service })`.
let serviceBase = '';

/** Run one source through the control plane: start it, then poll until it is done. */
async function viaService(env, source) {
  if (!serviceBase) {
    return { error: `\`${env}\` runs in a sandbox, and this playground was mounted without a service.`
      + ` Pass mount({ service: 'https://…' }) to reach one.` };
  }
  const started = await fetch(`${serviceBase}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ env, source }),
  });
  const opening = await started.json().catch(() => ({}));
  if (!started.ok || !opening.run) {
    // The service says why in `error`, and passing it through is the difference between a blank pane
    // and a reader who knows an environment needs provisioning.
    return { error: opening.error || `the service refused this run (HTTP ${started.status})` };
  }

  // **Polled, because the service cannot stream.** Burxt's `http.bx` has no chunked transfer encoding
  // in either direction, so the console asks again rather than being pushed to. The interval is short
  // enough to feel live and long enough not to hammer a box serving many embeds.
  // **Two bounds, because one of them is for a person and the other is for a runaway.** The wall clock
  // is what a visitor experiences — give up after two minutes — and the attempt count is a backstop so a
  // service answering instantly forever cannot spin here.
  //
  // **Neither survives Chrome's `--virtual-time-budget`, and that is a fact about the instrument.**
  // Virtual time fast-forwards `setTimeout` and `Date.now()` while a real network wait stays real, so
  // 600 polls elapse in under a second and the console reports a failure about a run that is fine. I
  // spent several captures learning that: virtual time cannot observe an asynchronous backend, because
  // it removes exactly the waiting that is being observed. `tests/browser.bx` drives this path with real
  // time and the page's own report, which is the only observer that works.
  const attempts = 800;
  const deadline = Date.now() + 120000;
  for (let tries = 0; tries < attempts && Date.now() < deadline; tries += 1) {
    const reply = await fetch(`${serviceBase}/run/${opening.run}`);
    const state = await reply.json().catch(() => ({}));
    if (state.status === 'done') {
      const out = (state.stdout || '') + (state.stderr || '');
      // A non-zero exit is not a broken playground, it is the program's answer — so it is shown as
      // output with its code, not as an error the visitor caused.
      if (state.timed_out) {
        return { error: `${out}\n[killed at the deadline after ${state.ms}ms]` };
      }
      if (state.exit !== 0) {
        return { output: `${out}\n[exit ${state.exit} in ${state.ms}ms]` };
      }
      return { output: out };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { error: 'the run never finished, and the service stopped answering for it' };
}

export function registered() {
  return [...adapters.values()].map(({ id, label }) => ({ id, label }));
}

/** What the host does when the component asks `/run/<mode>`. Exported for tests. */
export async function run(mode, source, bindings) {
  const adapter = adapters.get(mode);
  if (!adapter) {
    // **Named, not silent.** An unregistered mode is the likeliest thing an embedder gets wrong, and
    // a blank pane gives them nothing to search for.
    const have = [...adapters.keys()].join(', ') || 'none';
    return { error: `no adapter registered for \`${mode}\`. Registered: ${have}.` };
  }
  if (typeof adapter.run !== 'function') {
    return viaService(adapter.service, source);
  }
  try {
    const answer = await adapter.run({ source, bindings });
    return answer && typeof answer === 'object' ? answer : { output: String(answer ?? '') };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

// ---- the star component that draws it ------------------------------------------------------------
//
// The UI is a star-burxt component compiled to wasm. It asks for URLs and does not know that nothing
// answers them over a network — which is why the registry needed no new framework feature: `StarCmd.Send`
// already carries a body and delivers the reply.
//
// star's `app.js` is copied here byte-identical and never edited, so `fetch` is overridden rather than
// the driver patched. A modified copy drifts from the framework it came from.
let scope = '';

// An answer, as the component reads it: what kind of thing it is, the thing, and a line for the status
// badge. **One string could not carry four answers**, which is why the envelope exists.
function envelope(answer, started) {
  const ms = Date.now() - started;
  if (answer.html !== undefined) {
    return { kind: 'html', body: answer.html, status: `rendered · ${ms}ms` };
  }
  if (answer.error !== undefined) {
    return { kind: 'text', body: answer.error, status: `refused · ${ms}ms` };
  }
  return { kind: 'text', body: answer.output ?? '', status: `ok · ${ms}ms` };
}

// **An edit and a Run are different requests, and the difference is money.** A language that answers in
// this page is instant, so an edit should feel live. A language that starts a microVM costs a container
// per keystroke, so an edit only schedules one and the newest edit wins. Pressing Run never waits.
let pending = null;
let inflight = 0;

function intercept(base) {
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const path = String(url);
    const body = (opts && opts.body) || '';

    if (path.indexOf('/bind/') >= 0) { scope = body; return new Response(''); }

    // Stop is honest about what it can do: a run already inside a sandbox has its own deadline, and
    // nothing here can reach in and end it early. What this cancels is a scheduled one.
    if (path.indexOf('/stop/') >= 0) {
      if (pending) { clearTimeout(pending); pending = null; }
      return new Response(JSON.stringify({ kind: 'text', body: '', status: 'stopped' }));
    }

    const edit = path.indexOf('/edit/');
    const now = path.indexOf('/run/');
    if (edit < 0 && now < 0) return real(url, opts);

    // **Two routes of different length cannot share one offset.** `/edit/` is six characters and `/run/`
    // is five; slicing both at +6 ate a character and asked for a language called `urxt`. The registry's
    // own error is what made that a one-look diagnosis — *no adapter registered for `urxt`. Registered:
    // bmx, sbmx, burxt* — which is the argument for naming what you did not find instead of blanking.
    const mode = edit >= 0 ? path.slice(edit + 6) : path.slice(now + 5);
    const adapter = adapters.get(mode);
    const sandboxed = !!(adapter && typeof adapter.run !== 'function');

    if (edit >= 0 && sandboxed) {
      // Scheduled, not run. The component gets an immediate answer so the page never looks stuck, and
      // the debounced run lands as a later reply.
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => { pending = null; window.fetch(`/run/${mode}`, { body }); }, 900);
      return new Response(JSON.stringify({ kind: 'text', body: '', status: 'waiting…' }));
    }

    const started = Date.now();
    inflight += 1;
    const answer = await run(mode, body, scope);
    inflight -= 1;
    return new Response(JSON.stringify(envelope(answer, started)));
  };
}

export async function mount({ root, base = './', mode, source = '', bindings = '', service = '' } = {}) {
  if (!root) throw new Error('comet.mount needs a root element');
  serviceBase = String(service || '').replace(/\/$/, '');
  intercept(base);
  scope = bindings;
  const first = mode || (registered()[0] && registered()[0].id) || 'none';
  const initial = JSON.stringify({ source, result: '', mode: first, bindings });
  const { mount: mountStar } = await import(base + 'app.js');
  const app = await mountStar({ wasm: base + 'playground.wasm', component: 'playground', root, initial });

  // A preview is markup by the adapter's contract, so it is promoted out of the text pane once painted.
  // Done here rather than in the component because a star page carries no executable markup by design,
  // and this is the host's decision to make rather than the document's.
  //
  // **Idempotent, because promoting is itself a mutation.** The first version set the marker attribute
  // and was then re-entered by its own observer callback: the pane no longer began with the prefix, so
  // it took the `else` branch and deleted the attribute it had just written. The render was correct and
  // invisible to anything looking for the flag — a check failing on a feature that worked. Remembering
  // what was promoted is what tells our own writes from the framework's.
  let promoted = null;
  const promote = () => {
    const out = root.querySelector('.comet-preview');
    if (!out) return;
    if (promoted !== null && out.innerHTML === promoted) return;
    // **Whatever reaches the preview pane IS markup**, because the component only fills it when an
    // adapter answered with `kind: 'html'`. The prefix this used to look for is gone: the envelope says
    // what kind of answer it is, so the pane does not have to be sniffed.
    const text = (out.textContent || '').trim();
    if (text.length > 0) {
      promoted = text;
      out.innerHTML = promoted;
      out.dataset.cometRendered = 'yes';
    } else {
      promoted = null;
      delete out.dataset.cometRendered;
    }
  };
  const observer = new MutationObserver(promote);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  promote();

  // **Seed the editor and run once, or `mount({ source })` shows text and computes nothing.**
  // A textarea takes its value from child markup when the parser builds it, not when a diff writes it
  // — so the initial document appeared in the editor while the component's state held the empty string
  // it started with, and the result pane was correctly blank for an input nobody had given. Setting the
  // value and dispatching a real `input` event puts both in step through the same path a keystroke uses.
  const box = root.querySelector('.comet-in');
  if (box && source) {
    box.value = source;
    box.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  // **A showcase runs on arrival, and for a sandboxed language that needs a deliberate Run.** Seeding
  // the editor dispatches an `input`, which for a sandboxed language only SCHEDULES a run — correct
  // while somebody is typing, wrong for a page that exists to show a result. Left alone, an embedded
  // showcase opened on `waiting…` and sat there until the debounce elapsed.
  //
  // It presses the button the interface already has rather than reaching past it, so mounting and
  // clicking Run go down the same path and there is one behaviour to reason about.
  const opening = adapters.get(first);
  if (opening && typeof opening.run !== 'function') {
    const go = root.querySelector('.comet-run');
    if (go) go.click();
  }
  const scopeBox = root.querySelector('.comet-scope');
  if (scopeBox && bindings) scopeBox.value = bindings;

  return { ...app, promote, stop: () => observer.disconnect() };
}

export default { register, registered, run, mount };
