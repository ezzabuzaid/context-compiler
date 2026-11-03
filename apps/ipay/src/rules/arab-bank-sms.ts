import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// What Arab Bank texts its customers about each movement of their accounts,
// read from the templates of its texts from 2019 to 2026. The third reader of
// these texts, after apps/proactive's spend rules in elt; one parser for the
// three is backlog #3668.

// What reads the texts: this module's own code, so a change to how a text is
// read makes every movement again.
export const parser = `arab-bank-sms:${createHash('sha256')
  .update(readFileSync(import.meta.filename))
  .digest('hex')}`;

// The names Messages gives the bank's texts: Arab Bank, and ArabBank until
// March 2024.
export const bankSenders = ['Arab Bank', 'ArabBank'];

type Movement = {
  readonly kind:
    | 'purchase'
    | 'withdrawal'
    | 'cliq'
    | 'bill'
    | 'card_payment'
    | 'card_credit'
    | 'transfer_out'
    | 'transfer_in'
    | 'salary'
    | 'deposit'
    | 'reversal';
  readonly direction: 'debit' | 'credit';
  // Who the money went to or came from, as the text names them: a merchant,
  // a branch or ATM, a CliQ recipient or an account; absent when it names
  // none.
  readonly counterparty?: string;
  // The amount as the bank writes it, without thousands separators.
  readonly amount: string;
  readonly currency: string;
  // The day the bank books it on, on the bank's clock: the date the text
  // states, else the day it was sent.
  readonly bookedOn: string;
};

const zone = 'Asia/Amman';
const number = String.raw`\d[\d,]*(?:\.\d+)?`;
// An amount with its currency on either side, with or without a space, as in
// "JOD 0.731", "JOD3.749", "900 JOD" and "88.000JOD".
const money = new RegExp(
  String.raw`(?:(?<before>[A-Z]{3})\s*(?<first>${number})|(?<second>${number})\s*(?<after>[A-Z]{3}))`,
  'u',
);
const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

type Template = {
  readonly kind: Movement['kind'];
  readonly direction: Movement['direction'];
  // Matches the text; its amount group holds the amount and its currency, and
  // counterparty, when present, who the money went to or came from.
  readonly pattern: RegExp;
  // The currency of a template whose amount states none.
  readonly currency?: string;
};

