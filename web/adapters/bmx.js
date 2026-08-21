// not-burxt: platform — fourteen lines registering BMX with the browser-side registry. Every decision
//            is BMX's own Burxt implementation in `comet-engine.wasm`; this hands it a string and reads
//            one back. It was 1,171 lines of vendored `bmx.js` until that module existed
// BMX. Every decision is BMX's own Burxt implementation, in `comet-engine.wasm`.
import comet from '../comet.js';
import { engine } from '../engine.js';

comet.register({
  id: 'bmx',
  label: 'BMX',
  async run({ source, bindings }) {
    if (!source.trim()) return { output: '' };
    const out = (await engine()).render(source, bindings || '');
    // A refusal carries its code. Anything else is the page.
    return /^BMX-[A-Z]?\d+/.test(out) ? { error: out } : { html: out };
  },
});
