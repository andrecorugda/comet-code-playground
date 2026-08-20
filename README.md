# comet-code-playground

**One embeddable playground for Burxt, BMX and star-burxt.** Client-only: nothing leaves the page, so
one person's edits cannot reach anybody else.

## What it is, and what it is not yet

| | today |
|---|---|
| **star** | edit a `.sbmx`, see `BMX-Ennn` and `STAR-Ennn` refusals and the Burxt it generates |
| **BMX** | rendered live by the format's own level-1 implementation, refusals included |
| **Burxt** | not yet — see *Running things*, below |

## How it is built, and why that is the interesting part

**The playground's own UI is a star component.** `Playground.sbmx` is compiled to wasm and driven by
star's own `examples/app.js`, copied here byte-identical and never edited. That is deliberate: this
repository installs star as a dependency the way anybody would, so it is a consumer rather than a
test — and twenty minutes of being one found two bugs in `star-build` that no check inside star could
see, because every check in star runs from star's own root.

**It needed no new star feature.** `StarCmd.Send(tag, url, body)` already carries a body and delivers
the reply as `value`, so *"generate this document"* is a POST the host fulfils locally by calling
star's generator — compiled from star's published surface to wasm. `Store` and `Load` give the
client-only persistence for free. The component asks for a URL; it does not know the answer never
leaves the page.

**BMX is not reimplemented.** `reference/bmx.js` exports `render(source, bindings)`, and `BOUNDARY.md`
puts rendering at level 1 — so a conformant implementation already does it. The bindings pane *is* the
`bindings` argument. An unbound slot shows **`BMX-R002`** with its offset rather than a blank, and a
block shows **`BMX-R003`**, because both are correct behaviour: a page rendering a hole where a value
was missing is the precise thing BMX exists to refuse.

**A star page carries no executable markup.** Handlers reach the DOM as `data-star-h="0"` indices,
never inline JavaScript. A playground for most frameworks is an arbitrary-code-execution surface;
this one is not, and that comes from star's design rather than from sandboxing.

## Running things

Checking works client-side. *Running* a Burxt program in a browser does not, and the reason is
specific: the self-hosted compiler emits LLVM IR **text**, so the pipeline is `emit.bx` → `llc` →
object → link. Two native tools stand in the way and the linker is the smaller one, so porting a
linker buys nothing. The options are a wasm backend in `emit.bx`, an interpreter — which would put a
VM inside the product that teaches there is no VM — or precompiling curated examples at deploy.

## Building it

```sh
burxt fetch                                    # star and bmx, at the tags in burxt.lock
star-build Playground.sbmx playground build    # the UI component -> wasm
node tests/browser.mjs                         # and it mounts in a real browser
node tests/browser.mjs --prove-it              # which must FAIL, and exits 0 when it does
```

star's three commands come from its own checkout — see star's `docs/install.md` — and must be on
`PATH`.
