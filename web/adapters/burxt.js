// not-burxt: platform — registers Burxt with the browser-side registry. It declares a SERVICE rather
//            than a run function: the compiler is not in the browser, so a real answer comes from a
//            sandbox on the control plane. Three lines of configuration, and no decision in any of them
// Burxt, run where a compiler can actually live.
//
// **This used to be an apology.** The adapter registered a `run` that explained, at length, why nothing
// happened: the self-hosted compiler builds for wasm32 but has no check-only entry point, its
// diagnostics are printed rather than returned, and running a program needs `llc` between the emitted
// LLVM IR and a module. All true, and all of it the wrong problem to solve — the answer was never to get
// a compiler into the browser. It was to put the browser in front of a sandbox that has one.
//
// So this names an environment and stops. `environments/burxt.json` says what to install; the control
// plane provisions it once and runs a visitor's source in a microVM with no network and a deadline.
import comet from '../comet.js';

comet.register({
  id: 'burxt',
  label: 'Burxt',
  service: 'burxt',
});
