// The Worker that runs the database contract inside workerd (./contract.test.ts bundles it, with `#store/driver`
// resolving to the Cloudflare driver as in production). POST /<case name> runs one case; /schemas reports the schema.
import { contractCases, schemas } from './contract.cases.ts';

export default {
  async fetch(request: Request): Promise<Response> {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    try {
      if (name === 'schemas') return Response.json(await schemas());
      const run = contractCases[name];
      if (!run) return new Response(`no case named ${name}`, { status: 404 });
      await run();
      return new Response('ok');
    } catch (e) {
      const cause = e instanceof Error && e.cause ? `\ncause: ${String(e.cause)}` : '';
      return new Response(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}${cause}`, { status: 500 });
    }
  },
};