const amount = String.raw`(?<amount>(?:[A-Z]{3}\s*)?${number}(?:\s*[A-Z]{3})?)`;
const templates: readonly Template[] = [
  {
    kind: 'purchase',
    direction: 'debit',
    pattern: new RegExp(
      String.raw`حركة شراء من حسابكم\s+\S+\s+من\s+(?<counterparty>.+?)\s+بمبلغ\s+${amount}`,
      'u',
    ),
  },
  {
    kind: 'purchase',
    direction: 'debit',
    pattern: new RegExp(
      String.raw`Trx (?:using|on your) Card(?: no\.)?\s+\S+\s+from\s+(?<counterparty>.+?)\s+for\s+${amount}\s+on\s`,
      'u',
    ),
  },
  {
    kind: 'purchase',
    direction: 'debit',
    pattern: new RegExp(
      String.raw`(?:^|\s)شراء بمبلغ\s+${amount}\s+من حساب`,
      'u',
    ),
  },
  {
    kind: 'withdrawal',
    direction: 'debit',
    pattern: new RegExp(
      String.raw`حركة سحب بمبلغ\s+${amount}\s+من حسابكم?\s+\S+(?:\s+لدى\s+(?<counterparty>.+?))?\s+بتاريخ`,
      'u',
    ),
  },
  {
    kind: 'withdrawal',
    direction: 'debit',
    // The bank's texts until 2020, which start with the amount.
    pattern: new RegExp(
      String.raw`(?:^|\s)(?<amount>${number})\s+سحب صراف`,
      'u',
    ),
    currency: 'JOD',
  },
  {
    kind: 'cliq',
    direction: 'debit',
    pattern: new RegExp(
      String.raw`دفعة كليك بمبلغ\s+${amount}(?:\s+من حساب\s+\S+(?:\s+إلى\s+(?<counterparty>.+?)\s+الرصيد)?)?`,
      'u',
    ),
  },
  // A CliQ payment that came in.
  {
    kind: 'cliq',
    direction: 'credit',
    pattern: new RegExp(String.raw`دفعة كليك\s+${amount}\s+لحساب`, 'u'),
  },
  {
    kind: 'bill',
    direction: 'debit',
    pattern: new RegExp(
      String.raw`دفع فاتورة(?:\s+(?<counterparty>\S+)\s+رقم\s+\S+)?\s+بمبلغ\s+${amount}`,
      'u',
    ),
  },
  {
    kind: 'card_payment',
    direction: 'debit',
    pattern: new RegExp(String.raw`دفع لبطاقة ائتمان بمبلغ\s+${amount}`, 'u'),
  },
  {
    kind: 'transfer_out',
    direction: 'debit',
    pattern: new RegExp(
      String.raw`قيدت حوالة بمبلغ\s+${amount}\s+من حساب\s+[^\s.]+(?:\s*لحساب\s+(?<counterparty>[^\s.]+))?`,
      'u',
    ),
  },
  {
    kind: 'transfer_in',
    direction: 'credit',
    pattern: new RegExp(String.raw`قيد حوالة بمبلغ\s+${amount}\s+لحساب`, 'u'),
  },
  {
    kind: 'transfer_in',
    direction: 'credit',
    pattern: new RegExp(
      String.raw`(?<amount>[A-Z]{3}\s*${number})\s+قيد لحساب`,
      'u',
    ),
  },
  {
    kind: 'salary',
    direction: 'credit',
    pattern: new RegExp(String.raw`قيد راتب بمبلغ\s+${amount}\s+لحساب`, 'u'),
  },
  {
    kind: 'deposit',
    direction: 'credit',
    pattern: new RegExp(String.raw`إيداع فوري لمبلغ\s+${amount}\s+لحساب`, 'u'),
  },
  // A card purchase the merchant took back.
  {
    kind: 'reversal',
    direction: 'credit',
    pattern: new RegExp(
      String.raw`(?:Reversal of Trx on Card|credit trx on your Card(?: no\.)?)\s+\S+\s+from\s+(?<counterparty>.+?)\s+for\s+${amount}\s+on\s`,
      'u',
    ),
  },
  // The credit card's side of a card_payment.
  {
    kind: 'card_credit',
    direction: 'credit',
    pattern: new RegExp(
      String.raw`(?<amount>[A-Z]{3}\s*${number}) has been credited to your card account`,
      'u',
    ),
  },
];

// The day a text states, as dd/mm/yyyy, dd/mm or dd-Mon-yyyy. A day without
// its year is the latest such day on or before the day the text was sent.
function statedDay(
  text: string,
  sent: Temporal.PlainDate,
): Temporal.PlainDate | null {
  const arabic = /بتاريخ\s+(\d{2})\/(\d{2})(?:\/(\d{4}))?/u.exec(text);
  if (arabic !== null) {
    const [, day, month, year] = arabic;
    const stated = Temporal.PlainDate.from({
      year: year === undefined ? sent.year : Number(year),
      month: Number(month),
      day: Number(day),
    });
    return year === undefined && Temporal.PlainDate.compare(stated, sent) > 0
      ? stated.subtract({ years: 1 })
      : stated;
  }
  const english = /\son\s+(\d{2})-([A-Z][a-z]{2})-(\d{4})/u.exec(text);
  if (english !== null) {
    const [, day, month, year] = english;
    const index = months.indexOf(month!);
    if (index !== -1)
      return Temporal.PlainDate.from({
        year: Number(year),
        month: index + 1,
        day: Number(day),
      });
  }
  return null;
}

// The movement a text tells of, or null for every other text: a one-time
// password, a purchase the bank refused, an offer.
export function movement(text: string, sentAt: string): Movement | null {
  for (const { kind, direction, pattern, currency } of templates) {
    const matched = pattern.exec(text);
    if (matched?.groups?.amount === undefined) continue;
    const stated =
      currency === undefined ? money.exec(matched.groups.amount) : null;
    const { before, first, second, after } = stated?.groups ?? {};
    const value =
      currency === undefined ? (first ?? second) : matched.groups.amount;
    const unit = currency ?? before ?? after;
    if (value === undefined || unit === undefined) continue;
    const sent = Temporal.Instant.from(sentAt)
      .toZonedDateTimeISO(zone)
      .toPlainDate();
    const counterparty = matched.groups.counterparty
      ?.replace(/\s+/gu, ' ')
      .trim();
    return {
      kind,
      direction,
      ...(counterparty ? { counterparty } : {}),
      amount: value.replaceAll(',', ''),
      currency: unit,
      bookedOn: (statedDay(text, sent) ?? sent).toString(),
    };
  }
  return null;
}
