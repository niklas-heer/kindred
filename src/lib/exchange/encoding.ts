// The bytes of a GEDCOM file as text. Kindred writes UTF-8, but older programs write UTF-16, Windows-1252 ("ANSI") or
// ANSEL, the library character set GEDCOM 5.5.1 names as its default. The byte order mark decides first, then the
// file's own `1 CHAR` line. Pure, so the import page decodes a file in the browser before it is sent, and the tests
// and scripts can do the same. A byte the character set does not have becomes U+FFFD; `readGedcom` counts those.

export type Charset = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' | 'macintosh' | 'ansel';

/** The decoder for a `1 CHAR` value, or null when Kindred cannot read that character set. */
export function charsetOf(name: string): Charset | null {
  const n = name.trim().toUpperCase().replace(/[\s_]/g, '-');
  if (['UTF-8', 'UTF8', 'ASCII', 'US-ASCII'].includes(n)) return 'utf-8';
  // GEDCOM's UNICODE is UTF-16, which a byte order mark or the zero bytes give away before this is asked. A file that
  // says UNICODE and has neither is in an ASCII-based encoding, and programs that write that mean UTF-8.
  if (n === 'UNICODE') return 'utf-8';
  // ISO-8859-1 is read as Windows-1252, as browsers do: the two differ only in control characters no file holds.
  if (['ANSI', 'WINDOWS-1252', 'CP1252', 'CP-1252', 'ISO-8859-1', 'ISO8859-1', 'LATIN1', 'LATIN-1'].includes(n)) return 'windows-1252';
  if (['MACINTOSH', 'MACROMAN', 'MAC'].includes(n)) return 'macintosh';
  if (n === 'ANSEL') return 'ansel';
  return null;
}

/** The text of a GEDCOM file, decoded as its byte order mark or its `1 CHAR` line says (UTF-8 when neither does). */
export function decodeGedcom(bytes: Uint8Array): string {
  const [a, b, c] = bytes;
  if (a === 0xef && b === 0xbb && c === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (a === 0xff && b === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (a === 0xfe && b === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  // UTF-16 without a mark: a file starts with "0 HEAD", so one of its first two bytes is zero.
  if (bytes.length >= 2 && a !== 0 && b === 0) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && a === 0 && b !== 0) return new TextDecoder('utf-16be').decode(bytes);

  // Every other character set keeps ASCII as it is, so the header can be read byte for byte to find the CHAR line.
  let head = '';
  for (const x of bytes.subarray(0, 65536)) head += String.fromCharCode(x);
  const declared = /^[ \t]*1[ \t]+CHAR[ \t]+([^\r\n]+)/m.exec(head)?.[1];
  const charset = (declared && charsetOf(declared)) || 'utf-8';
  if (charset === 'ansel') return decodeAnsel(bytes);
  return new TextDecoder(charset).decode(bytes);
}

// ANSEL (ANSI Z39.47) as GEDCOM uses it: ASCII below 0x80, letters and signs from 0xA1, and combining marks from 0xE0
// that come before the letter they sit on (Unicode puts them after).
const ANSEL_SPACING: Record<number, string> = {
  0xa1: 'Ł', 0xa2: 'Ø', 0xa3: 'Đ', 0xa4: 'Þ', 0xa5: 'Æ', 0xa6: 'Œ', 0xa7: 'ʹ', 0xa8: '·', 0xa9: '♭', 0xaa: '®', 0xab: '±',
  0xac: 'Ơ', 0xad: 'Ư', 0xae: 'ʼ', 0xb0: 'ʻ', 0xb1: 'ł', 0xb2: 'ø', 0xb3: 'đ', 0xb4: 'þ', 0xb5: 'æ', 0xb6: 'œ', 0xb7: 'ʺ',
  0xb8: 'ı', 0xb9: '£', 0xba: 'ð', 0xbc: 'ơ', 0xbd: 'ư', 0xc0: '°', 0xc1: 'ℓ', 0xc2: '℗', 0xc3: '©',
  0xc4: '♯', 0xc5: '¿', 0xc6: '¡', 0xc7: 'ß', 0xc8: '€', 0xcf: 'ß',
};
const ANSEL_COMBINING: Record<number, string> = {
  0xe0: '̉', 0xe1: '̀', 0xe2: '́', 0xe3: '̂', 0xe4: '̃', 0xe5: '̄', 0xe6: '̆',
  0xe7: '̇', 0xe8: '̈', 0xe9: '̌', 0xea: '̊', 0xeb: '︠', 0xec: '︡', 0xed: '̕',
  0xee: '̋', 0xef: '̐', 0xf0: '̧', 0xf1: '̨', 0xf2: '̣', 0xf3: '̤', 0xf4: '̥',
  0xf5: '̳', 0xf6: '̲', 0xf7: '̦', 0xf8: '̜', 0xf9: '̮', 0xfa: '︢', 0xfb: '︣',
  0xfe: '̓',
};

function decodeAnsel(bytes: Uint8Array): string {
  let out = '';
  let marks = '';
  for (const x of bytes) {
    const mark = ANSEL_COMBINING[x];
    if (mark) {
      marks += mark;
      continue;
    }
    const ch = x < 0x80 ? String.fromCharCode(x) : (ANSEL_SPACING[x] ?? '�');
    // Marks with no letter after them on the line are kept where they were rather than moved onto the line break.
    if (marks && (ch === '\r' || ch === '\n')) out += marks + ch;
    else out += ch + marks;
    marks = '';
  }
  // Composed, as the same name typed into Kindred would be, so matching by name finds it.
  return (out + marks).normalize('NFC');
}
