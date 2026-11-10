// Preloaded into the screenshot script's server (node --import): moves the server's clock so that "now" is the instant in
// KINDRED_SHOT_NOW when the process starts, and lets it run on from there. The pictures are then the same on every run:
// the week's question, the quiz, the campaign's day and every "x days ago" no longer depend on the day they were taken.
const target = Date.parse(process.env.KINDRED_SHOT_NOW ?? '');
if (!Number.isNaN(target)) {
  const offset = target - Date.now();
  const Real = Date;
  globalThis.Date = new Proxy(Real, {
    construct: (t, args, nt) => Reflect.construct(t, args.length ? args : [Real.now() + offset], nt),
    get: (t, p, r) => (p === 'now' ? () => Real.now() + offset : Reflect.get(t, p, r)),
    apply: () => new Date().toString(),
  });
}
