/** A small syntax highlighter for game sources, compiled ES5 and the C header.
 * It only wraps characters in spans, so the result lines up with a textarea. */
const KEYWORDS = new Set([
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'break', 'continue',
  'new', 'typeof', 'instanceof', 'in', 'of', 'switch', 'case', 'default', 'throw', 'try', 'catch', 'finally',
  'this', 'true', 'false', 'null', 'undefined', 'void', 'delete', 'type', 'interface', 'declare', 'as',
  'satisfies', 'readonly', 'number', 'string', 'boolean',
]);
const C_KEYWORDS = new Set(['static', 'const', 'unsigned', 'char', 'int', 'struct', 'constexpr', 'uint16_t']);
const TOKEN = /(\/\/[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|('(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?|`(?:[^`\\]|\\.)*`?)|(\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(#[a-z]+|[A-Za-z_$][\w$]*)/g;

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (kind: string, text: string) => `<span class="tok-${kind}">${escape(text)}</span>`;

export function highlight(source: string, language: 'ts' | 'c' = 'ts'): string {
  let html = '';
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    html += escape(source.slice(last, index));
    last = index + match[0].length;
    const [text, line, block, string, number, word] = match;
    if (line || block) html += span('comment', text);
    else if (string) html += span('string', text);
    else if (number) html += span(language === 'c' && text.startsWith('0x') ? 'hex' : 'number', text);
    else if (word) {
      const kind = classify(word, source, last, language);
      html += kind ? span(kind, word) : escape(word);
    } else html += escape(text);
  }
  html += escape(source.slice(last));
  // A textarea shows an empty last line after a final newline; keep the heights equal.
  return html + '\n ';
}

function classify(word: string, source: string, end: number, language: 'ts' | 'c'): string | null {
  if (language === 'c') return word.startsWith('#') || C_KEYWORDS.has(word) ? 'keyword' : null;
  if (KEYWORDS.has(word)) return 'keyword';
  if (word === 'nds') return 'nds';
  let next = end;
  while (source[next] === ' ') next++;
  if (source[next] === '(') return 'call';
  if (/^[A-Z][a-z]/.test(word) || word.startsWith('NDS')) return 'type';
  return null;
}
