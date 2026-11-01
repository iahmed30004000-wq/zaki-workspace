/**
 * «مساعد المالك» — THE PRIVACY FILTER. Pure: no database, no network, no clock.
 *
 * EVERYTHING that is sent to the model is built here and nowhere else:
 *   `buildContext`   the owner-board aggregates (counts, per-person-per-day completions, open / overdue, on-time rates, steps,
 *                    message COUNTS) as ONE JSON object. It has no field that could hold a message body, a file name, a comment, a
 *                    CRM row or a staff e-mail / phone: the type does not have them, and `verifyContext` re-checks the finished
 *                    object key by key and value by value and REFUSES (throws) on anything outside the list.
 *   `redactText`     the only way a piece of free text (a task title, the owner's typed question) is allowed through: phone numbers
 *                    (any run of 7+ digits, Arabic-Indic digits included, with + - spaces . and brackets), e-mails, links, @handles,
 *                    long identifiers and anything that looks like a secret are replaced by a marker. It returns what it masked.
 *   `describeSent`   the exact request as readable JSON: what the screen shows under «شو انبعت للنموذج».
 *
 * ⚠️ A name written inside a free text (a customer's name in a task title) is NOT something a program can find reliably: a name has
 *    no shape. The filter masks what has a shape (numbers, addresses, secrets) and the screen says so in plain words.
 * 🔧 That is why titles are OFF by default, capped (80 characters, 50 titles per request), redacted when on, and the owner is told;
 *    and why staff are sent as «موظف 1…n» unless the owner allows names.
 */

// ───────────────────────────────────────── digits ─────────────────────────────────────────

/** Arabic-Indic, Extended Arabic-Indic and full-width digits as 0-9, one character for one (so the indexes stay the same). */
export function normalizeDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9\uFF10-\uFF19]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return String(code - 0xff10);
  });
}

// ───────────────────────────────────────── masking free text ─────────────────────────────────────────

export const MASK_KINDS = ["phone", "email", "url", "handle", "id", "secret"] as const;
export type MaskKind = (typeof MASK_KINDS)[number];

/** What a masked piece is replaced with (Arabic, so the model reads it and so does the owner). */
export const MASK_MARKER: Readonly<Record<MaskKind, string>> = {
  phone: "[رقم]",
  email: "[بريد]",
  url: "[رابط]",
  handle: "[معرّف]",
  id: "[رمز]",
  secret: "[سرّي]",
};

export interface Redacted {
  text: string;
  /** How many pieces of each kind were masked. */
  masked: Record<MaskKind, number>;
  /** The total. */
  count: number;
}

interface Rule {
  kind: MaskKind;
  pattern: RegExp;
}

/**
 * The rules, in order. Each one runs over the text the earlier ones left (their markers contain no digit and no Latin letter,
 * so they cannot be matched again). The text is matched with its digits normalised to 0-9, so «٠٧٩١٢٣٤٥٦٧٨» is a phone number too.
 */
