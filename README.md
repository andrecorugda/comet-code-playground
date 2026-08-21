# comet

**An embeddable code playground.** Drop it into a docs page and readers can edit code and see what it
does, without leaving the page.

Everything runs in the browser. Nothing is uploaded, nothing is shared, and there is no server to run —
so one reader's edits can never reach another's, and you can put it on a static site.

## Add it to a page

```html
<div id="playground"></div>

<script type="module">
  import comet from 'https://your-site/comet/comet.js';
  import 'https://your-site/comet/adapters/bmx.js';

  comet.mount({
    root: document.querySelector('#playground'),
    source: '# Receipt {{ reference }}\n\nThank you, {{ name }}.\n',
    bindings: '{ "reference": "A-1042", "name": "Ada" }',
  });
</script>
```

That is the whole integration. Copy the `web/` folder next to your pages and point the import at it.

## What a reader gets

- **An editor**, with the document you seeded it with.
- **A result pane** — a rendered preview, generated code, or the exact error, depending on the language.
- **A values pane**, for languages that substitute values into a document.
- **Tabs**, one per language you imported.
- **Their work kept** between visits, in their own browser.

Errors are shown as the language reports them, with the position included. A playground that renders a
blank where something was wrong teaches the wrong lesson, so nothing is swallowed.

## Languages

| tab | what it does |
|---|---|
| **BMX** | renders the document live, with the values pane supplying the slots |
| **star-burxt** | checks a `.sbmx` component and shows the code it generates |
| **Burxt** | not checked in the browser yet; the tab says what it is waiting on |

Import only the ones you want — each is a separate file, and an unimported language has no tab and
costs nothing to download.

## Add your own language

An adapter is one function. It receives what the reader typed and returns what to show.

```js
import comet from './comet.js';

comet.register({
  id: 'json',
  label: 'JSON',
  async run({ source, bindings }) {
    if (!source.trim()) return { output: '' };
    try {
      return { output: JSON.stringify(JSON.parse(source), null, 2) };
    } catch (e) {
      return { error: e.message };
    }
  },
});
```

Return one of three things:

| | shown as |
|---|---|
| `{ output }` | text — generated code, formatted output, a report |
| `{ html }` | a rendered preview |
| `{ error }` | a refusal, exactly as you wrote it |

`run` may be `async`, so a language whose checker is a WebAssembly module can load it on first use.
If `run` throws, the reader sees the message rather than a blank pane.

`{ html }` is inserted as markup, so an adapter returning it is responsible for escaping the values it
substitutes. Anything a reader types reaches `output` and `error` as text and is never treated as
markup.

## Options

| | |
|---|---|
| `root` | the element to mount into — required |
| `source` | the document the editor starts with |
| `bindings` | the values pane's starting contents |
| `mode` | which tab opens first; defaults to the first language imported |
| `base` | where the playground's files live, if not `./` |

## Running it here

**One command, once everything is built:**

```sh
burxt run dev.bx
```

Then open **http://localhost:3000**. That is the whole thing: it builds what is missing, provisions any
environment that is not ready, starts both servers, and waits — press Enter to stop.

The control plane sits on 3001 and the page finds it there by itself on localhost. `burxt run dev.bx --
<page> <control>` moves either. The first run provisions three container images and takes a few minutes;
every run after is instant, because an unchanged environment is never rebuilt.

## The long way


