/**
 * Finds user-visible English written straight into the code, by reading the syntax tree rather than grepping.
 * The test in `no-hardcoded.test.ts` runs it over the app; see that file for what is allowed and why.
 */
import { parse } from '@babel/parser';

export type Finding = { line: number; kind: string; text: string };

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

/** Attributes and props whose value a reader sees or hears. */
const TEXT_ATTRIBUTES = new Set([
  'title', 'placeholder', 'alt', 'label', 'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext',
  'aria-placeholder', 'description', 'hint', 'subtitle', 'heading', 'body', 'message', 'tooltip', 'caption', 'emptyText',
  'emptyLabel', 'confirmLabel', 'cancelLabel', 'submitLabel', 'actionLabel',
]);

/** Object properties that carry reader-facing text, in option lists and toasts. */
const TEXT_PROPERTIES = new Set(['label', 'title', 'body', 'placeholder', 'description', 'hint', 'heading', 'subtitle', 'message', 'tooltip', 'caption']);

/** Calls whose arguments are never shown as written: translation lookups, class joiners, loggers and matchers. */
const OPAQUE_CALLS = /^(?:t|c|translate|translateMessage|cx|clsx|cn|console\.\w+|require|import|Symbol|RegExp|encodeURIComponent|new URL|fetch|sql|prepare|exec|run|get|all|\w+\.(?:prepare|exec|run|get|all|query|startsWith|endsWith|includes|split|replace|replaceAll|match|test|join|indexOf|localeCompare|getItem|setItem|removeItem|setAttribute|getAttribute|closest|querySelector|querySelectorAll|addEventListener|removeEventListener|dispatchEvent|has|delete|set))$/;

const KEY_LIKE = /^[a-z]+(?:\.[a-zA-Z0-9_]+)+$/;
const hasWords = (text: string) => /\p{L}{2,}/u.test(text);
/** A sentence or phrase: a capital, then at least one more word. Identifiers, CSS and paths do not look like this. */
const looksLikeProse = (text: string) =>
  /^[\p{Lu}][\p{Ll}’'-]*(?:,? [\p{L}\p{N}’'(),.:;/-]+)+[.!?…]?$/u.test(text.trim());

const calleeName = (node: Node): string => {
  const callee = node.callee as Node;
  if (callee.type === 'Identifier') return callee.name as string;
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const object = callee.object as Node;
    const property = callee.property as Node;
    return `${object.type === 'Identifier' ? object.name : object.type === 'ThisExpression' ? 'this' : '_'}.${property.name}`;
  }
  return '';
};

/** Every literal piece of text an expression can evaluate to, without entering calls. */
function literalsOf(node: Node | null | undefined): Array<{ node: Node; text: string }> {
  if (!node) return [];
  switch (node.type) {
    case 'StringLiteral':
      return [{ node, text: node.value as string }];
    case 'TemplateLiteral':
      return [{ node, text: (node.quasis as Node[]).map((q) => (q.value as { cooked: string }).cooked).join(' ') }];
    case 'ConditionalExpression':
      return [...literalsOf(node.consequent as Node), ...literalsOf(node.alternate as Node)];
    case 'LogicalExpression':
      return [...literalsOf(node.left as Node), ...literalsOf(node.right as Node)];
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
    case 'JSXExpressionContainer':
      return literalsOf(node.expression as Node);
    default:
      return [];
  }
}

const filledTemplate = (node: Node) => (node.quasis as Node[]).map((q) => (q.value as { cooked: string }).cooked).join('Xx');

const key = (name: Node | undefined): string =>
  !name ? '' : name.type === 'Identifier' ? (name.name as string) : name.type === 'StringLiteral' ? (name.value as string) : '';

const attributeName = (node: Node): string => {
  const name = node.name as Node;
  return name.type === 'JSXIdentifier' ? (name.name as string) : '';
};

