import { Output, generateText } from 'ai';
import { z } from 'zod';

import { type LoadedRow, Rule, type RuleResult } from '@workspace/elt';
import { ruleIdentity } from '@workspace/model-calls/rule-identity';
import { ground } from '@workspace/quote-grounding';

import { callFailures } from '../call-failure.ts';
import {
  type Page,
  placeholder,
  prompt,
  readPage,
  settings,
} from './evaluation.ts';
import model from './model.ts';

// What a field asks of a page, whatever the name that a dataset gives it.
const fieldSchema = z.discriminatedUnion('format', [
  z.object({
    description: z.string(),
    format: z.enum(['text', 'number', 'date', 'url']),
  }),
  z.object({
    description: z.string(),
    format: z.literal('options'),
    // As the definitions keep it: a JSON array of strings.
    options: z
      .string()
      .transform((options): readonly string[] =>
        z.array(z.string()).parse(JSON.parse(options)),
      ),
  }),
]);
type Field = z.infer<typeof fieldSchema>;

// A page that meets every criterion of a dataset, and a field that the
// dataset reads from it.
type Asked = { readonly page: Page; readonly field: Field };

// The value of a field in its format: text, a number, an ISO 8601 date, a
// URL or one of its options; null when the page does not state it.
function valueSchema(field: Field) {
  switch (field.format) {
    case 'number':
      return z.number().nullable();
    case 'options':
      return z.enum(field.options).nullable();
    case 'text':
    case 'date':
    case 'url':
      return z.string().nullable();
  }
}

// What the model answers: the quote first, so it copies the sentence that
// states the value before it reads the value.
const answerSchema = (field: Field) =>
  z.object({ quote: z.string().nullable(), value: valueSchema(field) });

const formats = {
  text: 'text',
  number: 'a number, without units or thousands separators',
  date: 'an ISO 8601 date, such as 2026-11-03',
  url: 'an absolute URL',
  options: 'exactly one of the options',
};

const system =
  'You read one web page and extract one field from it. First copy, word for word, the one sentence of the page text that states the field, as quote; null when no sentence does. Never quote the URL or the title. Then give value in the format asked, read from that sentence; null when the page does not state it.';

const instruction = (field: Field) =>
  [
    `Field: ${field.description}`,
    `Format: ${formats[field.format]}`,
    ...(field.format === 'options'
      ? [`Options: ${field.options.join(' | ')}`]
      : []),
  ].join('\n');

// A field of a page that meets every criterion, as GPT-6-Luna reads the
// page. Each page and field is one input, whatever the datasets that read
// it. The quote stays only when it is in the page text.
export class FieldValue extends Rule<Asked, string> {
  override readonly key = {
    name: 'pair',
    description:
      'The article URL of the page and the field, as a JSON array of the URL, the description, the format and the options.',
  };
  override readonly output = {
    value: {
      type: 'text',
      description:
        'The value as JSON: a string, a number or null. NULL unless status is computed.',
    },
    quote: {
      type: 'text',
      description:
        'The sentence of the page text that states the value, or NULL when the page has none.',
    },
  } as const;
  override readonly batch = 1;
  override readonly concurrency = 4;

  override read(row: LoadedRow) {
    const read = readPage(row);
    const field = fieldSchema.safeParse(row);
    return read === null || !field.success
      ? null
      : { key: read.pair, input: { page: read.page, field: field.data } };
  }

  // The model and everything that it reads besides the page and the field:
  // the prompt and the schema of each format.
  override async identity(): Promise<string> {
    const asked = (format: Field['format']): Field =>
      format === 'options'
        ? { description: '{description}', format, options: ['{option}'] }
        : { description: '{description}', format };
    const shapes = (['text', 'number', 'date', 'url', 'options'] as const).map(
      (format) => ({
        prompt: prompt(instruction(asked(format)), placeholder),
        schema: z.toJSONSchema(answerSchema(asked(format))),
      }),
    );
    return ruleIdentity(model.modelId, { system, shapes, settings });
  }

  override async compute(
    inputs: readonly Asked[],
    signal?: AbortSignal,
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return Promise.all(inputs.map((input) => this.#extract(input, signal)));
  }

  async #extract(
    { page, field }: Asked,
    signal: AbortSignal | undefined,
  ): Promise<RuleResult<Readonly<Record<string, string>>>> {
    let answer;
    try {
      ({ output: answer } = await generateText({
        model,
        instructions: system,
        prompt: prompt(instruction(field), page),
        output: Output.object({ schema: answerSchema(field) }),
        ...settings,
        abortSignal: signal,
      }));
    } catch (error) {
      return { error: callFailures.reason(error) };
    }
    const { quote } = answer;
    const grounded = quote !== null && ground(page.text, quote) !== null;
    return {
      value: {
        value: JSON.stringify(answer.value),
        ...(grounded ? { quote } : {}),
      },
    };
  }
}
