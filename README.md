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

```sh
burxt fetch                                       # star and BMX, at the tags in burxt.lock
burxt build serve.bx -o comet-serve               # the local server

# the interface. star-build comes from the star repository and is not on PATH by default
PATH="$HOME/star-burxt:$PATH" star-build Playground.sbmx playground build

# the engine, in two steps — the second is the one that writes what the page actually fetches
burxt build entry.bx --target wasm32-unknown-unknown -o build/entry.o
LLD=$(ls "$HOME"/.rustup/toolchains/*/lib/rustlib/*/bin/rust-lld | head -1)
"$LLD" -flavor wasm --no-entry --allow-undefined --gc-sections \
  --export=burxt.alloc --export=memory --export=bx.play --export=bx.render \
  -z stack-size=1048576 --initial-memory=4194304 --max-memory=268435456 \
  build/entry.o -o web/comet-engine.wasm

./comet-serve web 8000                            # then open http://localhost:8000
node tests/browser.mjs                            # checks it in a real browser
```

**Three things in that block used to be wrong, and each one only a reader would have found.**

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
