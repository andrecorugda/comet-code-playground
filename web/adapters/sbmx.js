// not-burxt: platform — registers star with the browser-side registry. It was 165 lines and is a
//            handful now, because `star_generate` in the wasm answers what the JavaScript used to
// star-burxt. Every decision is star's own generator, in `comet-engine.wasm`.
import comet from '../comet.js';
import { engine } from '../engine.js';

comet.register({
  id: 'sbmx',
  label: 'star-burxt',
  async run({ source }) {
    if (!source.trim()) return { output: '' };
    const out = (await engine()).play(source);
    return /^(BMX|STAR)-E\d+/.test(out) ? { error: out } : { output: out };
  },
});
