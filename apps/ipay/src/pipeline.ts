import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Connection, Copy, Pipeline } from '@workspace/elt';
import {
  ComputedDataset,
  SQLiteCheckpointStore,
  SQLiteDestination,
  SQLiteSyncHistory,
  View,
} from '@workspace/elt-sqlite';

import { contextCompiler, importPaths } from './imports.ts';
import { BankCharges } from './rules/bank-charges.ts';
import { InvoicePayments } from './rules/invoice-payments.ts';
import { ImportsSource } from './source/imports-source.ts';

const directory = join(contextCompiler, 'ipay');
mkdirSync(directory, { recursive: true });

const destination = new SQLiteDestination({
  path: join(directory, 'ipay.sqlite'),
});
const source = new ImportsSource(importPaths());
const invoiceEmails = destination.table('invoice_emails');
const bankMessages = destination.table('bank_messages');

const invoicePayments = new ComputedDataset({
  into: destination,
  name: 'invoice_payments',
  description:
    'The payments that each candidate email confirms, as GPT-6-Luna reads them; empty for an email that confirms none. Primary key id.',
  from: [invoiceEmails],
  compute: new InvoicePayments(),
});
const bankCharges = new ComputedDataset({
  into: destination,
  name: 'bank_charges',
  description:
    "The movement of money that each of the bank's texts tells of; empty for a text that tells of none, such as a one-time password. Primary key guid.",
  from: [bankMessages],
  compute: new BankCharges(),
});
const payments = new View({
  into: destination,
  name: 'payments',
  description:
    'One row for each payment an email confirms, with the email it is read from.',
  columns: {
    email_id: 'The identifier of the email in invoice_emails.',
    received_at: 'When Mail received the email, as a UTC timestamp.',
    sender: "The email's sender.",
    subject: "The email's subject.",
    company: 'The company that charged the user.',
    service: 'The product or plan the payment is for.',
    category: 'What the payment is for, such as food or cloud_services.',
    amount: 'The amount paid, as a number.',
    currency: 'The ISO 4217 code of the amount.',
    frequency: 'once, monthly or annually.',
    quote: 'The line of the email that states the payment.',
  },
  sql: `SELECT e.id AS email_id, e.received_at, e.sender, e.subject,
      json_extract(j.value, '$.company') AS company, json_extract(j.value, '$.service') AS service,
      json_extract(j.value, '$.category') AS category, json_extract(j.value, '$.amount') AS amount,
      json_extract(j.value, '$.currency') AS currency, json_extract(j.value, '$.frequency') AS frequency,
      json_extract(j.value, '$.quote') AS quote
    FROM invoice_payments p JOIN invoice_emails e ON e.id = p.id, json_each(p.payments) j
    WHERE p.status = 'computed'`,
});
const monthlyPayments = new View({
  into: destination,
  name: 'monthly_payments',
  description:
    'What the emails confirm the user paid in each month, by currency and category.',
  columns: {
    month: 'The month Mail received the emails in, as YYYY-MM in UTC.',
    currency: 'The ISO 4217 code of the amounts.',
    category: 'What the payments are for.',
    total: 'The sum of the amounts.',
    payments: 'How many payments.',
  },
  sql: 'SELECT substr(received_at, 1, 7) AS month, currency, category, sum(amount) AS total, count(*) AS payments FROM payments GROUP BY 1, 2, 3',
});
const monthlyCharges = new View({
  into: destination,
  name: 'monthly_charges',
  description:
    "What left the user's account in each month by the bank's texts, by kind and currency.",
  columns: {
    month: 'The month the bank booked the movements in, as YYYY-MM.',
    kind: 'purchase, withdrawal, cliq, bill, card_payment or transfer_out.',
    currency: 'The ISO 4217 code of the amounts.',
    total: 'The sum of the amounts.',
    movements: 'How many movements.',
  },
  sql: "SELECT substr(booked_on, 1, 7) AS month, kind, currency, sum(CAST(amount AS REAL)) AS total, count(*) AS movements FROM bank_charges WHERE status = 'computed' AND direction = 'debit' GROUP BY 1, 2, 3",
});

export default new Pipeline({
  clock: globalThis,
  // One process runs the passes, so a pass left running belongs to one that
  // stopped.
  history: new SQLiteSyncHistory({ soleWriter: true }),
  connections: [
    new Connection({
      name: 'imports',
      source,
      destination,
      checkpoints: new SQLiteCheckpointStore({
        path: join(directory, 'checkpoints.sqlite'),
      }),
      steps: [
        new Copy(source.invoiceEmails, invoiceEmails, {
          id: 'imports:invoice_emails',
          syncMode: 'incremental',
          destinationSyncMode: 'append_dedup',
        }),
        new Copy(source.bankMessages, bankMessages, {
          id: 'imports:bank_messages',
          syncMode: 'incremental',
          destinationSyncMode: 'append_dedup',
        }),
      ],
    }),
  ],
  derived: [
    invoicePayments,
    bankCharges,
    payments,
    monthlyPayments,
    monthlyCharges,
  ],
});
