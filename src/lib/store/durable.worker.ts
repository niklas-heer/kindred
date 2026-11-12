// The Worker that runs ./durable.cases.ts inside workerd (./durable.test.ts bundles it, with `#store/driver` resolving to
// the Cloudflare driver as in production). POST /<case name> with the expected tree migration files as a JSON list.
import { durableCases } from './durable.cases.ts';

export { FamilyStore } from './durable.ts';

export default {
  async fetch(request: Request): Promise<Response> {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    try {
      const run = durableCases[name];
      if (!run) return new Response(`no case named ${name}`, { status: 404 });
      await run((await request.json()) as string[]);
      return new Response('ok');
    } catch (e) {
      const cause = e instanceof Error && e.cause ? `\ncause: ${String(e.cause)}` : '';
      return new Response(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}${cause}`, { status: 500 });
    }
  },
};
