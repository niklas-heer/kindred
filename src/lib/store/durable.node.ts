// What `#store/durable` is outside workerd: nothing. src/server.ts exports the FamilyStore Durable Object class for the
// Worker (./durable.ts); a Node build has no Durable Objects, so it gets this placeholder instead and never imports
// cloudflare:workers (package.json "imports").
export class FamilyStore {}
