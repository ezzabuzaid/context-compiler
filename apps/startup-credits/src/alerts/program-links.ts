import { getDomain } from 'tldts';

// A link of a list to a program: the list, the linked page and the text of
// the link.
export type Claim = {
  readonly list: string;
  readonly url: string;
  readonly text: string | null;
};

// What two links share when they name one program: the registrable domain of
// the page, or the text of the link as a name.
function sharedKeys({ url, text }: Claim) {
  const domain = getDomain(url);
  const name =
    text === null
      ? null
      : `name:${text.toLowerCase().replace(/\s+/gu, ' ').trim()}`;
  return [domain, name].flatMap((key) => (key === null ? [] : [key]));
}

// A claim that shares a key with earlier programs merges them into one, so
// the links of a program do not depend on the order of the claims. Each
// program is named by the first of its members, which `programOfKey` points
// every one of its keys at.
export function groupIntoPrograms(claims: readonly Claim[]) {
  const linksOfProgram = new Map<string, Claim[]>();
  const programOfKey = new Map<string, string>();
  for (const claim of claims) {
    const keys = sharedKeys(claim);
    const merged = [
      ...new Set(keys.flatMap((key) => programOfKey.get(key) ?? [])),
    ];
    const program = merged[0] ?? claim.url;
    const links = [
      ...merged.flatMap((member) => linksOfProgram.get(member) ?? []),
      claim,
    ];
    for (const member of merged) linksOfProgram.delete(member);
    linksOfProgram.set(program, links);
    for (const [key, member] of programOfKey)
      if (merged.includes(member)) programOfKey.set(key, program);
    for (const key of keys) programOfKey.set(key, program);
  }
  return [...linksOfProgram.values()];
}
