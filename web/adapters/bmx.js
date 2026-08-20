// BMX — rendered by the format's own implementation.
//
// Not reimplemented: `reference/bmx.js` exports `render(source, bindings)`, and rendering is level 1 in
// BMX's `BOUNDARY.md`, so a conformant implementation already does it. The scope pane is the `bindings`
// argument, verbatim.
//
// **An unbound slot is an error, not a blank.** `render` refuses the whole page with `BMX-R002` and an
// offset, and a block refuses with `BMX-R003` because deciding what `card` means is not the format's
// job. Both are shown as given: a page that renders a hole where a value was missing is the precise
// thing this format exists to refuse, so the refusal is the feature.
import comet from '../comet.js';
import { render, BmxError } from '../bmx.js';

comet.register({
  id: 'bmx',
  label: 'BMX',
  async run({ source, bindings }) {
    if (!source.trim()) return { output: '' };

    let scope = {};
    if (bindings && bindings.trim()) {
      try {
        scope = JSON.parse(bindings);
      } catch (e) {
        // The scope pane is the one input the reader is most likely to break, and JSON's own message
        // names the position, so it is passed through rather than summarised.
        return { error: 'The values pane is not valid JSON.\n\n' + e.message };
      }
    }

    try {
      return { html: render(source, scope) };
    } catch (e) {
      return { error: e instanceof BmxError ? e.message : String(e) };
    }
  },
});
