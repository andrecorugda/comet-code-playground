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
