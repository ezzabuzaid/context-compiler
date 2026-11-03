import { createHash } from 'node:crypto';

import { Output, generateText } from 'ai';
import { z } from 'zod';

import { type LoadedRow, Rule, type RuleResult } from '@workspace/elt';
import { ground } from '@workspace/quote-grounding';

import type { Field as Definition } from '../collection.ts';
import {
  type Page,
  pageFailure,
  prompt,
  readPage,
  settings,
} from './evaluation.ts';
import model from './model.ts';

// The value of a field in its format: text, a number, an ISO 8601 date, a
// URL or one of its options; null when the page does not state it.
function valueSchema(field: Definition) {
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
const answerSchema = (field: Definition) =>
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

// One field of the items of a collection, as GPT-6-Luna reads each item's
// page. The quote stays only when it is in the page text.
export class FieldValue extends Rule<Page, string> {
  readonly #field: Definition;
  readonly #schema: ReturnType<typeof answerSchema>;

  override readonly key = {
    name: 'articleUrl',
    description: 'The article URL of the page.',
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

  constructor(field: Definition) {
    super();
    this.#field = field;
    this.#schema = answerSchema(field);
  }

  override read(row: LoadedRow) {
    return readPage(row);
  }

  #instruction(): string {
    const { description, format } = this.#field;
    return [
      `Field: ${description}`,
      `Format: ${formats[format]}`,
      ...(this.#field.format === 'options'
        ? [`Options: ${this.#field.options.join(' | ')}`]
        : []),
    ].join('\n');
  }

  override async identity(): Promise<string> {
    return `${model.modelId}:${createHash('sha256')
      .update(
        JSON.stringify({
          system,
          prompt: prompt(this.#instruction(), {
            url: '{url}',
            title: '{title}',
            text: '{text}',
          }),
          schema: z.toJSONSchema(this.#schema),
          settings,
        }),
      )
      .digest('hex')}`;
  }

  override async compute(
    pages: readonly Page[],
    signal?: AbortSignal,
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return Promise.all(pages.map((page) => this.#extract(page, signal)));
  }

  async #extract(
    page: Page,
    signal: AbortSignal | undefined,
  ): Promise<RuleResult<Readonly<Record<string, string>>>> {
    let answer;
    try {
      ({ output: answer } = await generateText({
        model,
        instructions: system,
        prompt: prompt(this.#instruction(), page),
        output: Output.object({ schema: this.#schema }),
        ...settings,
        abortSignal: signal,
      }));
    } catch (error) {
      return pageFailure(error);
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
