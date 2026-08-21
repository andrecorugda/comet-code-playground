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
  if (typeof adapter.run !== 'function') {
    throw new Error(`comet.register('${adapter.id}') needs a run({ source, bindings }) function`);
  }
  adapters.set(adapter.id, { label: adapter.id, ...adapter });
  return adapter.id;
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

function intercept(base) {
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const path = String(url);
    const body = (opts && opts.body) || '';
    const bind = path.indexOf('/bind/');
    if (bind >= 0) { scope = body; return new Response(''); }
    const at = path.indexOf('/run/');
    if (at >= 0) {
      const mode = path.slice(at + 5);
      const answer = await run(mode, body, scope);
      // The component holds one string. `html` is marked so the mount can tell a preview from text.
      if (answer.html !== undefined) return new Response(PREVIEW + answer.html);
      return new Response(answer.error !== undefined ? answer.error : (answer.output ?? ''));
    }
    return real(url, opts);
  };
}

export async function mount({ root, base = './', mode, source = '', bindings = '' } = {}) {
  if (!root) throw new Error('comet.mount needs a root element');
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
    const out = root.querySelector('.comet-out');
    if (!out) return;
    if (promoted !== null && out.innerHTML === promoted) return;
    const text = out.textContent || '';
    if (text.startsWith(PREVIEW)) {
      promoted = text.slice(PREVIEW.length);
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
  const scopeBox = root.querySelector('.comet-scope');
  if (scopeBox && bindings) scopeBox.value = bindings;

  return { ...app, promote, stop: () => observer.disconnect() };
}

export default { register, registered, run, mount };
