/**
 * «اسم المستخدم بينعمل لحاله لما بضيف شخص جديد» (the owner, 2026-11-27): a sign-in name made from the person's name. An Arabic name is written in latin
 * letters (the common names as people write them, the rest letter by letter), the first and the last word joined by a dot. It is only a SUGGESTION: whoever
 * adds the person may type another, the server makes it free of the names already taken, and the person may change it later. Pure.
 */
const KNOWN: Readonly<Record<string, string>> = {
  محمد: "mohammad", أحمد: "ahmad", احمد: "ahmad", محمود: "mahmoud", مصطفى: "mustafa", علي: "ali", عمر: "omar", عمرو: "amr", عثمان: "othman", خالد: "khaled",
  حسن: "hasan", حسين: "hussein", يوسف: "yousef", ابراهيم: "ibrahim", إبراهيم: "ibrahim", عبدالله: "abdullah", عبدالرحمن: "abdulrahman", سامر: "samer",
  سامي: "sami", وسام: "wissam", باسل: "basel", بلال: "bilal", طارق: "tareq", ياسر: "yaser", زياد: "ziad", رامي: "rami", فادي: "fadi", ماهر: "maher",
  مهند: "mohannad", أنس: "anas", انس: "anas", حمزة: "hamza", كريم: "karim", نور: "nour", سارة: "sara", مريم: "mariam", فاطمة: "fatima", سلمى: "salma",
  هبة: "hiba", رنا: "rana", لينا: "lina", دانا: "dana", آية: "aya", اية: "aya", إيمان: "iman", ايمان: "iman", زينب: "zainab", ليلى: "layla", رغد: "raghad",
};

const LETTERS: Readonly<Record<string, string>> = {
  ا: "a", أ: "a", إ: "e", آ: "a", ٱ: "a", ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh", د: "d", ذ: "z", ر: "r", ز: "z", س: "s", ش: "sh", ص: "s", ض: "d",
  ط: "t", ظ: "z", ع: "a", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", و: "o", ي: "i", ى: "a", ة: "a", ئ: "e", ؤ: "o", ء: "",
  پ: "p", چ: "ch", ڤ: "v", گ: "g", ک: "k", ی: "i",
};

export const SUGGESTED_MAX = 24;

function latinWord(word: string): string {
  const known = KNOWN[word];
  if (known) return known;
  let out = "";
  const chars = [...word];
  for (const [i, ch] of chars.entries()) {
    // «و» and «ي» at the start of a word are consonants
    if (i === 0 && ch === "و") out += "w";
    else if (i === 0 && ch === "ي") out += "y";
    else if (ch in LETTERS) out += LETTERS[ch];
    else out += ch.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  return out;
}

/** The words of a name, with the marks of Arabic writing taken out and «عبد ال…» kept as the one name it is. */
function wordsOf(name: string): string[] {
  return name
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/(^|\s)(عبد)\s+(?=ال)/g, "$1$2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The suggested sign-in name, or "" while the name gives nothing to make one from. Always fits the username rule (3 to 32 of a-z 0-9 . _ -). */
export function usernameFromName(name: string): string {
  const parts = wordsOf(name).map(latinWord).filter(Boolean);
  if (parts.length === 0) return "";
  const joined = (parts.length === 1 ? parts[0]! : `${parts[0]}.${parts[parts.length - 1]}`).slice(0, SUGGESTED_MAX).replace(/[._-]+$/, "");
  return joined.length >= 3 ? joined : `${joined}${"user".slice(0, 4)}`;
}
