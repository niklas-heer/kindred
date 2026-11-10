// An SVG as a data: URI for an <img>. encodeURIComponent made every drawn portrait half as long again (each space, =, / and
// : became three bytes), and the tree page inlines dozens of them into its HTML. Only what has to be escaped is:
//   %  starts an escape itself;  #  would end the URL and begin a fragment;
//   < > " ' &  are valid in the URL, but React writes them into the HTML attribute as entities of four to six bytes,
//              where a percent escape takes three.
// Tabs and line breaks are dropped by the URL parser, so they become spaces first. Everything else, non-ASCII included,
// goes as it is: the page is UTF-8, and the browser percent-encodes it while parsing the URL.
const ESCAPES: Record<string, string> = { '%': '%25', '#': '%23', '<': '%3C', '>': '%3E', '"': '%22', "'": '%27', '&': '%26' };

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${svg.replace(/[\t\n\r]+/g, ' ').replace(/[%#<>"'&]/g, (c) => ESCAPES[c])}`;
}