const RULES: readonly Rule[] = [
  // a secret with a known shape or a label in front of it
  { kind: "secret", pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g },
  { kind: "secret", pattern: /\b(?:ghp|gho|ghs|ghu|github_pat|xox[abprs]|AKIA|ASIA|AIza|glpat)[-_A-Za-z0-9]{8,}/g },
  { kind: "secret", pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g },
  { kind: "secret", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { kind: "secret", pattern: /(?:\b(?:password|passwd|pwd|secret|token|api[_ -]?key|access[_ -]?key)|كلمة\s*(?:ال)?(?:سر|مرور)|رمز\s*(?:ال)?(?:دخول|سري)|مفتاح)\s*(?:[:=]|هي|هو)\s*\S+/gi },
  { kind: "secret", pattern: /\b[0-9a-f]{32,}\b/gi },
  // links, then e-mails (a link may hold an address), then bare domains
  { kind: "url", pattern: /\b(?:https?|ftp|wss?):\/\/[^\s<>"'«»)\]]+/gi },
  { kind: "url", pattern: /\bwww\.[^\s<>"'«»)\]]+/gi },
  { kind: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g },
  {
    kind: "url",
    pattern: /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|app|dev|me|info|biz|ai|sa|ae|jo|eg|iq|sy|ly|ps|tv|shop|store|site|online|xyz|link|ma|tn|dz|qa|kw|bh|om|lb|tr|uk|us|de|fr|cc|ws|page)\b(?:\/[^\s<>"'«»)\]]*)?/gi,
  },
  { kind: "handle", pattern: /(?<![\p{L}\p{N}_@.])@[\p{L}\p{N}_.]{2,}/gu },
  // identifiers: a UUID, a cuid, then any long mixed token (24+ characters is called a secret, 12-23 an identifier)
  { kind: "id", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { kind: "id", pattern: /\bc[a-z0-9]{24}\b/g },
  { kind: "secret", pattern: /(?<![\w-])(?=[A-Za-z0-9_+/=-]*[A-Za-z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{24,}(?![\w-])/g },
  { kind: "id", pattern: /(?<![\w-])(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{12,23}(?![\w-])/g },
  // a phone number or any long number: seven digits or more, with at most two separators between them. A calendar day (2026-10-30) is not one.
  { kind: "phone", pattern: /(?<!\d)(?!\d{4}-\d{2}-\d{2}(?!\d))\(?\+?\d(?:[\s\-.()]{0,2}\d){6,}(?!\d)/g },
];

const emptyMasked = (): Record<MaskKind, number> => ({ phone: 0, email: 0, url: 0, handle: 0, id: 0, secret: 0 });

function applyRules(input: string, rules: readonly Rule[]): Redacted {
  let text = typeof input === "string" ? input : "";
  const masked = emptyMasked();
  for (const rule of rules) {
    const norm = normalizeDigits(text);
    let out = "";
    let last = 0;
    for (const m of norm.matchAll(rule.pattern)) {
      const index = m.index ?? 0;
      out += text.slice(last, index) + MASK_MARKER[rule.kind];
      last = index + m[0].length;
      masked[rule.kind] += 1;
    }
    text = last === 0 && out === "" ? text : out + text.slice(last);
  }
  return { text, masked, count: MASK_KINDS.reduce((n, k) => n + masked[k], 0) };
}

/** Replaces every phone number, e-mail, link, handle, identifier and secret-looking token by its marker. */
export function redactText(input: string): Redacted {
  return applyRules(input, RULES);
}

/**
 * THE RELAXED FILTER, for a model that runs on the owner's own machine and ONLY when the owner turned the switch on («نموذج محلي»,
 * src/server/ai/local-provider.ts): phone numbers, e-mails, links and @handles pass. Secrets and identifiers are STILL masked, with
 * two extra rules (an ad / access token «EAA…», and any run of 32+ letters, digits, dashes or underscores): an ad token reaches no
 * model at all, local or not. The Claude path never calls this function.
 */
const RELAXED_RULES: readonly Rule[] = [
  ...RULES.filter((r) => r.kind === "secret" || r.kind === "id"),
  { kind: "secret", pattern: /EAA[A-Za-z0-9]{16,}/g },
  { kind: "secret", pattern: /(?<![\w-])[A-Za-z0-9_-]{32,}(?![\w-])/g },
];

export function redactTextRelaxed(input: string): Redacted {
  return applyRules(input, RELAXED_RULES);
}

/** The first `max` characters (code points), with «…» when something was cut. */
export function capText(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
}

/** A title as the model may see it: one line, no control characters, redacted, at most 80 characters. */
export const TITLE_MAX = 80;
export function redactTitle(title: string): { text: string; count: number } {
  const clean = title.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  const r = redactText(clean);
  return { text: capText(r.text, TITLE_MAX), count: r.count };
}

/** Adds the counts of one result to another. */
export function addMasked(into: Record<MaskKind, number>, more: Record<MaskKind, number>): void {
  for (const k of MASK_KINDS) into[k] += more[k];
}

// ───────────────────────────────────────── names → pseudonyms ─────────────────────────────────────────

const MARKS = /[\u064B-\u065F\u0670\u0640]/g;
const stripMarks = (s: string) => s.replace(MARKS, "");
const escapeRe = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** A regular expression that finds `name` however it is typed: with or without vowel marks, alef / ya / ta-marbuta variants, any case. */
function nameRegex(name: string): RegExp | null {
  const base = stripMarks(name).trim();
  if ([...base].length < 2) return null;
  const pieces = [...base].map((ch) => {
    if ("أإآا".includes(ch)) return "[أإآا]";
    if ("يى".includes(ch)) return "[يى]";
    if ("ةه".includes(ch)) return "[ةه]";
    if (/\s/.test(ch)) return "\\s+";
    return escapeRe(ch);
  });
  return new RegExp(pieces.join("[\u064B-\u065F\u0670\u0640]*"), "giu");
}

export interface KnownName {
  /** What to write instead of the name (`موظف 3`, `مساحة 2`). */
  label: string;
  /** The names that stand for it: a full name and anything else it is called. */
  names: readonly string[];
}

export const AMBIGUOUS_NAME_MARKER = "[اسم]";

/**
 * Puts a label in place of every known name found in `text` (the owner's own question may name a person or a space: with names
 * off, the real one must not leave). A full name is replaced first; then each single word of a name (3+ letters) that belongs to
 * ONE entry; a word shared by two entries becomes «[اسم]». Arabic prefixes («لأحمد», «بأحمد») are matched on purpose: the name is
 * found inside the word. Returns how many replacements were made.
 */
export function maskKnownNames(text: string, known: readonly KnownName[]): { text: string; count: number } {
  let out = text;
  let count = 0;
  const swap = (re: RegExp, label: string) => {
    out = out.replace(re, () => {
      count += 1;
      return label;
    });
  };
  const full = known.flatMap((k) => k.names.map((n) => ({ label: k.label, name: stripMarks(n).trim() }))).filter((e) => [...e.name].length >= 2);
  for (const e of [...full].sort((a, b) => b.name.length - a.name.length)) {
    const re = nameRegex(e.name);
    if (re) swap(re, e.label);
  }
  // single words
  const owners = new Map<string, Set<string>>();
  for (const e of full) {
    for (const word of e.name.split(/\s+/)) {
      if ([...word].length < 3) continue;
      const key = word.toLowerCase();
      const set = owners.get(key) ?? new Set<string>();
      set.add(e.label);
      owners.set(key, set);
    }
  }
  for (const [word, labels] of [...owners].sort((a, b) => b[0].length - a[0].length)) {
    const re = nameRegex(word);
    if (re) swap(re, labels.size === 1 ? ([...labels][0] as string) : AMBIGUOUS_NAME_MARKER);
  }
  return { text: out, count };
}

// ───────────────────────────────────────── references ─────────────────────────────────────────

/**
 * A reference is how the model names a thing without knowing it: `U3` a person (written «موظف 3»), `T5` a task, `S2` a space,
 * `P1` a project. The table `{ "U3": "<id>" }` of a conversation is kept on the server: a proposal may only name what is in it.
 */
export type RefKind = "U" | "T" | "S" | "P";
export type RefTable = Record<string, string>;

export const REF_PATTERN = /^[UTSP]\d{1,5}$/;
/** The Arabic word the model and the owner may use for each kind: «موظف 3» is U3, «مهمة 5» is T5, «مساحة 2» is S2, «مشروع 1» is P1. */
export const LABEL_WORD: Readonly<Record<RefKind, string>> = { U: "موظف", T: "مهمة", S: "مساحة", P: "مشروع" };
export const labelOf = (ref: string) => `${LABEL_WORD[ref[0] as RefKind] ?? ""} ${ref.slice(1)}`.trim();
export const staffLabel = (ref: string) => `موظف ${ref.slice(1)}`;

/** A fresh reference table that keeps the references already given (a person keeps their number for the whole conversation). */
class Refs {
  private readonly byId = new Map<string, string>();
  private readonly next: Record<RefKind, number> = { U: 1, T: 1, S: 1, P: 1 };

  constructor(readonly table: RefTable) {
    for (const [ref, id] of Object.entries(table)) {
      if (!REF_PATTERN.test(ref)) continue;
      this.byId.set(`${ref[0]}:${id}`, ref);
      const kind = ref[0] as RefKind;
      this.next[kind] = Math.max(this.next[kind], Number(ref.slice(1)) + 1);
    }
  }

  of(kind: RefKind, id: string): string {
    const known = this.byId.get(`${kind}:${id}`);
    if (known) return known;
    const ref = `${kind}${this.next[kind]++}`;
    this.byId.set(`${kind}:${id}`, ref);
    this.table[ref] = id;
    return ref;
  }
}

const WORD_TO_KIND: Record<string, RefKind> = { "موظف": "U", "مهمة": "T", "مساحة": "S", "مشروع": "P" };
const LABEL_IN_TEXT = /(موظف|مهمة|مساحة|مشروع)\s*([0-9٠-٩۰-۹]{1,5})(?![0-9٠-٩۰-۹])/g;
const REF_IN_TEXT = /(?<![A-Za-z0-9_])([UTSP])(\d{1,5})(?![A-Za-z0-9_])/g;

/** The references a text mentions (`موظف 3` counts as U3). */
export function refsInText(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(LABEL_IN_TEXT)) found.add(`${WORD_TO_KIND[m[1] as string]}${normalizeDigits(m[2] as string)}`);
  for (const m of text.matchAll(REF_IN_TEXT)) found.add(`${m[1]}${m[2]}`);
  return [...found];
}

/** The text with every reference it mentions replaced by `show(ref)` (a reference `show` does not know stays as it is). */
export function restoreRefs(text: string, show: (ref: string) => string | undefined): string {
  const words = text.replace(LABEL_IN_TEXT, (all, word: string, digits: string) => show(`${WORD_TO_KIND[word]}${normalizeDigits(digits)}`) ?? all);
  return words.replace(REF_IN_TEXT, (all, kind: string, digits: string) => show(`${kind}${digits}`) ?? all);
}

// ───────────────────────────────────────── the context ─────────────────────────────────────────

/** The longest context sent, in characters of JSON. */
export const MAX_CONTEXT_CHARS = 60_000;
/** Titles and names of spaces / projects sent in one request. */
export const MAX_TITLES = 50;
/** Tasks listed in one request (with a title only when titles are allowed). */
export const MAX_TASKS = 50;

export interface RawPerson {
  userId: string;
  name: string;
  role: string;
  status: string;
  completed: number;
  openTasks: number;
  overdue: number;
  withDue: number;
  onTime: number;
  late: number;
  onTimeRate: number | null;
  avgDays: number | null;
  steps: number;
  /** COUNT of messages written: the bodies are never read. */
  messages: number;
  /** The company day of the last action in the window (YYYY-MM-DD). */
  lastActiveDay: string | null;
  /** Completions per day of the window, oldest first. */
  perDay: number[];
}

export interface RawTask {
  id: string;
  title: string;
  assigneeId: string | null;
  coAssigneeIds: string[];
  workspaceId: string;
  projectId: string;
  priority: string;
  /** The due day (YYYY-MM-DD) or null. */
  due: string | null;
  /** Days past the due day (null when not overdue / no due day). */
  overdueDays: number | null;
}

export interface RawSpace {
  id: string;
  name: string;
  open: number;
  overdue: number;
  projects: { id: string; name: string }[];
}

export interface RawScope {
  window: { from: string; to: string; today: string };
  /** The space the question is limited to (an id of the list below), or null. */
  spaceId: string | null;
  company: { completed: number; open: number; overdue: number; late: number; avgDays: number | null; messages: number; activePeople: number; idlePeople: number } | null;
  people: RawPerson[];
  spaces: RawSpace[];
  /** The open tasks of the scope (the caller already left out every task that carries a reward). */
  tasks: RawTask[];
  openTasksTotal: number;
}

export interface ContextPerson {
  ref: string;
  label: string;
  /** Only when the owner allowed names. */
  name?: string;
  rank: string;
  status: string;
  completed: number;
  openTasks: number;
  overdue: number;
  withDue: number;
  onTime: number;
  late: number;
  onTimeRate: number | null;
  avgDays: number | null;
  steps: number;
  messages: number;
  lastActive: string | null;
  perDay?: number[];
}

export interface ContextTask {
  ref: string;
  assignee: string | null;
  coAssignees: string[];
  space: string;
  project: string;
  priority: string;
  due: string | null;
  overdueDays: number | null;
  /** Only when the owner allowed titles; redacted, one line, at most 80 characters. */
  title?: string;
}

export interface ContextSpace {
  ref: string;
  /** Only when the owner allowed titles. */
  name?: string;
  open: number;
  overdue: number;
  projects: { ref: string; name?: string }[];
}

export interface AssistantContext {
  window: { from: string; to: string; today: string; days: number };
  spaceFilter: string | null;
  company: RawScope["company"];
  people: ContextPerson[];
  spaces: ContextSpace[];
  tasks: ContextTask[];
  openTasksTotal: number;
  tasksShown: number;
  /** True when the list was cut to fit the size limit. */
  truncated: boolean;
}

export interface ContextOptions {
  allowNames: boolean;
  allowTitles: boolean;
  /** The references already given in this conversation (kept stable); a copy is extended and returned. */
  refs?: RefTable;
  maxTitles?: number;
  maxTasks?: number;
  maxChars?: number;
}

export interface BuiltContext {
  context: AssistantContext;
  refs: RefTable;
  /** What the title filter masked (summed over every title and name sent). */
  masked: number;
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1, NONE: 0 };
const round1 = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * THE one function that builds what goes to the model. People are «موظف 1…n» (their real names only with `allowNames`); a title
 * is present only with `allowTitles` and only after `redactTitle`, and at most `maxTitles` of them. Each person keeps the number
 * they had earlier in the conversation (`refs`). The result is checked by `verifyContext` before it is returned.
 */
export function buildContext(raw: RawScope, options: ContextOptions): BuiltContext {
  const maxTitles = options.maxTitles ?? MAX_TITLES;
  const maxTasks = options.maxTasks ?? MAX_TASKS;
  const maxChars = options.maxChars ?? MAX_CONTEXT_CHARS;
  const refs = new Refs({ ...(options.refs ?? {}) });
  let titlesLeft = options.allowTitles ? maxTitles : 0;
  let masked = 0;

  // a fixed, name-free order: by id, never alphabetical (the order of names would tell who is who)
  const peopleRaw = [...raw.people].sort((a, b) => a.userId.localeCompare(b.userId));
  const people: ContextPerson[] = peopleRaw.map((p) => {
    const ref = refs.of("U", p.userId);
    const person: ContextPerson = {
      ref,
      label: staffLabel(ref),
      rank: p.role,
      status: p.status,
      completed: p.completed,
      openTasks: p.openTasks,
      overdue: p.overdue,
      withDue: p.withDue,
      onTime: p.onTime,
      late: p.late,
      onTimeRate: p.onTimeRate,
      avgDays: round1(p.avgDays),
      steps: p.steps,
      messages: p.messages,
      lastActive: p.lastActiveDay,
      perDay: [...p.perDay],
    };
    if (options.allowNames) {
      const r = redactTitle(p.name);
      masked += r.count;
      person.name = capText(r.text, 60);
    }
    return person;
  });

  // the tasks: overdue first (the longest overdue first), then the nearest due day, then the most urgent
  const tasksRaw = [...raw.tasks]
    .sort((a, b) => {
      const ao = a.overdueDays ?? -1;
      const bo = b.overdueDays ?? -1;
      if (ao !== bo) return bo - ao;
      const ad = a.due ?? "9999-99-99";
      const bd = b.due ?? "9999-99-99";
      if (ad !== bd) return ad < bd ? -1 : 1;
      const pr = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
      return pr !== 0 ? pr : a.id.localeCompare(b.id);
    })
    .slice(0, maxTasks);
  const tasks: ContextTask[] = tasksRaw.map((t) => {
    const task: ContextTask = {
      ref: refs.of("T", t.id),
      assignee: t.assigneeId ? refs.of("U", t.assigneeId) : null,
      coAssignees: t.coAssigneeIds.map((id) => refs.of("U", id)),
      space: refs.of("S", t.workspaceId),
      project: refs.of("P", t.projectId),
      priority: t.priority,
      due: t.due,
      overdueDays: t.overdueDays,
    };
    if (titlesLeft > 0) {
      titlesLeft -= 1;
      const r = redactTitle(t.title);
      masked += r.count;
      task.title = r.text;
    }
    return task;
  });

  const spaces: ContextSpace[] = raw.spaces.map((s) => {
    const space: ContextSpace = { ref: refs.of("S", s.id), open: s.open, overdue: s.overdue, projects: [] };
    if (titlesLeft > 0) {
      titlesLeft -= 1;
      const r = redactTitle(s.name);
      masked += r.count;
      space.name = r.text;
    }
    space.projects = s.projects.map((p) => {
      const project: { ref: string; name?: string } = { ref: refs.of("P", p.id) };
      if (titlesLeft > 0) {
        titlesLeft -= 1;
        const r = redactTitle(p.name);
        masked += r.count;
        project.name = r.text;
      }
      return project;
    });
    return space;
  });

  const days = Math.max(1, dayDiff(raw.window.to, raw.window.from) + 1);
  const context: AssistantContext = {
    window: { from: raw.window.from, to: raw.window.to, today: raw.window.today, days },
    spaceFilter: raw.spaceId ? refs.of("S", raw.spaceId) : null,
    company: raw.company,
    people,
    spaces,
    tasks,
    openTasksTotal: raw.openTasksTotal,
    tasksShown: tasks.length,
    truncated: false,
  };

  // the size limit: first the per-day lists, then the tasks, then the quietest people
  const size = () => JSON.stringify(context).length;
  if (size() > maxChars) for (const p of context.people) delete p.perDay;
  while (size() > maxChars && context.tasks.length > 0) {
    context.tasks.length = Math.floor(context.tasks.length / 2);
    context.tasksShown = context.tasks.length;
    context.truncated = true;
  }
  while (size() > maxChars && context.spaces.length > 0) {
    context.spaces.length = Math.floor(context.spaces.length / 2);
    context.truncated = true;
  }
  while (size() > maxChars && context.people.length > 1) {
    context.people.sort((a, b) => b.completed + b.steps + b.messages - (a.completed + a.steps + a.messages));
    context.people.length = Math.ceil(context.people.length / 2);
    context.truncated = true;
  }

  verifyContext(context, { allowNames: options.allowNames, allowTitles: options.allowTitles });
  return { context, refs: refs.table, masked };
}

// ───────────────────────────────────────── the guard ─────────────────────────────────────────

export class ContextLeakError extends Error {
  constructor(readonly path: string) {
    super(`context.leak:${path}`);
    this.name = "ContextLeakError";
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const REF = REF_PATTERN;
const RANKS = new Set(["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"]);
const STATUSES = new Set(["ACTIVE", "SUSPENDED", "OFFBOARDED"]);
const PRIORITIES = new Set(["URGENT", "HIGH", "NORMAL", "LOW", "NONE"]);

/**
 * The finished context, checked key by key and value by value. A key the list does not know, a text where a number belongs, a
 * reference that is not a reference, a name without the owner's permission, a title without it, a title over 80 characters or
 * with a phone number left in it: each throws `ContextLeakError`, and the caller sends NOTHING. This is the last door, and it
 * does not trust the code above it.
 */
export function verifyContext(ctx: AssistantContext, allow: { allowNames: boolean; allowTitles: boolean }): void {
  const fail = (path: string): never => {
    throw new ContextLeakError(path);
  };
  const num = (v: unknown, path: string) => {
    if (typeof v !== "number" || !Number.isFinite(v)) fail(path);
  };
  const numOrNull = (v: unknown, path: string) => {
    if (v !== null) num(v, path);
  };
  const day = (v: unknown, path: string) => {
    if (typeof v !== "string" || !DAY.test(v)) fail(path);
  };
  const dayOrNull = (v: unknown, path: string) => {
    if (v !== null) day(v, path);
  };
  const ref = (v: unknown, path: string) => {
    if (typeof v !== "string" || !REF.test(v)) fail(path);
  };
  const only = (obj: object, keys: readonly string[], path: string) => {
    for (const k of Object.keys(obj)) if (!keys.includes(k)) fail(`${path}.${k}`);
  };
  const text = (v: unknown, path: string, max: number, allowed: boolean) => {
    if (v === undefined) return;
    if (!allowed || typeof v !== "string" || [...v].length > max) fail(path);
    // a title was already redacted: anything the rules still find is a number, an address or a secret left in it
    if (redactText(v as string).count > 0) fail(path);
  };

  only(ctx, ["window", "spaceFilter", "company", "people", "spaces", "tasks", "openTasksTotal", "tasksShown", "truncated"], "context");
  only(ctx.window, ["from", "to", "today", "days"], "window");
  day(ctx.window.from, "window.from");
  day(ctx.window.to, "window.to");
  day(ctx.window.today, "window.today");
  num(ctx.window.days, "window.days");
  if (ctx.spaceFilter !== null) ref(ctx.spaceFilter, "spaceFilter");
  if (ctx.company !== null) {
    only(ctx.company, ["completed", "open", "overdue", "late", "avgDays", "messages", "activePeople", "idlePeople"], "company");
    for (const k of ["completed", "open", "overdue", "late", "messages", "activePeople", "idlePeople"] as const) num(ctx.company[k], `company.${k}`);
    numOrNull(ctx.company.avgDays, "company.avgDays");
  }
  num(ctx.openTasksTotal, "openTasksTotal");
  num(ctx.tasksShown, "tasksShown");
  if (typeof ctx.truncated !== "boolean") fail("truncated");

  ctx.people.forEach((p, i) => {
    const at = `people[${i}]`;
    only(p, ["ref", "label", "name", "rank", "status", "completed", "openTasks", "overdue", "withDue", "onTime", "late", "onTimeRate", "avgDays", "steps", "messages", "lastActive", "perDay"], at);
    ref(p.ref, `${at}.ref`);
    if (p.ref[0] !== "U" || p.label !== staffLabel(p.ref)) fail(`${at}.label`);
    text(p.name, `${at}.name`, 60, allow.allowNames);
    if (!RANKS.has(p.rank)) fail(`${at}.rank`);
    if (!STATUSES.has(p.status)) fail(`${at}.status`);
    for (const k of ["completed", "openTasks", "overdue", "withDue", "onTime", "late", "steps", "messages"] as const) num(p[k], `${at}.${k}`);
    numOrNull(p.onTimeRate, `${at}.onTimeRate`);
    numOrNull(p.avgDays, `${at}.avgDays`);
    dayOrNull(p.lastActive, `${at}.lastActive`);
    if (p.perDay !== undefined) {
      if (!Array.isArray(p.perDay)) fail(`${at}.perDay`);
      (p.perDay as unknown[]).forEach((n, j) => num(n, `${at}.perDay[${j}]`));
    }
  });

  ctx.spaces.forEach((s, i) => {
    const at = `spaces[${i}]`;
    only(s, ["ref", "name", "open", "overdue", "projects"], at);
    ref(s.ref, `${at}.ref`);
    text(s.name, `${at}.name`, 80, allow.allowTitles);
    num(s.open, `${at}.open`);
    num(s.overdue, `${at}.overdue`);
    s.projects.forEach((p, j) => {
      only(p, ["ref", "name"], `${at}.projects[${j}]`);
      ref(p.ref, `${at}.projects[${j}].ref`);
      text(p.name, `${at}.projects[${j}].name`, 80, allow.allowTitles);
    });
  });

  ctx.tasks.forEach((t, i) => {
    const at = `tasks[${i}]`;
    only(t, ["ref", "assignee", "coAssignees", "space", "project", "priority", "due", "overdueDays", "title"], at);
    ref(t.ref, `${at}.ref`);
    if (t.assignee !== null) ref(t.assignee, `${at}.assignee`);
    t.coAssignees.forEach((c, j) => ref(c, `${at}.coAssignees[${j}]`));
    ref(t.space, `${at}.space`);
    ref(t.project, `${at}.project`);
    if (!PRIORITIES.has(t.priority)) fail(`${at}.priority`);
    dayOrNull(t.due, `${at}.due`);
    numOrNull(t.overdueDays, `${at}.overdueDays`);
    text(t.title, `${at}.title`, 80, allow.allowTitles);
  });
}

// ───────────────────────────────────────── what was sent ─────────────────────────────────────────

/** What the screen shows under «شو انبعت للنموذج»: the whole request, as it left the server. */
export interface SentView {
  model: string;
  maxTokens: number;
  system: string;
  tools: string[];
  /** The earlier turns of the conversation, as they were sent. */
  history: { role: "user" | "assistant"; content: string }[];
  /** The aggregated data of this question (the object `buildContext` made). */
  data: AssistantContext;
  /** The owner's question after the filter. */
  question: string;
}

/** The exact request as readable JSON (two-space indent, the keys in a fixed order). */
export function describeSent(view: SentView): string {
  return JSON.stringify(
    { model: view.model, maxTokens: view.maxTokens, system: view.system, tools: view.tools, history: view.history, data: view.data, question: view.question },
    null,
    2,
  );
}
