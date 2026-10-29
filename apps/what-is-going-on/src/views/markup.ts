// HTML that is safe to put in a page: markup`` escapes every value it puts in,
// except other Html.
export class Html {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

type Value =
  Html | string | number | null | undefined | false | readonly Value[];

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function render(value: Value): string {
  if (value instanceof Html) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return String(value).replace(/[&<>"']/g, (char) => escapes[char] ?? char);
}

export function markup(strings: TemplateStringsArray, ...values: Value[]) {
  return new Html(
    strings.reduce(
      (text, string, index) => text + render(values[index - 1]) + string,
    ),
  );
}

// Items with " | " between them, as brutalist.report's navigation.
export const separated = (items: readonly Html[]) =>
  items.map((item, index) => markup`${index === 0 ? '' : ' | '}${item}`);
