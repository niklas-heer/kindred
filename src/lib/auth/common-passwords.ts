// The bundled list of passwords too common to accept (src/lib/auth/password.server.ts). Only passwords of twelve characters
// or more can be typed at all, so the list holds the long ones that turn up again and again in published breach corpora, plus
// the short favourites that people stretch to twelve with digits or symbols ("password1234", "Sommer2024!!"). Compared in
// lower case. Plain data, no imports: the browser may show the same answer before sending.

const EXACT = `
000000000000 111111111111 123123123123 121212121212 112233445566 123456654321 123456789012 1234567890123 12345678901234
123456789123 1234567891011 987654321012 098765432112 147258369147 159753159753 147852369000 789456123789 741852963741
123456789abc 1234567890ab 1234567890qwerty 1234qwerasdf qwer1234asdf a1b2c3d4e5f6 aa123456789 abc123456789 abcd12345678
abcdef123456 abcdefghijkl abcdefghijklm abcdefghijklmn 123abc123abc aaaaaaaaaaaa qwertyuiopas qwertyuiop12 qwertyuiop123
qwertyuiopasdf qwertyuiopasdfghjkl qwertyqwerty qwerty123456 qwerty1234567 qwerty12345678 1q2w3e4r5t6y 1q2w3e4r5t6y7u
1qaz2wsx3edc 1qaz2wsx3edc4rfv zaq12wsxcde3 1qazxsw23edc qazwsxedcrfv qazwsxedc123 asdfghjkl123 asdfghjklqwe asdfasdfasdf
zxcvbnm12345 zxcvbnm123456 123qweasdzxc qweasdzxc123 passwordpassword password1234 password12345 password123456 password123!
p@ssw0rd1234 p@ssword1234 passw0rd1234 passw0rdpassw0rd iloveyou1234 iloveyou12345 iloveyouiloveyou letmein12345
letmeinletmein welcome12345 welcome123456 changeme1234 administrator administrator1 admin1234567 adminadmin123 football1234
baseball1234 basketball12 basketball123 superman1234 princess1234 sunshine1234 starwars1234 trustno1trustno1 monkey123456
dragon123456 master123456 michael12345 jennifer1234 liverpool1234 chelsea12345 arsenal12345 manchester12 manchesterunited
myspace12345 facebook1234 google123456 whatever1234 nothing12345 computer1234 internet1234 familytree123 familytree1234
ourfamily123 myfamily1234 kindred12345 kindredkindred correcthorsebatterystaple
`;

/** Words people stretch to twelve characters with digits and symbols. */
const BASE_WORDS = `
password passwort wachtwoord wagwoord motdepasse contrasena qwerty qwertz azerty iloveyou letmein welcome willkommen welkom
admin administrator changeme football baseball superman princess sunshine starwars monkey dragon master shadow kindred
family familie familytree stammbaum stamboom geheim hallo sommer summer winter schatz liebe test login abc abcdef abcdefgh
`;

const exact = new Set(EXACT.split(/\s+/).filter(Boolean));
const words = new Set(BASE_WORDS.split(/\s+/).filter(Boolean));

/** Leetspeak back to letters, so "P@ssw0rd" is "password". */
const unleet = (s: string) => s.replace(/@/g, 'a').replace(/0/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/\$/g, 's').replace(/5/g, 's').replace(/7/g, 't');

/** Digits counting up or down by one, wrapping (1234567890…, 9876543210…). */
function isRun(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const step = (i: number) => (Number(s[i + 1]) - Number(s[i]) + 10) % 10;
  const first = step(0);
  return (first === 1 || first === 9) && [...s.slice(1, -1)].every((_, i) => step(i + 1) === first);
}

/**
 * Whether `password` is on the list: itself, a short block repeated ("abcabcabcabc", "sommersommer"), a run of digits, or a
 * listed word (also in leetspeak) with only digits and symbols around it ("Password2024!", "iloveyou!!!!").
 */
export function isCommonPassword(password: string): boolean {
  const p = password.toLowerCase();
  const squeezed = p.replace(/\s+/g, '');
  if (exact.has(p) || exact.has(squeezed)) return true;
  if (/^(.{1,8})\1+$/.test(squeezed) || isRun(squeezed)) return true;
  // Strip what people add around a word: digits and symbols at either end.
  const core = squeezed.replace(/^[^a-z@$]+/, '').replace(/[^a-z]+$/, '');
  return !!core && (words.has(core) || words.has(unleet(core)));
}
