// Burxt, and an honest account of why it checks nothing yet.
//
// Registered rather than omitted, because a missing tab is indistinguishable from a broken one and an
// embedder deserves to know the mode exists and what it is waiting on.
import comet from '../comet.js';

comet.register({
  id: 'burxt',
  label: 'Burxt',
  async run() {
    return {
      error: 'Burxt is not checked in the browser yet.\n\n'
        + 'The self-hosted compiler builds for wasm32 and returns real diagnostics — that part is\n'
        + 'measured. What is missing is a check-only entry point, because the two existing entries\n'
        + 'reach for a filesystem to capture diagnostics that are PRINTED rather than returned.\n\n'
        + 'Running a program is further: the compiler emits LLVM IR text, so `llc` stands between\n'
        + 'that and a module. Porting a linker would not help — `llc` is the larger tool.',
    };
  },
});