/** Scans one source file. `knownMessage` says whether the dictionary has a thrown text; `knownTitle` whether a page title word is translated. */
export function scan(source: string, filename: string, knownMessage: (text: string) => boolean, knownTitle: (text: string) => boolean = () => true): Finding[] {
  const jsx = filename.endsWith('.tsx');
  const ast = parse(source, { sourceType: 'module', plugins: jsx ? ['typescript', 'jsx'] : ['typescript'], errorRecovery: true }) as unknown as Node;
  const found: Finding[] = [];
  const add = (node: Node, kind: string, text: string) =>
    found.push({ line: node.loc?.start.line ?? 0, kind, text: text.trim().replace(/\s+/g, ' ').slice(0, 120) });
  const seen = new Set<Node>();
  const flag = (kind: string, literals: Array<{ node: Node; text: string }>) => {
    for (const l of literals) {
      // A translation key handed to a component that translates it, such as label="tp.up".
      if (seen.has(l.node) || !hasWords(l.text) || KEY_LIKE.test(l.text)) continue;
      seen.add(l.node);
      add(l.node, kind, l.text);
    }
  };

  /**
   * A thrown sentence reaches the reader through translateMessage, so the dictionary must hold it. Lower-case
   * messages are codes and developer notes ("bad-output", "expected form data"), which the UI maps or never shows.
   */
  function checkThrown(node: Node) {
    const arg = (node.arguments as Node[])[0];
    for (const l of literalsOf(arg)) {
      if (seen.has(l.node)) continue;
      seen.add(l.node);
      // Placeholders become a sample word, so a template is matched the way translateMessage matches the real text.
      const text = l.node.type === 'TemplateLiteral' ? filledTemplate(l.node) : l.text;
      if (/^\p{Lu}/u.test(text) && !KEY_LIKE.test(text) && !knownMessage(text)) add(l.node, 'throw', text);
    }
  }

  function walk(node: Node, parent: Node | undefined) {
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'TSTypeAnnotation':
      case 'TSTypeAliasDeclaration':
      case 'TSInterfaceDeclaration':
        return;
      case 'JSXElement': {
        // Key caps name a physical key, and are written the same in every language.
        const opening = (node.openingElement as Node).name as Node;
        if (opening.type === 'JSXIdentifier' && opening.name === 'kbd') return;
        break;
      }
      case 'JSXText':
        if (hasWords(node.value as string)) add(node, 'jsx-text', node.value as string);
        return;
      case 'JSXAttribute':
        if (TEXT_ATTRIBUTES.has(attributeName(node))) flag(`attr:${attributeName(node)}`, literalsOf(node.value as Node));
        break;
      case 'JSXExpressionContainer':
        if (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) flag('jsx-expr', literalsOf(node.expression as Node));
        break;
      case 'ObjectProperty':
        if (jsx && TEXT_PROPERTIES.has(key(node.key as Node)) && !node.computed) flag(`prop:${key(node.key as Node)}`, literalsOf(node.value as Node).filter((l) => /^\p{Lu}/u.test(l.text.trim())));
        break;
      case 'NewExpression':
        if ((node.callee as Node).type === 'Identifier' && /Error$/.test((node.callee as Node).name as string) && parent?.type === 'ThrowStatement') checkThrown(node);
        break;
      case 'CallExpression': {
        const name = calleeName(node);
        if (/^(?:window\.)?(?:alert|confirm|prompt)$/.test(name) || name === 'toast' || name.startsWith('toast.')) flag('dialog', (node.arguments as Node[]).flatMap(literalsOf));
        if (name === 'sectionHead') {
          for (const l of (node.arguments as Node[]).flatMap(literalsOf)) if (!knownTitle(l.text)) add(l.node, 'page-title', l.text);
          return;
        }
        if (OPAQUE_CALLS.test(name)) return;
        break;
      }
      case 'AssignmentExpression': {
        const left = node.left as Node;
        if (left.type === 'MemberExpression' && (left.property as Node).name === 'title') flag('document-title', literalsOf(node.right as Node));
        break;
      }
      case 'StringLiteral':
        if (jsx && looksLikeProse(node.value as string) && parent?.type !== 'JSXAttribute') flag('prose', [{ node, text: node.value as string }]);
        return;
      default:
    }
    for (const [field, value] of Object.entries(node)) {
      if (field === 'loc' || field === 'extra' || field === 'leadingComments' || field === 'trailingComments' || field === 'innerComments') continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof (child as Node).type === 'string') walk(child as Node, node);
      } else if (value && typeof (value as Node).type === 'string') {
        walk(value as Node, node);
      }
    }
  }
  walk((ast.program as Node), undefined);
  return found;
}