```sh
burxt fetch                                       # star and BMX, at the tags in burxt.lock
burxt build serve.bx -o comet-serve               # the local server

# the interface. star-build comes from the star repository and is not on PATH by default
PATH="$HOME/star-burxt:$PATH" star-build Playground.sbmx playground build
cp build/playground.wasm web/playground.wasm        # ...and the page fetches it from web/

# the engine, in two steps — the second is the one that writes what the page actually fetches
burxt build entry.bx --target wasm32-unknown-unknown -o build/entry.o
LLD=$(ls "$HOME"/.rustup/toolchains/*/lib/rustlib/*/bin/rust-lld | head -1)
"$LLD" -flavor wasm --no-entry --allow-undefined --gc-sections \
  --export=burxt.alloc --export=memory --export=bx.play --export=bx.render \
  -z stack-size=1048576 --initial-memory=4194304 --max-memory=268435456 \
  build/entry.o -o web/comet-engine.wasm

burxt build tests/browser.bx -o comet-browser     # the browser harness
burxt build service/comet-service.bx -o comet-service   # the control plane
burxt build tests/service.bx -o comet-service-test      # its checks

./comet-service --serve 8080 &                    # the control plane
curl -X POST localhost:8080/provision -d '{"env":"burxt"}'   # build an environment, once
./comet-serve web 8000                            # then open http://localhost:8000

timeout 900 ./comet-service-test                  # the environment and run core, 17 checks
timeout 300 ./comet-browser                       # the page, in a real browser, 5 checks
```

## Running a language

A **playground** is an environment plus showcases. The environment is a declaration under
`environments/`:

```json
{ "id": "burxt", "label": "Burxt", "image": "ubuntu:24.04",
  "install":   ["…install the toolchain…"],
  "bootstrap": ["cd /work && burxt fetch"],
  "file": "main.bx",
  "run":  ["burxt", "run", "/work/main.bx"],
  "timeout_ms": 10000, "vcpus": 1 }
```

`install` and `bootstrap` run **once, at provision, with the network on**, and the result is baked into
an image. A run resumes from that image with **no network, a deadline it cannot extend, and a filesystem
nothing else will ever see** — which is why anything a language needs to download belongs in
`bootstrap` rather than in the program.

A **showcase** is a mode and a source, so it is a URL:

```
…/index.html?service=https://your-control-plane&mode=burxt&source=print(%22hi%22)%3B
```

Embed that and a visitor edits the code and sees the result. Their edits stay in their own browser; the
showcase you saved is unchanged.

**A language that answers in the browser needs no control plane at all.** An adapter supplies either a
`run` function — BMX and star do, through wasm — or `service: '<environment>'`, and only the second kind
needs a service. That is what keeps a GitHub Pages embed working with nothing behind it.
```

**Four things in that block used to be wrong, and each one only a reader would have found.**

Two of them were the same defect one file apart: **the block never wrote either artefact the page
actually fetches.** `web/engine.js` fetches `comet-engine.wasm` and `web/comet.js` fetches
`playground.wasm`; the block stopped at `build/entry.o` for the first and wrote `build/playground.wasm`
for the second. Both files are committed on purpose — the site serves them, and a page that needs a build
step to be viewable is a page nobody views — which is exactly what hides this: follow the steps, and the
committed artefacts stay in place while the page mounts and works. **Nothing you just compiled is being
exercised, and it looks identical to everything working.** Proved by deleting both and following the
block: `comet-engine.wasm` came back, `playground.wasm` did not.

It stopped at `build/entry.o` and never linked it. `web/engine.js` fetches `comet-engine.wasm`, so
following the documented steps left the committed module in place and the page looked fine while testing
nothing that was just built. It named `star-build` without saying where it comes from. And it served the
directory with `python3 -m http.server` — which worked, and put another language in the one set of
instructions a reader actually follows, in a product whose argument is that you do not need one.

`serve.bx` replaces it in 90 lines, and the content type is the reason a server is needed at all:
`WebAssembly.instantiateStreaming` refuses anything that is not `application/wasm`, so a wrong header is
a page that loads and a module that never instantiates. It also refuses `..` and says which file is
missing rather than 404-ing silently. Verified through it: correct types on every asset, the engine
fetched byte-for-byte, a raw `../` traversal answered 403, and the playground mounting in headless
Chrome.

**The values pane is JSON.** Strings, numbers, `true`/`false` and `null` become slot values; an object
or a list is refused by name, because a slot holds one value and a binding that went missing quietly is
what BMX exists to refuse.

## Licence

MIT.

---

Powered by [star-burxt](https://star.burxt-lang.org).
