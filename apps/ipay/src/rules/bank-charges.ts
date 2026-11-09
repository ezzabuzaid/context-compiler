import { type LoadedRow, Rule, type RuleResult } from '@eltjs/elt';

import { movement, parser } from './arab-bank-sms.ts';

type Text = { readonly text: string; readonly sentAt: string };

// The movement of the user's money that each of the bank's texts tells of.
export class BankCharges extends Rule<Text, string> {
  override readonly key = {
    name: 'guid',
    description: 'The GUID of the bank text the movement is read from.',
  };
  override readonly output = {
    kind: {
      type: 'text',
      description:
        'purchase (a card purchase), withdrawal (cash), cliq (a CliQ payment), bill (a bill payment), card_payment (a payment to a credit card), transfer_out or transfer_in. NULL unless status is computed.',
    },
    direction: {
      type: 'text',
      description:
        'debit when money left the account, credit when it came in. NULL unless status is computed.',
    },
    counterparty: {
      type: 'text',
      description:
        'The merchant, branch, CliQ recipient or account the text names; NULL when it names none.',
    },
    amount: {
      type: 'text',
      description:
        'The amount as the bank writes it, as a decimal number. NULL unless status is computed.',
    },
    currency: {
      type: 'text',
      description:
        'The ISO 4217 code of the amount, such as JOD, or AED for a purchase abroad. NULL unless status is computed.',
    },
    booked_on: {
      type: 'text',
      description:
        'The day the bank books the movement on, on the bank’s clock (Asia/Amman): the date the text states, else the day it was sent. NULL unless status is computed.',
    },
  } as const;
  // Reading a text takes microseconds: one call takes many.
  override readonly batch = 500;
  override readonly concurrency = 1;

  override read(
    row: LoadedRow,
  ): { readonly key: string; readonly input: Text } | null {
    const { guid, text, date } = row;
    return typeof guid === 'string' &&
      typeof text === 'string' &&
      typeof date === 'string'
      ? { key: guid, input: { text, sentAt: date } }
      : null;
  }

  override async identity(): Promise<string> {
    return parser;
  }

  override async compute(
    texts: readonly Text[],
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return texts.map(({ text, sentAt }) => {
      const found = movement(text, sentAt);
      if (found === null) return { empty: true };
      const { bookedOn, ...rest } = found;
      return { value: { ...rest, booked_on: bookedOn } };
    });
  }
}
