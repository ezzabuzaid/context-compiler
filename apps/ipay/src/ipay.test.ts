import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { hash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import type { SQLOutputValue } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { RollbackJournal, open } from '@zukhruf/sqlite-open';
import { TemporaryFiles } from '@zukhruf/testing/fs';
import { z } from 'zod';

import { Pipeline } from '@eltjs/elt';
import { SQLiteSyncHistory } from '@eltjs/elt-sqlite';
import { MacOSDocumentParser } from '@eltjs/source-apple-macos/macos-document-parser';
import MailConnector from '@workspace/connector-apple-mail';
import MessagesConnector from '@workspace/connector-apple-messages';
import { Settings } from '@workspace/settings';

// Where Context Compiler keeps its settings, imports and ipay's files under
// a home folder.
const contextCompiler = (home: string) =>
  join(home, 'Library/Application Support/Context Compiler');
const ipayDatabase = (home: string) =>
  join(contextCompiler(home), 'ipay/ipay.sqlite');

// An email as Mail keeps it: its plain text, its HTML, or both, and the text
// of a PDF invoice it attaches.
type Mail = {
  readonly id: number;
  readonly from: string;
  readonly subject: string;
  readonly received: string;
  readonly text?: string;
  readonly html?: string;
  readonly pdf?: string;
};

// A text as Messages keeps one: from the bank's sender ID or from a person.
type Text = {
  readonly guid: string;
  readonly from: 'Arab Bank' | 'Friend';
  readonly text: string;
  readonly sent: string;
};

// Mail's store on macOS 27, copied from the Mail connector's own preset test
// (packages/connectors/mail/src/mail-presets.test.ts).
const envelopeIndexSchema = `CREATE TABLE messages (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
message_id INTEGER NOT NULL DEFAULT 0,
global_message_id INTEGER NOT NULL,
remote_id INTEGER,
document_id TEXT COLLATE BINARY,
sender INTEGER,
subject_prefix TEXT COLLATE BINARY,
subject INTEGER NOT NULL,
summary INTEGER,
date_sent INTEGER,
date_received INTEGER,
mailbox INTEGER NOT NULL,
remote_mailbox INTEGER,
flags INTEGER NOT NULL DEFAULT 0,
read INTEGER NOT NULL DEFAULT 0,
flagged INTEGER NOT NULL DEFAULT 0,
deleted INTEGER NOT NULL DEFAULT 0,
size INTEGER NOT NULL DEFAULT 0,
conversation_id INTEGER NOT NULL DEFAULT 0,
date_last_viewed INTEGER,
list_id_hash INTEGER,
unsubscribe_type INTEGER,
searchable_message INTEGER,
brand_indicator INTEGER,
display_date INTEGER,
flag_color INTEGER,
color TEXT COLLATE BINARY,
type INTEGER,
fuzzy_ancestor INTEGER,
automated_conversation INTEGER DEFAULT 0,
root_status INTEGER DEFAULT -1, is_urgent INTEGER NOT NULL DEFAULT 0);
CREATE TABLE mailboxes (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
url TEXT COLLATE BINARY NOT NULL,
total_count INTEGER NOT NULL DEFAULT 0,
unread_count INTEGER NOT NULL DEFAULT 0,
deleted_count INTEGER NOT NULL DEFAULT 0,
unseen_count INTEGER NOT NULL DEFAULT 0,
unread_count_adjusted_for_duplicates INTEGER NOT NULL DEFAULT 0,
change_identifier TEXT COLLATE BINARY,
source INTEGER,
alleged_change_identifier TEXT COLLATE BINARY,
UNIQUE(url) ON CONFLICT ABORT);
CREATE TABLE addresses (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
address TEXT COLLATE NOCASE NOT NULL,
comment TEXT COLLATE BINARY NOT NULL,
UNIQUE(address, comment) ON CONFLICT ABORT);
CREATE TABLE recipients (ROWID INTEGER PRIMARY KEY,
message INTEGER NOT NULL,
address INTEGER NOT NULL,
type INTEGER,
position INTEGER,
UNIQUE(message, type, position) ON CONFLICT ABORT);
CREATE TABLE attachments (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
message INTEGER NOT NULL REFERENCES messages(ROWID) ON DELETE CASCADE,
attachment_id TEXT COLLATE BINARY,
name TEXT COLLATE BINARY,
UNIQUE(message, attachment_id) ON CONFLICT ABORT);
CREATE TABLE labels (message_id INTEGER REFERENCES messages(ROWID) ON DELETE CASCADE, mailbox_id INTEGER REFERENCES mailboxes(ROWID) ON DELETE CASCADE, PRIMARY KEY(message_id, mailbox_id)) WITHOUT ROWID;
CREATE TABLE server_messages (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
message INTEGER REFERENCES messages(ROWID) ON DELETE SET NULL,
mailbox INTEGER NOT NULL REFERENCES mailboxes(ROWID) ON DELETE CASCADE,
sequence_identifier INTEGER,
read INTEGER NOT NULL,
deleted INTEGER NOT NULL,
replied INTEGER NOT NULL,
flagged INTEGER NOT NULL,
draft INTEGER NOT NULL,
forwarded INTEGER NOT NULL,
redirected INTEGER NOT NULL,
junk_level_set_by_user INTEGER NOT NULL,
junk_level INTEGER NOT NULL,
flag_color INTEGER NOT NULL,
remote_id INTEGER NOT NULL,
UNIQUE(mailbox, remote_id) ON CONFLICT ABORT);
CREATE TABLE server_labels (server_message INTEGER REFERENCES server_messages(ROWID) ON DELETE CASCADE,
label INTEGER REFERENCES mailboxes(ROWID) ON DELETE CASCADE,
PRIMARY KEY(server_message, label)) WITHOUT ROWID;
CREATE TABLE conversations (conversation_id INTEGER PRIMARY KEY AUTOINCREMENT,
flags INTEGER NOT NULL DEFAULT 0,
sync_key TEXT COLLATE BINARY);
CREATE TABLE conversation_id_message_id (conversation_id INTEGER NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE ON UPDATE CASCADE,
message_id INTEGER NOT NULL DEFAULT 0,
date_sent INTEGER NOT NULL DEFAULT 0,
PRIMARY KEY(conversation_id, message_id)) WITHOUT ROWID;
CREATE TABLE message_references (ROWID INTEGER PRIMARY KEY,
message INTEGER NOT NULL REFERENCES messages(ROWID) ON DELETE CASCADE,
reference INTEGER NOT NULL DEFAULT 0,
is_originator INTEGER NOT NULL DEFAULT 0);
CREATE TABLE message_global_data (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
message_id INTEGER,
follow_up_start_date INTEGER,
follow_up_end_date INTEGER,
follow_up_jsonstringformodelevaluationforsuggestions TEXT COLLATE BINARY,
read_later_date INTEGER,
send_later_date INTEGER,
validation_state INTEGER NOT NULL DEFAULT 0,
model_category INTEGER,
model_subcategory INTEGER,
category_model_version INTEGER,
category_is_temporary INTEGER,
model_analytics TEXT COLLATE BINARY,
model_high_impact INTEGER NOT NULL DEFAULT 0,
generated_summary INTEGER,
urgent INTEGER, message_id_header TEXT COLLATE BINARY, due_by INTEGER,
UNIQUE(message_id) ON CONFLICT ABORT);
CREATE TABLE subjects (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
subject TEXT COLLATE RTRIM NOT NULL,
UNIQUE(subject) ON CONFLICT ABORT);
CREATE TABLE summaries (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
summary TEXT COLLATE RTRIM NOT NULL,
UNIQUE(summary) ON CONFLICT ABORT);
CREATE TABLE generated_summaries (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
summary BLOB NOT NULL,
status INTEGER NOT NULL DEFAULT 0);
CREATE TABLE message_metadata (message_id INTEGER PRIMARY KEY,
timestamp INTEGER NOT NULL,
json_values TEXT COLLATE BINARY NOT NULL);
CREATE TABLE data_detection_results (ROWID INTEGER PRIMARY KEY,
global_message_id INTEGER NOT NULL,
category TEXT COLLATE BINARY NOT NULL,
value TEXT COLLATE BINARY NOT NULL,
UNIQUE(global_message_id, category, value) ON CONFLICT ABORT);
CREATE TABLE rich_links (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT COLLATE BINARY,
url TEXT COLLATE BINARY NOT NULL,
hash TEXT COLLATE BINARY NOT NULL,
UNIQUE(hash) ON CONFLICT ABORT);
CREATE TABLE message_rich_links (global_message_id INTEGER NOT NULL REFERENCES message_global_data(ROWID) ON DELETE CASCADE,
rich_link INTEGER NOT NULL REFERENCES rich_links(ROWID) ON DELETE CASCADE,
PRIMARY KEY(global_message_id, rich_link)) WITHOUT ROWID;
CREATE TABLE protected_message_data (ROWID INTEGER PRIMARY KEY,
data TEXT COLLATE BINARY);
CREATE TABLE brand_indicators (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
url TEXT COLLATE BINARY NOT NULL,
indicator BLOB,
indicator_hash TEXT COLLATE BINARY,
hash_algorithm TEXT COLLATE BINARY,
UNIQUE(url) ON CONFLICT ABORT);
CREATE TABLE brand_indicator_evidence (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
brand_indicator INTEGER NOT NULL REFERENCES brand_indicators(ROWID) ON DELETE CASCADE ON UPDATE CASCADE,
url TEXT COLLATE BINARY NOT NULL,
evidence BLOB,
unverified_messages TEXT COLLATE BINARY,
UNIQUE(brand_indicator, url) ON CONFLICT ABORT);
CREATE TABLE address_metadata (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
address TEXT COLLATE NOCASE NOT NULL,
smime_capabilities TEXT COLLATE NOCASE NOT NULL,
smime_capabilities_date INTEGER NOT NULL,
UNIQUE(address) ON CONFLICT ABORT);
CREATE TABLE businesses (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
address_comment TEXT COLLATE NOCASE,
domain TEXT COLLATE NOCASE,
brand_id INTEGER,
localized_brand_name TEXT,
UNIQUE(address_comment, domain) ON CONFLICT ABORT,
UNIQUE(brand_id) ON CONFLICT ABORT,
CHECK(((address_comment IS NOT NULL AND domain IS NOT NULL AND brand_id IS NULL AND localized_brand_name IS NULL) OR (address_comment IS NULL AND domain IS NULL AND brand_id IS NOT NULL AND localized_brand_name IS NOT NULL))));
CREATE TABLE business_addresses (ROWID INTEGER PRIMARY KEY,
address INTEGER NOT NULL,
business INTEGER NOT NULL,
category INTEGER,
last_modified INTEGER,
last_bcs_sync INTEGER,
UNIQUE(address) ON CONFLICT ABORT);
CREATE TABLE business_categories (ROWID INTEGER PRIMARY KEY,
business INTEGER NOT NULL,
category INTEGER NOT NULL,
UNIQUE(business) ON CONFLICT ABORT);
CREATE TABLE senders (ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
contact_identifier TEXT COLLATE BINARY,
bucket INTEGER NOT NULL DEFAULT 0,
user_initiated INTEGER NOT NULL DEFAULT 1,
UNIQUE(contact_identifier) ON CONFLICT ABORT);
CREATE TABLE sender_addresses (address INTEGER PRIMARY KEY,
sender INTEGER NOT NULL REFERENCES senders(ROWID) ON DELETE CASCADE);
CREATE TABLE events (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL REFERENCES messages(ROWID) ON DELETE CASCADE, start_date INTEGER, end_date INTEGER, location TEXT, out_of_date INTEGER DEFAULT 0, processed INTEGER DEFAULT 0, is_all_day INTEGER DEFAULT 0, associated_id_string TEXT, original_receiving_account TEXT, ical_uid TEXT, is_response_requested INTEGER DEFAULT 0);`;

const plist = (value: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0">${value}</plist>`;

// A message file as Mail keeps one: the MIME's byte length, the MIME, then
// Mail's own property list.
const emlx = (lines: readonly string[]) => {
  const mime = lines.join('\r\n');
  return `${Buffer.byteLength(mime)}      \n${mime}${plist('<dict><key>flags</key><integer>1</integer></dict>')}`;
};

// A one-page PDF whose text layer holds the given line, as an invoice
// generator writes one.
function textPdf(text: string): Buffer {
  const content = `BT /F1 14 Tf 20 100 Td (${text.replace(/[\\()]/gu, (character) => `\\${character}`)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// The MIME of an email: one part for its text or HTML, or a mixed message
// with a PDF attachment.
function mime({ from, subject, text, html, pdf }: Mail): string[] {
  const headers = [`From: ${from}`, `Subject: ${subject}`];
  const part = (type: string, body: string) => [
    `Content-Type: ${type}; charset=UTF-8`,
    '',
    body,
  ];
  const body =
    text !== undefined ? part('text/plain', text) : part('text/html', html!);
  if (pdf === undefined) return [...headers, ...body];
  return [
    ...headers,
    'Content-Type: multipart/mixed; boundary="m"',
    '',
    '--m',
    ...body,
    '--m',
    'Content-Type: application/pdf; name="invoice.pdf"',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    textPdf(pdf).toString('base64'),
    '--m--',
    '',
  ];
}

// Mail's store under the home as Mail leaves it holding these emails: its
// account, its Envelope Index and a message file for each email. Writing it
// again is Mail's store at a later moment.
function mailStore(home: string, mails: readonly Mail[]) {
  const root = join(home, 'Library/Mail');
  const mailbox = join(root, 'V10/ACCOUNT/Inbox.mbox');
  const messages = join(mailbox, 'UUID/Data/Messages');
  const accounts = join(home, 'Library/Accounts/Accounts4.sqlite');
  if (!existsSync(accounts)) {
    mkdirSync(dirname(accounts), { recursive: true });
    using database = open(accounts, { journal: new RollbackJournal() });
    database.exec(`
      CREATE TABLE ZACCOUNT ( Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER, ZACTIVE INTEGER, ZAUTHENTICATED INTEGER, ZSUPPORTSAUTHENTICATION INTEGER, ZVISIBLE INTEGER, ZWARMINGUP INTEGER, ZACCOUNTTYPE INTEGER, ZPARENTACCOUNT INTEGER, ZDATE TIMESTAMP, ZLASTCREDENTIALRENEWALREJECTIONDATE TIMESTAMP, ZACCOUNTDESCRIPTION VARCHAR, ZAUTHENTICATIONTYPE VARCHAR, ZCREDENTIALTYPE VARCHAR, ZIDENTIFIER VARCHAR, ZMODIFICATIONID VARCHAR, ZOWNINGBUNDLEID VARCHAR, ZUSERNAME VARCHAR, ZDATACLASSPROPERTIES BLOB );
      CREATE TABLE Z_2ENABLEDDATACLASSES ( Z_2ENABLEDACCOUNTS INTEGER, Z_7ENABLEDDATACLASSES INTEGER, PRIMARY KEY (Z_2ENABLEDACCOUNTS, Z_7ENABLEDDATACLASSES) );
      CREATE TABLE Z_2PROVISIONEDDATACLASSES ( Z_2PROVISIONEDACCOUNTS INTEGER, Z_7PROVISIONEDDATACLASSES INTEGER, PRIMARY KEY (Z_2PROVISIONEDACCOUNTS, Z_7PROVISIONEDDATACLASSES) );
      CREATE TABLE ZACCOUNTPROPERTY ( Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER, ZOWNER INTEGER, ZKEY VARCHAR, ZVALUE BLOB );
      CREATE TABLE ZACCOUNTTYPE ( Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER, ZOBSOLETE INTEGER, ZSUPPORTSAUTHENTICATION INTEGER, ZSUPPORTSMULTIPLEACCOUNTS INTEGER, ZVISIBILITY INTEGER, ZACCOUNTTYPEDESCRIPTION VARCHAR, ZCREDENTIALPROTECTIONPOLICY VARCHAR, ZCREDENTIALTYPE VARCHAR, ZIDENTIFIER VARCHAR, ZOWNINGBUNDLEID VARCHAR );
      CREATE TABLE ZDATACLASS ( Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER, ZNAME BLOB , ZENUMVALUE INTEGER);
      INSERT INTO ZACCOUNTTYPE (Z_PK, ZIDENTIFIER) VALUES (1, 'com.apple.account.IMAP');
      INSERT INTO ZACCOUNT (Z_PK, ZACTIVE, ZACCOUNTTYPE, ZACCOUNTDESCRIPTION, ZIDENTIFIER, ZUSERNAME) VALUES (1, 1, 1, 'Personal', 'ACCOUNT', 'me@example.com');
    `);
  }
  rmSync(messages, { recursive: true, force: true });
  mkdirSync(messages, { recursive: true });
  mkdirSync(join(root, 'V10/MailData'), { recursive: true });
  writeFileSync(
    join(root, 'PersistenceInfo.plist'),
    plist(
      '<dict><key>LastUsedVersionDirectoryName</key><string>V10</string></dict>',
    ),
  );
  writeFileSync(
    join(mailbox, 'Info.plist'),
    plist('<dict><key>MailboxID</key><string>INBOX</string></dict>'),
  );
  for (const mail of mails)
    writeFileSync(join(messages, `${mail.id}.emlx`), emlx(mime(mail)));
  const path = join(root, 'V10/MailData/Envelope Index');
  const created = !existsSync(path);
  using index = open(path);
  if (created) {
    index.exec(envelopeIndexSchema);
    index.exec(
      "INSERT INTO mailboxes(ROWID, url) VALUES (1, 'imap://ACCOUNT/INBOX')",
    );
  }
  index.exec(
    'DELETE FROM messages; DELETE FROM message_global_data; DELETE FROM subjects; DELETE FROM addresses;',
  );
  for (const { id, from, subject, received } of mails) {
    const seconds = Date.parse(received) / 1000;
    // Mail keeps one row for each address and name.
    const address = from.replace(/^.*<|>$/gu, '');
    index
      .prepare(
        "INSERT INTO addresses (address, comment) VALUES (?, '') ON CONFLICT DO NOTHING",
      )
      .run(address);
    const sender = Number(
      index
        .prepare(
          "SELECT ROWID AS id FROM addresses WHERE address = ? AND comment = ''",
        )
        .get(address)!.id,
    );
    index.prepare('INSERT INTO subjects VALUES (?, ?)').run(id, subject);
    index
      .prepare(
        'INSERT INTO message_global_data(ROWID, message_id, message_id_header) VALUES (?, ?, ?)',
      )
      .run(100 + id, id, `<${id}@example.com>`);
    index
      .prepare(
        'INSERT INTO messages(ROWID, message_id, global_message_id, subject, subject_prefix, mailbox, sender, date_sent, date_received, read, flagged, conversation_id) VALUES (?, ?, ?, ?, NULL, 1, ?, ?, ?, 0, 0, ?)',
      )
      .run(id, id, 100 + id, id, sender, seconds, seconds, id);
  }
}

// Messages' own table definitions, copied from the Messages source's test
// (../elt/packages/sources/apple/messages/src/messages-source.test.ts).
const chatSchema = `
  CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, style INTEGER, state INTEGER, account_id TEXT, properties BLOB, chat_identifier TEXT, service_name TEXT, room_name TEXT, account_login TEXT, is_archived INTEGER DEFAULT 0, last_addressed_handle TEXT, display_name TEXT, group_id TEXT, is_filtered INTEGER DEFAULT 0, successful_query INTEGER, engram_id TEXT, server_change_token TEXT, ck_sync_state INTEGER DEFAULT 0, original_group_id TEXT, last_read_message_timestamp INTEGER DEFAULT 0, cloudkit_record_id TEXT, last_addressed_sim_id TEXT, is_blackholed INTEGER DEFAULT 0, syndication_date INTEGER DEFAULT 0, syndication_type INTEGER DEFAULT 0, is_recovered INTEGER DEFAULT 0, is_deleting_incoming_messages INTEGER DEFAULT 0, is_pending_review INTEGER DEFAULT 0);
  CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, id TEXT NOT NULL, country TEXT, service TEXT NOT NULL, uncanonicalized_id TEXT, person_centric_id TEXT, UNIQUE (id, service) );
  CREATE TABLE message (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT, replace INTEGER DEFAULT 0, service_center TEXT, handle_id INTEGER DEFAULT 0, subject TEXT, country TEXT, attributedBody BLOB, version INTEGER DEFAULT 0, type INTEGER DEFAULT 0, service TEXT, account TEXT, account_guid TEXT, error INTEGER DEFAULT 0, date INTEGER, date_read INTEGER, date_delivered INTEGER, is_delivered INTEGER DEFAULT 0, is_finished INTEGER DEFAULT 0, is_emote INTEGER DEFAULT 0, is_from_me INTEGER DEFAULT 0, is_empty INTEGER DEFAULT 0, is_delayed INTEGER DEFAULT 0, is_auto_reply INTEGER DEFAULT 0, is_prepared INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0, is_system_message INTEGER DEFAULT 0, is_sent INTEGER DEFAULT 0, has_dd_results INTEGER DEFAULT 0, is_service_message INTEGER DEFAULT 0, is_forward INTEGER DEFAULT 0, was_downgraded INTEGER DEFAULT 0, is_archive INTEGER DEFAULT 0, cache_has_attachments INTEGER DEFAULT 0, cache_roomnames TEXT, was_data_detected INTEGER DEFAULT 0, was_deduplicated INTEGER DEFAULT 0, is_audio_message INTEGER DEFAULT 0, is_played INTEGER DEFAULT 0, date_played INTEGER, item_type INTEGER DEFAULT 0, other_handle INTEGER DEFAULT 0, group_title TEXT, group_action_type INTEGER DEFAULT 0, share_status INTEGER DEFAULT 0, share_direction INTEGER DEFAULT 0, is_expirable INTEGER DEFAULT 0, expire_state INTEGER DEFAULT 0, message_action_type INTEGER DEFAULT 0, message_source INTEGER DEFAULT 0, associated_message_guid TEXT, associated_message_type INTEGER DEFAULT 0, balloon_bundle_id TEXT, payload_data BLOB, expressive_send_style_id TEXT, associated_message_range_location INTEGER DEFAULT 0, associated_message_range_length INTEGER DEFAULT 0, time_expressive_send_played INTEGER, message_summary_info BLOB, ck_sync_state INTEGER DEFAULT 0, ck_record_id TEXT, ck_record_change_tag TEXT, destination_caller_id TEXT, is_corrupt INTEGER DEFAULT 0, reply_to_guid TEXT, sort_id INTEGER, is_spam INTEGER DEFAULT 0, has_unseen_mention INTEGER DEFAULT 0, thread_originator_guid TEXT, thread_originator_part TEXT, syndication_ranges TEXT, synced_syndication_ranges TEXT, was_delivered_quietly INTEGER DEFAULT 0, did_notify_recipient INTEGER DEFAULT 0, date_retracted INTEGER, date_edited INTEGER, was_detonated INTEGER DEFAULT 0, part_count INTEGER, is_stewie INTEGER DEFAULT 0, is_sos INTEGER DEFAULT 0, is_critical INTEGER DEFAULT 0, bia_reference_id TEXT, is_kt_verified INTEGER DEFAULT 0, fallback_hash TEXT, associated_message_emoji TEXT, is_pending_satellite_send INTEGER DEFAULT 0, needs_relay INTEGER DEFAULT 0, schedule_type INTEGER DEFAULT 0, schedule_state INTEGER DEFAULT 0, sent_or_received_off_grid INTEGER DEFAULT 0, date_recovered INTEGER DEFAULT 0, is_time_sensitive INTEGER DEFAULT 0, ck_chat_id TEXT, index_state INTEGER DEFAULT 0, filter_action INTEGER DEFAULT 0, filter_sub_action INTEGER DEFAULT 0, is_preview_sent INTEGER DEFAULT 0, is_preview_delivered INTEGER DEFAULT 0, date_preview_sent INTEGER, date_preview_delivered INTEGER, date_updated INTEGER, retry_count INTEGER);
  CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, created_date INTEGER DEFAULT 0, start_date INTEGER DEFAULT 0, filename TEXT, uti TEXT, mime_type TEXT, transfer_state INTEGER DEFAULT 0, is_outgoing INTEGER DEFAULT 0, user_info BLOB, transfer_name TEXT, total_bytes INTEGER DEFAULT 0, is_sticker INTEGER DEFAULT 0, sticker_user_info BLOB, attribution_info BLOB, hide_attachment INTEGER DEFAULT 0, ck_sync_state INTEGER DEFAULT 0, ck_server_change_token_blob BLOB, ck_record_id TEXT, original_guid TEXT UNIQUE NOT NULL, is_commsafety_sensitive INTEGER DEFAULT 0, emoji_image_content_identifier TEXT, emoji_image_short_description TEXT, preview_generation_state INTEGER DEFAULT 0, preflight_info BLOB DEFAULT NULL, sensitivity_analysis INTEGER DEFAULT 0);
  CREATE TABLE chat_message_join (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE, message_id INTEGER REFERENCES message (ROWID) ON DELETE CASCADE, message_date INTEGER DEFAULT 0, index_state INTEGER NOT NULL DEFAULT 0, filter_action INTEGER NOT NULL DEFAULT 0, filter_sub_action INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (chat_id, message_id));
  CREATE TABLE chat_handle_join (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE, handle_id INTEGER REFERENCES handle (ROWID) ON DELETE CASCADE, UNIQUE(chat_id, handle_id));
  CREATE TABLE message_attachment_join (message_id INTEGER REFERENCES message (ROWID) ON DELETE CASCADE, attachment_id INTEGER REFERENCES attachment (ROWID) ON DELETE CASCADE, UNIQUE(message_id, attachment_id));
  CREATE TABLE chat_recoverable_message_join (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE, message_id INTEGER REFERENCES message (ROWID) ON DELETE CASCADE, delete_date INTEGER, ck_sync_state INTEGER DEFAULT 0, PRIMARY KEY (chat_id, message_id), CHECK (delete_date != 0));
  CREATE TABLE recoverable_message_part (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE, message_id INTEGER REFERENCES message (ROWID) ON DELETE CASCADE, part_index INTEGER, delete_date INTEGER, part_text BLOB NOT NULL, ck_sync_state INTEGER DEFAULT 0, PRIMARY KEY (chat_id, message_id, part_index), CHECK (delete_date != 0));
  CREATE TABLE chat_lookup (identifier TEXT NOT NULL, domain TEXT NOT NULL, chat INTEGER NOT NULL REFERENCES chat(ROWID) ON UPDATE CASCADE ON DELETE CASCADE, priority INTEGER DEFAULT 0, UNIQUE (identifier, domain));
  CREATE TABLE chat_service (service TEXT NOT NULL, chat INTEGER NOT NULL REFERENCES chat(ROWID) ON UPDATE CASCADE ON DELETE CASCADE, UNIQUE (service, chat));
`;

const appleNanoseconds = (iso: string) =>
  BigInt(Date.parse(iso) - Date.UTC(2001, 0, 1)) * 1_000_000n;

// Messages' store under the home holding these received texts, one chat for
// each sender. Writing it again is the store at a later moment.
function chatStore(home: string, texts: readonly Text[]) {
  const path = join(home, 'Library/Messages/chat.db');
  const created = !existsSync(path);
  mkdirSync(dirname(path), { recursive: true });
  using database = open(path);
  if (created) {
    database.exec(chatSchema);
    database.exec(`
      INSERT INTO handle VALUES (1, 'Arab Bank', 'jo', 'SMS', 'Arab Bank', NULL), (2, '+962790000000', 'jo', 'SMS', '0790000000', NULL);
      INSERT INTO chat (ROWID, guid, chat_identifier, service_name, display_name, style) VALUES
        (1, 'SMS;-;Arab Bank', 'Arab Bank', 'SMS', '', 45), (2, 'SMS;-;+962790000000', '+962790000000', 'SMS', '', 45);
      INSERT INTO chat_handle_join VALUES (1, 1), (2, 2);
    `);
  }
  database.exec('DELETE FROM chat_message_join; DELETE FROM message;');
  texts.forEach(({ guid, from, text, sent }, index) => {
    const handle = from === 'Arab Bank' ? 1 : 2;
    database
      .prepare(
        "INSERT INTO message (ROWID, guid, text, handle_id, is_from_me, date, service) VALUES (?, ?, ?, ?, 0, ?, 'SMS')",
      )
      .run(index + 1, guid, text, handle, appleNanoseconds(sent));
    database
      .prepare('INSERT INTO chat_message_join VALUES (?, ?, ?, 0, 0, 0)')
      .run(handle, index + 1, appleNanoseconds(sent));
  });
}

// A connector as Context Compiler builds one, reading the apps under home.
// A connector package's manifest, as Context Compiler reads it.
const manifestSchema = z.object({
  contextCompiler: z.object({ name: z.string(), title: z.string() }),
});

function connector(
  Connector: typeof MailConnector | typeof MessagesConnector,
  specifier: string,
  home: string,
) {
  const manifest = findPackageJSON(specifier, import.meta.url)!;
  const {
    contextCompiler: { name, title },
  } = manifestSchema.parse(JSON.parse(readFileSync(manifest, 'utf8')));
  return new Connector(
    {
      clock: globalThis,
      home,
      env: {},
      grantee: 'Codex',
      documentParser: new MacOSDocumentParser(),
      eventKitHelper: '',
    },
    { name, title, folder: dirname(manifest) },
  );
}

// What a Sync of Context Compiler does: the user sets up these connectors,
// and each one's import loads a pass of its app into its data.sqlite under
// Context Compiler's Imports folder. Mail copies its attachments when asked,
// so their text is read too.
async function contextCompilerSync(
  home: string,
  names: readonly ('mail' | 'messages')[],
  { includeAttachments = false } = {},
) {
  const connectors = new Map([
    ['mail', connector(MailConnector, '@workspace/connector-apple-mail', home)],
    [
      'messages',
      connector(MessagesConnector, '@workspace/connector-apple-messages', home),
    ],
  ]);
  const of = (name: string) => connectors.get(name)!;
  using settings = new Settings(join(contextCompiler(home), 'Imports'));
  const selections = names.map((name) => ({
    connector: name,
    scope: {},
    includeAttachments: name === 'mail' && includeAttachments,
  }));
  settings.select(selections, {
    facts: of,
    permissions: (selection) => of(selection.connector).guidance(),
  });
  for (const selection of selections) {
    const { connections, derived } = await of(selection.connector).connections(
      settings.directory(selection),
      selection,
    );
    // A copy that does not load fails the run with a PipelineError.
    await new Pipeline({
      clock: globalThis,
      connections,
      history: new SQLiteSyncHistory(),
      derived,
    }).run();
  }
}

// Every file under a folder, by its path in the folder, with the SHA-256 of
// its bytes. A -shm file is the wal-index of a write-ahead log, where every
// reader writes its read mark, so only its presence counts.
function files(folder: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry): [string, string] => {
        const path = join(entry.parentPath, entry.name);
        return [
          path.slice(folder.length + 1),
          path.endsWith('-shm')
            ? 'wal-index'
            : hash('sha256', readFileSync(path)),
        ];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

// A payment as the model states it in its answer.
type Payment = {
  readonly quote: string;
  readonly company: string;
  readonly service: string;
  readonly amount: number;
  readonly currency: string;
};

// One planned answer of the Codex Responses endpoint to one request about an
// email: the payments it states, an error status with the body the endpoint
// sends, or no answer until ipay stops.
type Answer =
  | { readonly payments: readonly Payment[] }
  | { readonly status: number; readonly body: Record<string, unknown> }
  | { readonly hold: true };

// One planned answer of OpenRouter's Decisions API to one request about an
// email: what Jev chooses for each of ipay's questions, an error in
// OpenRouter's error shape, or no answer until ipay cancels the request.
type Decision =
  | {
      readonly kind: string;
      readonly category: string;
      readonly frequency: string;
    }
  | { readonly status: number; readonly message: string }
  | { readonly hold: true };

const paid = (category: string, frequency: string): Decision => ({
  kind: 'payment',
  category,
  frequency,
});

// What a run of ipay meets on the internet: Luna's answers and Jev's
// decisions, each by the email's subject, and the OpenRouter key in its
// environment (none when null).
type Plan = {
  readonly luna?: Readonly<Record<string, readonly Answer[]>>;
  readonly jev?: Readonly<Record<string, readonly Decision[]>>;
  readonly openRouterKey?: string | null;
};
const openRouterKey = 'sk-or-v1-test-key';

// The ChatGPT login of Codex in the app's CODEX_HOME, copied from
// startup-credits' test (apps/startup-credits/src/startup-credits.test.ts):
// an access token that does not expire before 2100, so the provider asks for
// no refresh, and the account it names.
const account = '5ba1a5a2-6d1e-4c6a-9a51-2f7f0c1d2e3f';
const jwt = (claims: Record<string, unknown>) =>
  [{ alg: 'none', typ: 'JWT' }, claims, 'signature']
    .map((part) =>
      typeof part === 'string'
        ? part
        : Buffer.from(JSON.stringify(part)).toString('base64url'),
    )
    .join('.');
const token = jwt({
  exp: 4_102_444_800,
  'https://api.openai.com/auth': { chatgpt_account_id: account },
});
const codexLogin = JSON.stringify({
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: null,
  tokens: {
    id_token: token,
    access_token: token,
    refresh_token: 'rt_test',
    account_id: account,
  },
  last_refresh: '2026-11-02T00:00:00Z',
});

// The internet as ipay's process sees it, loaded before main.ts: the Codex
// Responses endpoint streams the next answer planned for each request about
// an email, found by the email's Subject line, in the events of a real
// GPT-6-Luna answer captured on 2026-11-02 (as startup-credits' test streams
// them), when the request is ipay's own: GPT-6-Luna asked for the payments
// schema as JSON. OpenRouter's Decisions API answers each request about an
// email with its planned decision, in the shape of a real Jev 1.14 answer
// captured on 2026-10-31 (as startup-credits' test answers), when the request
// is ipay's own: Jev asked ipay's three questions with the user's OpenRouter
// key. Any other request fails.
// Each request about an email is written to stderr, and one with no planned
// answer as unplanned.
const internet = ({
  luna = {},
  jev = {},
  openRouterKey: key = openRouterKey,
}: Plan) => `
import { Msw } from ${JSON.stringify(import.meta.resolve('@zukhruf/testing/msw'))};
import { HttpResponse, http } from ${JSON.stringify(import.meta.resolve('msw'))};
const planned = ${JSON.stringify(luna)};
const decisions = ${JSON.stringify(jev)};
const asked = new Map();
const decided = new Map();
const questions = ${JSON.stringify(ipayQuestions)};
const authorization = ${JSON.stringify(`Bearer ${key}`)};
new Msw().intercept(
  http.post('https://chatgpt.com/backend-api/codex/responses', async ({ request }) => {
    const body = await request.json();
    const prompt = body.input
      .filter(({ role }) => role === 'user')
      .flatMap(({ content }) => typeof content === 'string' ? [content] : content.map(({ text }) => text))
      .join('\\n');
    const subject = /^Subject: (.*)$/mu.exec(prompt)?.[1];
    process.stderr.write('model ' + JSON.stringify({ subject, model: body.model, prompt }) + '\\n');
    const index = asked.get(subject) ?? 0;
    asked.set(subject, index + 1);
    // ipay asks GPT-6-Luna for its payments schema as JSON; any other request
    // is not one the test planned.
    const answer = body.model === 'gpt-6-luna' && body.text?.format?.type === 'json_schema' && body.text.format.schema?.properties?.payments !== undefined
      ? planned[subject]?.[index]
      : undefined;
    if (answer === undefined) {
      process.stderr.write('unplanned model request ' + (index + 1) + ' for ' + subject + '\\n');
      return HttpResponse.error();
    }
    if ('hold' in answer) return new Promise(() => {});
    if ('status' in answer)
      return HttpResponse.json(answer.body, { status: answer.status });
    const text = JSON.stringify({ payments: answer.payments });
    const id = 'resp_09bbfa0984043937016ae822d27cf08191a424371743d31def';
    const item = { type: 'message', id: 'msg_09bbfa0984043937016ae822d2ead48191aafda124fab9deca', role: 'assistant', phase: 'final_answer' };
    const part = { type: 'output_text', text, annotations: [], logprobs: [] };
    const done = { ...item, status: 'completed', content: [part] };
    const response = (status, output) => ({ id, object: 'response', created_at: 1793598162, status, model: body.model, output, error: null, incomplete_details: null, service_tier: 'default' });
    const position = { item_id: item.id, output_index: 0, content_index: 0 };
    const events = [
      { type: 'response.created', response: response('in_progress', []) },
      { type: 'response.in_progress', response: response('in_progress', []) },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', ...position, part: { ...part, text: '' } },
      { type: 'response.output_text.delta', ...position, delta: text, logprobs: [] },
      { type: 'response.output_text.done', ...position, text },
      { type: 'response.content_part.done', ...position, part },
      { type: 'response.output_item.done', output_index: 0, item: done },
      { type: 'response.completed', response: { ...response('completed', [done]), usage: { input_tokens: 633, input_tokens_details: { cached_tokens: 0 }, output_tokens: 65, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 698 } } },
    ];
    return new HttpResponse(
      events.map((event, sequence_number) => 'event: ' + event.type + '\\ndata: ' + JSON.stringify({ ...event, sequence_number }) + '\\n\\n').join(''),
      { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
  }),
  http.post('https://openrouter.ai/api/alpha/decisions', async ({ request }) => {
    const body = await request.json();
    const subject = /^Subject: (.*)$/mu.exec(body.state)?.[1];
    process.stderr.write('decision ' + JSON.stringify({ subject, model: body.model, state: body.state }) + '\\n');
    const index = decided.get(subject) ?? 0;
    decided.set(subject, index + 1);
    // ipay asks Jev its three questions, each with its own choices; any other
    // request is not one the test planned.
    const ours = request.headers.get('authorization') === authorization && body.model === 'typesafe/jev-1.14' && JSON.stringify(Object.fromEntries(Object.entries(body.questions ?? {}).map(([name, { criteria }]) => [name, Object.keys(criteria ?? {})]))) === JSON.stringify(questions);
    const decision = ours ? decisions[subject]?.[index] : undefined;
    if (decision === undefined) {
      process.stderr.write('unplanned decision request ' + (index + 1) + ' for ' + subject + '\\n');
      return HttpResponse.error();
    }
    if ('hold' in decision)
      return new Promise((resolve) =>
        request.signal.addEventListener('abort', () => {
          process.stderr.write('cancelled decision request for ' + subject + '\\n');
          resolve(HttpResponse.error());
        }),
      );
    if ('status' in decision)
      return HttpResponse.json(
        { error: { message: decision.message, code: decision.status } },
        { status: decision.status, headers: { 'retry-after': '0' } },
      );
    const answer = (name) => ({
      type: 'choice',
      choice: decision[name],
      probabilities: Object.fromEntries(questions[name].map((choice) => [choice, choice === decision[name] ? 1 : 0])),
      confidence: 1,
    });
    return HttpResponse.json(
      {
        model: 'typesafe/jev-1.14-20261014',
        answers: { kind: answer('kind'), category: answer('category'), frequency: answer('frequency') },
        usage: { input_tokens: 351, output_tokens: 31, cost: 0.000014742 },
        id: 'gen-dec-1793424713-wGFdCAJhdI68yDBeKJAj',
        provider: 'TypeSafe',
      },
      { headers: { 'x-generation-id': 'gen-dec-1793424713-wGFdCAJhdI68yDBeKJAj', 'x-provider-name': 'TypeSafe' } },
    );
  }),
);
`;

// A read of ipay's file, read only, as a reader of its views does.
type Read = (sql: string) => Record<string, SQLOutputValue>[];

// It waits out ipay's commits, as a reader's .timeout does.
const reading =
  (home: string): Read =>
  (sql) => {
    using database = open(ipayDatabase(home), {
      readOnly: true,
      timeout: 10_000,
    });
    return database
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  };

// One request to the Codex Responses endpoint, as the internet writes it to
// stderr.
const askedSchema = z.object({
  subject: z.string(),
  model: z.string(),
  prompt: z.string(),
});

// One request to OpenRouter's Decisions API, as the internet writes it to
// stderr.
const decidedSchema = z.object({
  subject: z.string(),
  model: z.string(),
  state: z.string(),
});

// The choices of each question ipay asks Jev, as the internet checks them.
const ipayQuestions = {
  kind: ['payment', 'upcoming', 'failed', 'refund', 'offer', 'other'],
  category: [
    'food',
    'utilities',
    'entertainment',
    'transportation',
    'education',
    'healthcare',
    'shopping',
    'cloud_services',
    'other',
  ],
  frequency: ['once', 'monthly', 'annually'],
};

// A moment of a run: what must hold in ipay's file, or in what ipay wrote to
// stderr so far, and what then happens to the apps' stores while ipay runs;
// or ipay's own exit.
type Step =
  | {
      readonly until: (read: Read, stderr: string) => boolean;
      readonly then?: () => Promise<void>;
    }
  // ipay exits by itself, as it does when it cannot start.
  | { readonly exit: true };

// Runs ipay as a user does, with plain node and the test's home, until each
// step holds in turn, then stops it as Ctrl-C does. A step that does not
// hold within a minute fails the run, and so does an exit of ipay before its
// steps end, unless the step expects the exit. Gives each request to the model
// (asked), each unplanned one, its stdout lines, its stderr, and its exit
// code or the signal that ended it.
async function running(
  t: TestContext,
  home: string,
  plan: Plan,
  ...steps: readonly Step[]
) {
  await using folder = await new TemporaryFiles().directory('internet-');
  const setup = join(folder.path, 'internet.mjs');
  writeFileSync(setup, internet(plan));
  writeFileSync(join(folder.path, 'auth.json'), codexLogin, { mode: 0o600 });
  const app = spawn(
    process.execPath,
    ['--import', setup, join(import.meta.dirname, 'main.ts')],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Only what ipay needs, and none of the developer's logins: PATH; HOME,
      // the test's own, which holds Context Compiler's files and ipay's;
      // CODEX_HOME with the test's ChatGPT login. NODE_OPTIONS and
      // WRITE_TEST_MUTANT are what the write-test skill's mutate.mjs sets for
      // the processes of a proof: NODE_OPTIONS imports its mutant hook and
      // WRITE_TEST_MUTANT holds the mutant's edits, so a mutant of ipay's
      // code loads into ipay too. A test run outside a proof has no
      // WRITE_TEST_MUTANT, and an unset variable is not passed.
      env: {
        PATH: process.env.PATH,
        HOME: home,
        CODEX_HOME: folder.path,
        NODE_OPTIONS: process.env.NODE_OPTIONS,
        WRITE_TEST_MUTANT: process.env.WRITE_TEST_MUTANT,
        // The key ipay sends OpenRouter, as a user exports it.
        OPENROUTER_API_KEY:
          plan.openRouterKey === null
            ? undefined
            : (plan.openRouterKey ?? openRouterKey),
      },
    },
  );
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) =>
    app.once('exit', (code, signal) => resolve({ code, signal })),
  );
  let stdout = '';
  let stderr = '';
  app.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  app.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  let ended = false;
  void exited.then(() => (ended = true));
  try {
    for (const step of steps) {
      if ('exit' in step) {
        await t.waitFor(() => assert.ok(ended, `ipay exits\n${stderr}`), {
          interval: 200,
          timeout: 60_000,
        });
        break;
      }
      const { until, then } = step;
      // A table or view ipay has not made yet fails the check until it does.
      await t.waitFor(
        () => {
          if (ended) return;
          assert.ok(
            existsSync(ipayDatabase(home)) && until(reading(home), stderr),
            `ipay reaches ${until}\n${stderr}`,
          );
        },
        { interval: 200, timeout: 60_000 },
      );
      if (ended)
        assert.fail(`ipay exited before it reached ${until}\n${stderr}`);
      await then?.();
    }
  } finally {
    if (!ended) app.kill('SIGINT');
  }
  // ipay ends soon after Ctrl-C, or the stop failed; a process that does
  // not stop is killed, so no test leaves one running.
  try {
    await t.waitFor(
      () => assert.ok(ended, `ipay stops after Ctrl-C\n${stderr}`),
      { interval: 200, timeout: 30_000 },
    );
  } catch (error) {
    app.kill('SIGKILL');
    throw error;
  }
  const { code, signal } = await exited;
  const lines = stderr.split('\n');
  return {
    code,
    signal,
    asked: lines
      .filter((line) => line.startsWith('model '))
      .map((line) =>
        askedSchema.parse(JSON.parse(line.slice('model '.length))),
      ),
    decided: lines
      .filter((line) => line.startsWith('decision '))
      .map((line) =>
        decidedSchema.parse(JSON.parse(line.slice('decision '.length))),
      ),
    unplanned: lines.filter((line) => line.startsWith('unplanned ')),
    stdout: stdout.split('\n').filter((line) => line !== ''),
    stderr,
  };
}

const count = (read: Read, sql: string) => Number(read(sql)[0]?.n);

// How many requests a run sent about each email, by its subject.
const bySubject = (requests: readonly { readonly subject: string }[]) =>
  Object.fromEntries(
    Object.entries(Object.groupBy(requests, ({ subject }) => subject)).map(
      ([subject, each]) => [subject, each?.length],
    ),
  );

// A receipt as Careem sends one: HTML only, with the total in a table.
const careemReceipt: Mail = {
  id: 1,
  from: 'Careem <email@transactional.careem.com>',
  subject: 'Your Delivery From Shawerma Reem',
  received: '2026-10-09T18:10:00.000Z',
  html: '<html><body><table><tr><td>1 × Shawerma Arabi</td><td>JOD 3.250</td></tr><tr><td><b>Total</b></td><td><b>JOD 3.749</b></td></tr></table><p>Thanks for ordering with Careem</p></body></html>',
};
const careemPayment: Payment = {
  quote: 'Total JOD 3.749',
  company: 'Careem',
  service: 'Careem Food',
  amount: 3.749,
  currency: 'JOD',
};
// A card purchase as Arab Bank texts one.
const careemCharge: Text = {
  guid: 'sms-careem',
  from: 'Arab Bank',
  text: 'JO\nتم قيد حركة شراء من حسابكم 500*0145 من www.Careem.com بمبلغ JOD 3.749 بتاريخ 09/10/2026 21:12 .الرصيد 1000.000 دينار اردني.',
  sent: '2026-10-09T18:12:00.000Z',
};

test('ipay reads the Context Compiler imports without writing them, and keeps its own files beside them', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [careemReceipt]);
  chatStore(home.path, [careemCharge]);
  await contextCompilerSync(home.path, ['mail', 'messages']);
  const imports = join(contextCompiler(home.path), 'Imports');
  const before = files(imports);

  const run = await running(
    t,
    home.path,
    {
      luna: { [careemReceipt.subject]: [{ payments: [careemPayment] }] },
      jev: { [careemReceipt.subject]: [paid('food', 'once')] },
    },
    {
      until: (read) =>
        count(read, 'SELECT count(*) AS n FROM payments') === 1 &&
        count(
          read,
          "SELECT count(*) AS n FROM bank_charges WHERE status = 'computed'",
        ) === 1,
    },
  );

  assert.deepEqual(run.unplanned, []);
  assert.deepEqual(
    files(imports),
    before,
    'every file Context Compiler wrote is as it left it',
  );
  assert.deepEqual(
    readdirSync(contextCompiler(home.path)).sort(),
    ['Imports', 'ipay'],
    'ipay keeps its files in its own folder',
  );
  const read = reading(home.path);
  assert.deepEqual(read('SELECT company, amount FROM payments'), [
    { company: 'Careem', amount: 3.749 },
  ]);
  assert.deepEqual(
    read("SELECT guid FROM bank_charges WHERE status = 'computed'"),
    [{ guid: careemCharge.guid }],
  );
});

// Two receipts as Spotify and AWS send them, in plain text.
const spotifyReceipt: Mail = {
  id: 2,
  from: 'Spotify <no-reply@spotify.com>',
  subject: 'Your Spotify Premium receipt',
  received: '2026-10-03T08:00:00.000Z',
  text: 'Thanks for your payment.\nSpotify Premium Individual\nTotal charged: USD 11.99\nYour plan renews monthly.',
};
const spotifyPayment: Payment = {
  quote: 'Total charged: USD 11.99',
  company: 'Spotify',
  service: 'Spotify Premium Individual',
  amount: 11.99,
  currency: 'USD',
};
const awsInvoice: Mail = {
  id: 3,
  from: 'Amazon Web Services <aws-billing@amazon.com>',
  subject: 'Amazon Web Services Invoice Available',
  received: '2026-10-02T10:00:00.000Z',
  text: 'Your invoice for September 2026 is available.\nAmount charged to your card: USD 42.10\nService: Amazon EC2',
};
const awsPayment: Payment = {
  quote: 'Amount charged to your card: USD 42.10',
  company: 'AWS',
  service: 'Amazon EC2',
  amount: 42.1,
  currency: 'USD',
};

const settled = (read: Read, id: number) =>
  count(
    read,
    `SELECT count(*) AS n FROM invoice_payments WHERE id = '${id}' AND status IN ('computed', 'empty', 'failed')`,
  ) === 1;

test('a payment whose quote is not in the email is no payment', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [spotifyReceipt]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      luna: {
        [spotifyReceipt.subject]: [
          {
            payments: [
              {
                ...spotifyPayment,
                quote: 'Total charged: USD 99.00',
                amount: 99,
              },
            ],
          },
        ],
      },
      jev: { [spotifyReceipt.subject]: [paid('entertainment', 'monthly')] },
    },
    { until: (read) => settled(read, spotifyReceipt.id) },
  );

  assert.deepEqual(run.unplanned, []);
  const read = reading(home.path);
  assert.deepEqual(read('SELECT status, payments FROM invoice_payments'), [
    { status: 'empty', payments: null },
  ]);
  assert.equal(count(read, 'SELECT count(*) AS n FROM payments'), 0);
});

test('a model call that fails for one email fails only that email, and a later pass reads it again', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [spotifyReceipt, awsInvoice]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      luna: {
        [spotifyReceipt.subject]: [
          {
            status: 400,
            body: { error: { message: 'The request was invalid.' } },
          },
          { payments: [spotifyPayment] },
        ],
        [awsInvoice.subject]: [{ payments: [awsPayment] }],
      },
      jev: {
        [spotifyReceipt.subject]: [paid('entertainment', 'monthly')],
        [awsInvoice.subject]: [paid('cloud_services', 'monthly')],
      },
    },
    {
      until: (read) =>
        count(
          read,
          `SELECT count(*) AS n FROM invoice_payments WHERE id = '${spotifyReceipt.id}' AND status = 'failed' AND error LIKE '%The request was invalid.%'`,
        ) === 1 &&
        count(
          read,
          `SELECT count(*) AS n FROM invoice_payments WHERE id = '${awsInvoice.id}' AND status = 'computed'`,
        ) === 1,
      // Context Compiler syncs again: the import commits, which is ipay's
      // next pass.
      then: () => contextCompilerSync(home.path, ['mail', 'messages']),
    },
    {
      until: (read) =>
        count(
          read,
          "SELECT count(*) AS n FROM invoice_payments WHERE status = 'computed'",
        ) === 2,
    },
  );

  assert.deepEqual(run.unplanned, []);
  assert.deepEqual(
    run.asked.map(({ subject }) => subject).sort(),
    [awsInvoice.subject, spotifyReceipt.subject, spotifyReceipt.subject].sort(),
  );
  assert.deepEqual(
    reading(home.path)(
      'SELECT company, amount, currency FROM payments ORDER BY company',
    ),
    [
      { company: 'AWS', amount: 42.1, currency: 'USD' },
      { company: 'Spotify', amount: 11.99, currency: 'USD' },
    ],
  );
});

test('a ChatGPT login the endpoint rejects stops ipay with the reason, and no email is marked failed', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [spotifyReceipt]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      luna: {
        [spotifyReceipt.subject]: [
          {
            status: 401,
            body: {
              error: {
                message:
                  'Your authentication token has expired. Please try signing in again.',
              },
            },
          },
        ],
      },
      jev: { [spotifyReceipt.subject]: [paid('entertainment', 'monthly')] },
    },
    { exit: true },
  );

  assert.equal(run.signal, null);
  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /Your authentication token has expired/u);
  assert.equal(
    count(
      reading(home.path),
      "SELECT count(*) AS n FROM invoice_payments WHERE status = 'failed'",
    ),
    0,
  );
});

test('ipay tells the user to set up and sync a connector it reads when Context Compiler has no import of it', async (t) => {
  for (const [missing, present] of [
    ['mail', 'messages'],
    ['messages', 'mail'],
  ] as const) {
    await using home = await new TemporaryFiles().directory('ipay-');
    mailStore(home.path, []);
    chatStore(home.path, []);
    await contextCompilerSync(home.path, [present]);

    const run = await running(t, home.path, {}, { exit: true });

    assert.equal(run.signal, null, missing);
    assert.equal(run.code, 1, missing);
    assert.match(
      run.stderr,
      new RegExp(
        `Context Compiler has no ${missing} import: set up ${missing} in Context Compiler and sync it`,
        'u',
      ),
    );
    assert.deepEqual(run.asked, []);
  }
});

// A text from Arab Bank, as Messages keeps it.
const bank = (guid: string, text: string, sent: string): Text => ({
  guid,
  from: 'Arab Bank',
  text,
  sent,
});

test("each form of the bank's texts gives its movement, and a text of no known form gives none", async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  const texts = {
    purchase: bank(
      't-purchase',
      'JO\nتم قيد حركة شراء من حسابكم 500*0145 من a.saily بمبلغ JOD 0.731 بتاريخ 31/08/2026 01:49 .الرصيد 126957.313 دينار اردني.',
      '2026-08-30T22:50:00.000Z',
    ),
    unspaced: bank(
      't-unspaced',
      'JO\r\nتم قيد حركة شراء من حسابكم 500*0145 من www.Careem.com بمبلغ JOD3.749 بتاريخ 16/04 12:44.الرصيد 41123.620 دينار اردني.',
      '2025-04-16T09:45:00.000Z',
    ),
    lastYear: bank(
      't-last-year',
      'JO\nتم قيد حركة شراء من حسابكم 500*0145 من Talabat بمبلغ JOD 7.250 بتاريخ 31/12 23:40 .الرصيد 900.000 دينار اردني.',
      '2026-01-01T08:00:00.000Z',
    ),
    short: bank(
      't-short',
      'JO\r\nشراء بمبلغ JOD 12.500 من حساب 500*0145.الرصيد المتوفر 900.000',
      '2026-10-08T10:00:00.000Z',
    ),
    abroad: bank(
      't-abroad',
      'A Trx using Card XXXX6002 from OPENAI *CHATGPT SUBSCR for USD 20.00 on 14-Dec-2025 at 22:13 GMT+3. Available balance is JOD 27.886.',
      '2025-12-14T19:14:00.000Z',
    ),
    branch: bank(
      't-branch',
      'JO\nتم قيد حركة سحب بمبلغ 900 JOD من حسابكم 500*0145 لدى Mecca St Br بتاريخ 29/08 الساعه 19:44.الرصيد المتوفر 24591.365.\nREF 001119108153',
      '2025-08-29T16:45:00.000Z',
    ),
    atm: bank(
      't-atm',
      'JO\r\nتم قيد حركة سحب بمبلغ 100.000 JOD من حسابك 500*0145 بتاريخ 31/05/2026 21:05 .الرصيد المتوفر 128985.033 REF 614518228521 .',
      '2026-05-31T18:06:00.000Z',
    ),
    atm2019: bank(
      't-atm-2019',
      'JO\r\n20 سحب صراف من حسابكم 500*0145. الرصيد 913.200 .',
      '2019-11-02T09:26:00.000Z',
    ),
    cliqOut: bank(
      't-cliq-out',
      'JO\r\n تم قيد دفعة كليك بمبلغ 88.000JOD من حساب 500*0145 إلى SAMI KHALED الرصيد 128318.543JOD',
      '2026-10-30T18:42:00.000Z',
    ),
    cliqIn: bank(
      't-cliq-in',
      'JO\r\nتم قيد دفعة كليك 8  JOD لحساب  502*0145',
      '2026-10-20T10:00:00.000Z',
    ),
    bill: bank(
      't-bill',
      'JO\r\n دفع فاتورة HSPA_5G رقم 0790000000 بمبلغ JOD12.500 من حساب 500*0145',
      '2026-10-05T10:00:00.000Z',
    ),
    card: bank(
      't-card',
      'JO\nدفع لبطاقة ائتمان بمبلغ JOD 8.821 من حساب 500*0145',
      '2026-10-06T10:00:00.000Z',
    ),
    cardCredit: bank(
      't-card-credit',
      'JOD 8.821 has been credited to your card account # XXXX6002, Thank you',
      '2026-10-06T10:01:00.000Z',
    ),
    out: bank(
      't-out',
      'JO\r\nقيدت حوالة بمبلغ JOD 600 من حساب 500*0145 لحساب 501*0145. الرصيد JOD 18378.010',
      '2026-10-07T10:00:00.000Z',
    ),
    in: bank(
      't-in',
      'JO\n قيد حوالة بمبلغ JOD 9055.400 لحساب 500*0145 الرصيد المتوفر 73220.967',
      '2026-10-15T10:24:00.000Z',
    ),
    credited: bank(
      't-credited',
      'JO\r\nJOD 8 قيد لحساب 500*0145',
      '2026-10-16T10:00:00.000Z',
    ),
    salary: bank(
      't-salary',
      'JO\r\nقيد راتب بمبلغ JOD 832.500 لحساب 500*0145 بتاريخ 26/08\r\n تواصل مع حسابك عبر خدمة عربي أون لاين و عربي موبايل\r\n',
      '2026-08-26T07:00:00.000Z',
    ),
    deposit: bank(
      't-deposit',
      'إيداع فوري لمبلغ JOD 50 لحساب 500*0145.الرصيد المتوفر 960. حمل تطبيق عربي موبايل',
      '2026-10-17T10:00:00.000Z',
    ),
    reversal: bank(
      't-reversal',
      'Reversal of Trx on Card #XXXX6002 from POSTHOG PREAUTH for USD 0.50 on 13-Feb-2024 at 23:02  GMT+3. Available balance is JOD 37.577.',
      '2024-02-13T20:03:00.000Z',
    ),
    statement: bank(
      't-statement',
      'JO\nتم إصدار كشف بطاقتكم 6002 الإلكتروني والمتوفر على عربي أون لاين',
      '2026-10-01T06:00:00.000Z',
    ),
  };
  mailStore(home.path, []);
  chatStore(home.path, Object.values(texts));
  await contextCompilerSync(home.path, ['mail', 'messages']);

  await running(
    t,
    home.path,
    {},
    {
      until: (read) =>
        count(
          read,
          "SELECT count(*) AS n FROM bank_charges WHERE status IN ('computed', 'empty')",
        ) === Object.keys(texts).length,
    },
  );

  const movement = (
    kind: string,
    direction: string,
    counterparty: string | null,
    amount: string,
    currency: string,
    booked_on: string,
  ) => ({
    status: 'computed',
    kind,
    direction,
    counterparty,
    amount,
    currency,
    booked_on,
  });
  const read = reading(home.path);
  assert.deepEqual(
    Object.fromEntries(
      read(
        'SELECT guid, status, kind, direction, counterparty, amount, currency, booked_on FROM bank_charges',
      ).map(({ guid, ...rest }) => [guid, rest]),
    ),
    {
      't-purchase': movement(
        'purchase',
        'debit',
        'a.saily',
        '0.731',
        'JOD',
        '2026-08-31',
      ),
      't-unspaced': movement(
        'purchase',
        'debit',
        'www.Careem.com',
        '3.749',
        'JOD',
        '2025-04-16',
      ),
      't-last-year': movement(
        'purchase',
        'debit',
        'Talabat',
        '7.250',
        'JOD',
        '2025-12-31',
      ),
      't-short': movement(
        'purchase',
        'debit',
        null,
        '12.500',
        'JOD',
        '2026-10-08',
      ),
      't-abroad': movement(
        'purchase',
        'debit',
        'OPENAI *CHATGPT SUBSCR',
        '20.00',
        'USD',
        '2025-12-14',
      ),
      't-branch': movement(
        'withdrawal',
        'debit',
        'Mecca St Br',
        '900',
        'JOD',
        '2025-08-29',
      ),
      't-atm': movement(
        'withdrawal',
        'debit',
        null,
        '100.000',
        'JOD',
        '2026-05-31',
      ),
      't-atm-2019': movement(
        'withdrawal',
        'debit',
        null,
        '20',
        'JOD',
        '2019-11-02',
      ),
      't-cliq-out': movement(
        'cliq',
        'debit',
        'SAMI KHALED',
        '88.000',
        'JOD',
        '2026-10-30',
      ),
      't-cliq-in': movement('cliq', 'credit', null, '8', 'JOD', '2026-10-20'),
      't-bill': movement(
        'bill',
        'debit',
        'HSPA_5G',
        '12.500',
        'JOD',
        '2026-10-05',
      ),
      't-card': movement(
        'card_payment',
        'debit',
        null,
        '8.821',
        'JOD',
        '2026-10-06',
      ),
      't-card-credit': movement(
        'card_credit',
        'credit',
        null,
        '8.821',
        'JOD',
        '2026-10-06',
      ),
      't-out': movement(
        'transfer_out',
        'debit',
        '501*0145',
        '600',
        'JOD',
        '2026-10-07',
      ),
      't-in': movement(
        'transfer_in',
        'credit',
        null,
        '9055.400',
        'JOD',
        '2026-10-15',
      ),
      't-credited': movement(
        'transfer_in',
        'credit',
        null,
        '8',
        'JOD',
        '2026-10-16',
      ),
      't-salary': movement(
        'salary',
        'credit',
        null,
        '832.500',
        'JOD',
        '2026-08-26',
      ),
      't-deposit': movement(
        'deposit',
        'credit',
        null,
        '50',
        'JOD',
        '2026-10-17',
      ),
      't-reversal': movement(
        'reversal',
        'credit',
        'POSTHOG PREAUTH',
        '0.50',
        'USD',
        '2024-02-13',
      ),
      't-statement': {
        status: 'empty',
        kind: null,
        direction: null,
        counterparty: null,
        amount: null,
        currency: null,
        booked_on: null,
      },
    },
  );
});

test('a one-time password or a refused purchase is no charge, and monthly_charges sums only what left the account', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, []);
  chatStore(home.path, [
    bank(
      't-otp',
      'JO\nلا تشارك رمز التفعيل\nرمز التفعيل لمرة واحدة: 782296 \nالغاية: حركة شراء بمبلغ 30 JOD من noon \nتطبق عمولة على الحركات الدولية',
      '2026-10-04T09:00:00.000Z',
    ),
    bank(
      't-refused',
      'A Trx attempt on card no. XXXX6002 from noon for AED 875.00 on 04-Oct-2026 12:32 was not processed due to unavailable balance. Current available balance is JOD 4.951 .',
      '2026-10-04T09:32:00.000Z',
    ),
    bank(
      't-bought',
      'JO\nتم قيد حركة شراء من حسابكم 500*0145 من noon بمبلغ JOD 10.000 بتاريخ 04/10/2026 12:40 .الرصيد 500.000 دينار اردني.',
      '2026-10-04T09:40:00.000Z',
    ),
    bank(
      't-salary',
      'JO\r\nقيد راتب بمبلغ JOD 832.500 لحساب 500*0145 بتاريخ 26/10',
      '2026-10-26T07:00:00.000Z',
    ),
  ]);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  await running(
    t,
    home.path,
    {},
    {
      until: (read) =>
        count(
          read,
          "SELECT count(*) AS n FROM bank_charges WHERE status IN ('computed', 'empty')",
        ) === 4,
    },
  );

  const read = reading(home.path);
  assert.deepEqual(
    read("SELECT guid FROM bank_charges WHERE status = 'empty' ORDER BY guid"),
    [{ guid: 't-otp' }, { guid: 't-refused' }],
  );
  assert.deepEqual(read('SELECT * FROM monthly_charges'), [
    {
      month: '2026-10',
      kind: 'purchase',
      currency: 'JOD',
      total: 10,
      movements: 1,
    },
  ]);
});

test('an email or a bank text that leaves its import leaves the payments and charges', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  const bought = bank(
    't-bought',
    'JO\nتم قيد حركة شراء من حسابكم 500*0145 من noon بمبلغ JOD 10.000 بتاريخ 05/10/2026 12:40 .الرصيد 500.000 دينار اردني.',
    '2026-10-05T09:40:00.000Z',
  );
  mailStore(home.path, [careemReceipt, spotifyReceipt]);
  chatStore(home.path, [careemCharge, bought]);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      luna: {
        [careemReceipt.subject]: [{ payments: [careemPayment] }],
        [spotifyReceipt.subject]: [{ payments: [spotifyPayment] }],
      },
      jev: {
        [careemReceipt.subject]: [paid('food', 'once')],
        [spotifyReceipt.subject]: [paid('entertainment', 'monthly')],
      },
    },
    {
      until: (read) =>
        count(read, 'SELECT count(*) AS n FROM payments') === 2 &&
        count(read, 'SELECT sum(movements) AS n FROM monthly_charges') === 2,
      then: async () => {
        mailStore(home.path, [careemReceipt]);
        chatStore(home.path, [careemCharge]);
        await contextCompilerSync(home.path, ['mail', 'messages']);
      },
    },
    {
      until: (read) =>
        count(read, 'SELECT count(*) AS n FROM payments') === 1 &&
        count(read, 'SELECT sum(movements) AS n FROM monthly_charges') === 1,
    },
  );

  assert.deepEqual(run.unplanned, []);
  const read = reading(home.path);
  assert.deepEqual(read('SELECT company FROM payments'), [
    { company: 'Careem' },
  ]);
  assert.deepEqual(read('SELECT month, total FROM monthly_charges'), [
    { month: '2026-10', total: 3.749 },
  ]);
});

test("an HTML-only receipt gives its payment with every field, Jev's category and frequency among them, counted in the month Mail received it", async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [careemReceipt]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      luna: { [careemReceipt.subject]: [{ payments: [careemPayment] }] },
      jev: { [careemReceipt.subject]: [paid('food', 'once')] },
    },
    {
      until: (read) => count(read, 'SELECT count(*) AS n FROM payments') === 1,
    },
  );

  assert.deepEqual(run.unplanned, []);
  assert.match(
    run.asked[0]!.prompt,
    /Total\s+JOD 3\.749/u,
    'the model reads the receipt as text',
  );
  assert.match(
    run.decided[0]!.state,
    /Total\s+JOD 3\.749/u,
    'Jev reads the receipt as text',
  );
  const read = reading(home.path);
  assert.deepEqual(
    read(
      'SELECT email_id, received_at, sender, subject, company, service, category, amount, currency, frequency, quote FROM payments',
    ),
    [
      {
        email_id: '1',
        received_at: careemReceipt.received,
        sender: 'email@transactional.careem.com',
        subject: careemReceipt.subject,
        company: 'Careem',
        service: 'Careem Food',
        category: 'food',
        amount: 3.749,
        currency: 'JOD',
        frequency: 'once',
        quote: careemPayment.quote,
      },
    ],
  );
  assert.deepEqual(read('SELECT * FROM monthly_payments'), [
    {
      month: '2026-10',
      currency: 'JOD',
      category: 'food',
      total: 3.749,
      payments: 1,
    },
  ]);
});

test('an invoice whose amount is only in its attached PDF gives its payment', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  const invoice: Mail = {
    id: 4,
    from: 'Hetzner <billing@hetzner.com>',
    subject: 'Your Hetzner invoice',
    received: '2026-10-01T06:00:00.000Z',
    text: 'Dear customer, your invoice is attached.',
    pdf: 'Invoice 2041 - Cloud server CX22 - Amount paid: EUR 4.51',
  };
  mailStore(home.path, [invoice]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages'], {
    includeAttachments: true,
  });

  const run = await running(
    t,
    home.path,
    {
      luna: {
        [invoice.subject]: [
          {
            payments: [
              {
                quote: 'Amount paid: EUR 4.51',
                company: 'Hetzner',
                service: 'Cloud server CX22',
                amount: 4.51,
                currency: 'EUR',
              },
            ],
          },
        ],
      },
      jev: { [invoice.subject]: [paid('cloud_services', 'monthly')] },
    },
    {
      until: (read) => count(read, 'SELECT count(*) AS n FROM payments') === 1,
    },
  );

  assert.deepEqual(run.unplanned, []);
  assert.match(
    run.asked[0]!.prompt,
    /Amount paid: EUR 4\.51/u,
    'the model reads the PDF',
  );
  assert.match(
    run.decided[0]!.state,
    /Amount paid: EUR 4\.51/u,
    'Jev reads the PDF',
  );
  assert.deepEqual(
    reading(home.path)('SELECT company, amount, currency FROM payments'),
    [{ company: 'Hetzner', amount: 4.51, currency: 'EUR' }],
  );
});

test("an email that charges for several services gives a payment for each, and each carries the email's one category and frequency from Jev", async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  const google: Mail = {
    id: 5,
    from: 'Google Payments <payments-noreply@google.com>',
    subject: 'Your Google receipt',
    received: '2026-10-11T12:00:00.000Z',
    text: 'Google Workspace Business Starter: USD 7.20\nGoogle One 100 GB: USD 1.99\nTotal: USD 9.19',
  };
  mailStore(home.path, [google]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);
  const service = (quote: string, name: string, amount: number): Payment => ({
    quote,
    company: 'Google',
    service: name,
    amount,
    currency: 'USD',
  });

  const run = await running(
    t,
    home.path,
    {
      luna: {
        [google.subject]: [
          {
            payments: [
              service(
                'Google Workspace Business Starter: USD 7.20',
                'Google Workspace Business Starter',
                7.2,
              ),
              service('Google One 100 GB: USD 1.99', 'Google One 100 GB', 1.99),
            ],
          },
        ],
      },
      jev: { [google.subject]: [paid('cloud_services', 'monthly')] },
    },
    {
      until: (read) => count(read, 'SELECT count(*) AS n FROM payments') === 2,
    },
  );

  assert.deepEqual(run.unplanned, []);
  const read = reading(home.path);
  assert.deepEqual(
    read(
      'SELECT service, amount, category, frequency FROM payments ORDER BY amount',
    ),
    [
      {
        service: 'Google One 100 GB',
        amount: 1.99,
        category: 'cloud_services',
        frequency: 'monthly',
      },
      {
        service: 'Google Workspace Business Starter',
        amount: 7.2,
        category: 'cloud_services',
        frequency: 'monthly',
      },
    ],
  );
  assert.deepEqual(read('SELECT total, payments FROM monthly_payments'), [
    { total: 9.19, payments: 2 },
  ]);
});

test('an email Jev reads as a payment that Luna answers with no payments gives no payment row', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  const offer: Mail = {
    id: 6,
    from: 'Spotify <no-reply@spotify.com>',
    subject: 'Get 3 months of Premium subscription for USD 0',
    received: '2026-10-12T12:00:00.000Z',
    text: 'Try Spotify Premium free for 3 months. Then USD 11.99 a month. Cancel anytime.',
  };
  mailStore(home.path, [offer]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      luna: { [offer.subject]: [{ payments: [] }] },
      jev: { [offer.subject]: [paid('entertainment', 'monthly')] },
    },
    { until: (read) => settled(read, offer.id) },
  );

  assert.deepEqual(run.unplanned, []);
  assert.equal(run.asked.length, 1);
  const read = reading(home.path);
  assert.deepEqual(read('SELECT status FROM invoice_payments'), [
    { status: 'empty' },
  ]);
  assert.equal(count(read, 'SELECT count(*) AS n FROM payments'), 0);
});

const passes = (read: Read) =>
  count(
    read,
    'SELECT count(*) AS n FROM sync_attempts WHERE completed_at IS NOT NULL',
  );

test("only candidate emails reach Jev, only Jev's payments reach Luna, only the bank's texts are copied, and a restart sends nothing again to either", async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  const dinner: Mail = {
    id: 7,
    from: 'Lina <lina@example.com>',
    subject: 'Dinner tonight?',
    received: '2026-10-09T15:00:00.000Z',
    text: 'Are we still on for dinner at 8? I can book the table.',
  };
  const newsletter: Mail = {
    id: 8,
    from: 'The Batch <thebatch@deeplearning.ai>',
    subject: 'This week in AI',
    received: '2026-10-09T16:00:00.000Z',
    html: '<p>New models shipped this week, and a total of three papers stood out.</p>',
  };
  const due: Mail = {
    id: 9,
    from: 'Spotify <no-reply@spotify.com>',
    subject: 'Your payment of USD 11.99 is due on 5 November',
    received: '2026-10-29T08:00:00.000Z',
    text: 'Your Spotify Premium plan renews on 5 November. We will charge USD 11.99 to your card.',
  };
  mailStore(home.path, [careemReceipt, dinner, newsletter, due]);
  chatStore(home.path, [
    careemCharge,
    {
      guid: 't-friend',
      from: 'Friend',
      text: 'see you at 8, I paid JOD 5 for the tickets',
      sent: '2026-10-09T15:05:00.000Z',
    },
  ]);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const first = await running(
    t,
    home.path,
    {
      luna: { [careemReceipt.subject]: [{ payments: [careemPayment] }] },
      jev: {
        [careemReceipt.subject]: [paid('food', 'once')],
        [due.subject]: [
          { kind: 'upcoming', category: 'entertainment', frequency: 'monthly' },
        ],
      },
    },
    {
      until: (read) =>
        count(read, 'SELECT count(*) AS n FROM payments') === 1 &&
        count(
          read,
          "SELECT count(*) AS n FROM email_kinds WHERE status = 'computed'",
        ) === 2 &&
        count(
          read,
          "SELECT count(*) AS n FROM bank_charges WHERE status = 'computed'",
        ) === 1,
    },
  );
  const before = passes(reading(home.path));
  const restart = await running(
    t,
    home.path,
    {},
    {
      until: (read) => passes(read) > before,
      // The refresh after the pass would ask either model now.
      then: () => sleep(3000),
    },
  );

  assert.deepEqual(first.unplanned, []);
  assert.deepEqual(
    first.decided.map(({ subject }) => subject).sort(),
    [careemReceipt.subject, due.subject].sort(),
  );
  assert.deepEqual(
    first.asked.map(({ subject }) => subject),
    [careemReceipt.subject],
  );
  assert.equal(
    restart.signal,
    'SIGINT',
    'the restarted ipay ran until stopped',
  );
  assert.deepEqual(restart.unplanned, []);
  assert.deepEqual(restart.decided, []);
  assert.deepEqual(restart.asked, []);
  const read = reading(home.path);
  assert.deepEqual(read('SELECT id FROM invoice_emails ORDER BY id'), [
    { id: '1' },
    { id: '9' },
  ]);
  assert.deepEqual(read('SELECT guid FROM bank_messages'), [
    { guid: careemCharge.guid },
  ]);
  assert.equal(count(read, 'SELECT count(*) AS n FROM payments'), 1);
});

test('an email or a bank text that arrives while ipay runs is read without a restart, and a changed email is decided and read again while an unchanged one goes to neither model', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [spotifyReceipt]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);
  const corrected: Mail = {
    ...spotifyReceipt,
    text: spotifyReceipt.text!.replace('USD 11.99', 'USD 12.99'),
  };

  const run = await running(
    t,
    home.path,
    {
      luna: {
        [spotifyReceipt.subject]: [
          { payments: [spotifyPayment] },
          {
            payments: [
              {
                ...spotifyPayment,
                quote: 'Total charged: USD 12.99',
                amount: 12.99,
              },
            ],
          },
        ],
        [awsInvoice.subject]: [{ payments: [awsPayment] }],
      },
      jev: {
        [spotifyReceipt.subject]: [
          paid('entertainment', 'monthly'),
          paid('entertainment', 'monthly'),
        ],
        [awsInvoice.subject]: [paid('cloud_services', 'monthly')],
      },
    },
    {
      until: (read) => count(read, 'SELECT count(*) AS n FROM payments') === 1,
      then: async () => {
        mailStore(home.path, [spotifyReceipt, awsInvoice]);
        chatStore(home.path, [careemCharge]);
        await contextCompilerSync(home.path, ['mail', 'messages']);
      },
    },
    {
      until: (read) =>
        count(read, 'SELECT count(*) AS n FROM payments') === 2 &&
        count(
          read,
          "SELECT count(*) AS n FROM bank_charges WHERE status = 'computed'",
        ) === 1,
      then: async () => {
        mailStore(home.path, [corrected, awsInvoice]);
        await contextCompilerSync(home.path, ['mail', 'messages']);
      },
    },
    {
      until: (read) =>
        count(
          read,
          "SELECT count(*) AS n FROM payments WHERE company = 'Spotify' AND amount = 12.99",
        ) === 1,
    },
  );

  assert.deepEqual(run.unplanned, []);
  assert.deepEqual(bySubject(run.decided), {
    [spotifyReceipt.subject]: 2,
    [awsInvoice.subject]: 1,
  });
  assert.deepEqual(bySubject(run.asked), {
    [spotifyReceipt.subject]: 2,
    [awsInvoice.subject]: 1,
  });
  assert.deepEqual(
    reading(home.path)('SELECT company, amount FROM payments ORDER BY company'),
    [
      { company: 'AWS', amount: 42.1 },
      { company: 'Spotify', amount: 12.99 },
    ],
  );
});

test("ipay's rows are as current as the imports they come from, not as the run", async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [careemReceipt]);
  chatStore(home.path, [careemCharge]);
  await contextCompilerSync(home.path, ['mail', 'messages']);
  const imports = join(contextCompiler(home.path), 'Imports');
  const importOf = (connector: string) => {
    using settings = open(join(imports, 'settings.sqlite'), {
      readOnly: true,
    });
    const { database } = settings
      .prepare('SELECT database FROM selected_connectors WHERE connector = ?')
      .get(connector)!;
    return open(join(imports, String(database)), {
      readOnly: true,
    });
  };
  const currentAsOf = (connector: string, streams: readonly string[]) => {
    using database = importOf(connector);
    return database
      .prepare(
        `SELECT min(current_as_of) AS at FROM stream_status WHERE stream IN (${streams.map(() => '?').join(', ')})`,
      )
      .get(...streams)!.at;
  };
  const mail = currentAsOf('mail', ['messages', 'messageParts', 'attachments']);
  const messages = currentAsOf('messages', ['messages']);

  await running(
    t,
    home.path,
    {
      luna: { [careemReceipt.subject]: [{ payments: [careemPayment] }] },
      jev: { [careemReceipt.subject]: [paid('food', 'once')] },
    },
    {
      until: (read) =>
        count(read, 'SELECT count(*) AS n FROM payments') === 1 &&
        count(
          read,
          'SELECT count(*) AS n FROM stream_status WHERE current_as_of IS NOT NULL',
        ) === 2,
    },
  );

  assert.equal(typeof mail, 'string');
  assert.equal(typeof messages, 'string');
  assert.deepEqual(
    reading(home.path)(
      'SELECT stream, current_as_of FROM stream_status ORDER BY stream',
    ),
    [
      { stream: 'bank_messages', current_as_of: messages },
      { stream: 'invoice_emails', current_as_of: mail },
    ],
  );
});

test('Ctrl-C while the model reads an email ends ipay by the signal and stores no failure for the email', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [careemReceipt]);
  chatStore(home.path, [careemCharge]);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      luna: { [careemReceipt.subject]: [{ hold: true }] },
      jev: { [careemReceipt.subject]: [paid('food', 'once')] },
    },
    {
      until: (_, stderr) =>
        stderr.includes(`"subject":"${careemReceipt.subject}"`),
    },
  );

  assert.equal(run.signal, 'SIGINT');
  assert.equal(run.code, null);
  assert.deepEqual(run.stdout, []);
  assert.equal(
    count(reading(home.path), 'SELECT count(*) AS n FROM invoice_payments'),
    0,
  );
});

test('an email Jev reads as no payment of the user, as an offer, an upcoming, failed or refunded payment or anything else, never reaches Luna and gives no payment', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  const kinds = ['offer', 'upcoming', 'failed', 'refund', 'other'] as const;
  const emails: Record<(typeof kinds)[number], Mail> = {
    offer: {
      id: 11,
      from: 'Spotify <no-reply@spotify.com>',
      subject: 'Get 3 months of Premium subscription for USD 0',
      received: '2026-10-12T12:00:00.000Z',
      text: 'Try Spotify Premium free for 3 months. Then USD 11.99 a month.',
    },
    upcoming: {
      id: 12,
      from: 'Netflix <info@netflix.com>',
      subject: 'Your payment of USD 15.49 is due soon',
      received: '2026-10-13T12:00:00.000Z',
      text: 'We will charge USD 15.49 on 20 October.',
    },
    failed: {
      id: 13,
      from: 'Apple <no_reply@email.apple.com>',
      subject: 'Your payment failed',
      received: '2026-10-14T12:00:00.000Z',
      text: 'We could not charge USD 2.99 for iCloud+. Update your payment method.',
    },
    refund: {
      id: 14,
      from: 'Amazon <payments@amazon.com>',
      subject: 'Your refund receipt',
      received: '2026-10-15T12:00:00.000Z',
      text: 'We refunded USD 23.40 to your card.',
    },
    other: {
      id: 15,
      from: 'PayPal <service@paypal.com>',
      subject: 'Update to your billing address',
      received: '2026-10-16T12:00:00.000Z',
      text: 'Your billing address was changed.',
    },
  };
  // The control: an email Jev decides payment reaches Luna in the same run.
  const control: Mail = {
    id: 10,
    from: 'Spotify <no-reply@spotify.com>',
    subject: 'Your Spotify Premium receipt',
    received: '2026-10-03T08:00:00.000Z',
    text: 'Thanks for your payment.\nTotal charged: USD 11.99',
  };
  mailStore(home.path, [control, ...Object.values(emails)]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      jev: {
        [control.subject]: [paid('entertainment', 'monthly')],
        ...Object.fromEntries(
          kinds.map((kind) => [
            emails[kind].subject,
            [{ kind, category: 'other', frequency: 'once' }],
          ]),
        ),
      },
      luna: { [control.subject]: [{ payments: [spotifyPayment] }] },
    },
    {
      // Luna reads every email decided payment in one refresh, so by the
      // control's payment it was asked about any other email it reads.
      until: (read) =>
        count(
          read,
          "SELECT count(*) AS n FROM email_kinds WHERE status = 'computed'",
        ) ===
          kinds.length + 1 &&
        count(read, 'SELECT count(*) AS n FROM payments') === 1,
    },
  );

  assert.deepEqual(run.unplanned, []);
  assert.equal(run.decided.length, kinds.length + 1);
  assert.deepEqual(
    run.asked.map(({ subject }) => subject),
    [control.subject],
  );
  const read = reading(home.path);
  assert.deepEqual(read('SELECT id, kind FROM email_kinds ORDER BY id'), [
    { id: String(control.id), kind: 'payment' },
    ...kinds.map((kind) => ({ id: String(emails[kind].id), kind })),
  ]);
  assert.deepEqual(read('SELECT id FROM invoice_payments'), [
    { id: String(control.id) },
  ]);
  assert.deepEqual(read('SELECT email_id FROM payments'), [
    { email_id: String(control.id) },
  ]);
});

test('a decision call that fails for one email fails only that email, and a later pass decides it again', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [spotifyReceipt, awsInvoice]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      luna: {
        [spotifyReceipt.subject]: [{ payments: [spotifyPayment] }],
        [awsInvoice.subject]: [{ payments: [awsPayment] }],
      },
      jev: {
        [spotifyReceipt.subject]: [
          { status: 400, message: 'The decision request was invalid.' },
          paid('entertainment', 'monthly'),
        ],
        [awsInvoice.subject]: [paid('cloud_services', 'monthly')],
      },
    },
    {
      until: (read) =>
        count(
          read,
          `SELECT count(*) AS n FROM email_kinds WHERE id = '${spotifyReceipt.id}' AND status = 'failed' AND error LIKE '%The decision request was invalid.%'`,
        ) === 1 &&
        count(
          read,
          "SELECT count(*) AS n FROM payments WHERE company = 'AWS'",
        ) === 1,
      // Context Compiler syncs again: the import commits, which is ipay's
      // next pass.
      then: () => contextCompilerSync(home.path, ['mail', 'messages']),
    },
    {
      until: (read) =>
        count(
          read,
          "SELECT count(*) AS n FROM payments WHERE company = 'Spotify'",
        ) === 1,
    },
  );

  assert.deepEqual(run.unplanned, []);
  assert.deepEqual(
    run.decided.map(({ subject }) => subject).sort(),
    [awsInvoice.subject, spotifyReceipt.subject, spotifyReceipt.subject].sort(),
  );
  assert.deepEqual(
    run.asked.map(({ subject }) => subject).sort(),
    [awsInvoice.subject, spotifyReceipt.subject].sort(),
  );
});

test('an OpenRouter key the Decisions API rejects stops ipay with the reason, and no email is marked failed', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [spotifyReceipt]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      jev: {
        [spotifyReceipt.subject]: [
          { status: 401, message: 'No auth credentials found' },
        ],
      },
    },
    { exit: true },
  );

  assert.equal(run.signal, null);
  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /No auth credentials found/u);
  assert.deepEqual(run.asked, []);
  assert.equal(
    count(
      reading(home.path),
      "SELECT count(*) AS n FROM email_kinds WHERE status = 'failed'",
    ),
    0,
  );
});

test('with no OpenRouter key ipay stops and tells the user to set OPENROUTER_API_KEY', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [spotifyReceipt]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    { openRouterKey: null },
    { exit: true },
  );

  assert.equal(run.signal, null);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /set OPENROUTER_API_KEY/u);
  assert.deepEqual(run.decided, []);
  assert.deepEqual(run.asked, []);
});

test('every candidate email gets a decision, more of them than Jev is asked at once, and every one decided payment gets its payment', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  // More emails than the 16 decisions PaymentKinds asks for at once.
  const receipts = Array.from({ length: 20 }, (_, index): Mail => ({
    id: 21 + index,
    from: 'Shop <orders@shop.example>',
    subject: `Your receipt number ${21 + index}`,
    received: '2026-10-20T10:00:00.000Z',
    text: `Thanks for your order.\nTotal charged: USD ${21 + index}.00`,
  }));
  // Every other email is a payment; the rest are offers.
  const isPayment = (mail: Mail) => mail.id % 2 === 0;
  mailStore(home.path, receipts);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    {
      jev: Object.fromEntries(
        receipts.map((mail) => [
          mail.subject,
          [
            isPayment(mail)
              ? paid('shopping', 'once')
              : { kind: 'offer', category: 'shopping', frequency: 'once' },
          ],
        ]),
      ),
      luna: Object.fromEntries(
        receipts.filter(isPayment).map((mail) => [
          mail.subject,
          [
            {
              payments: [
                {
                  quote: `Total charged: USD ${mail.id}.00`,
                  company: 'Shop',
                  service: 'Shop order',
                  amount: mail.id,
                  currency: 'USD',
                },
              ],
            },
          ],
        ]),
      ),
    },
    {
      until: (read) =>
        count(read, 'SELECT count(*) AS n FROM payments') ===
        receipts.filter(isPayment).length,
    },
  );

  assert.deepEqual(run.unplanned, []);
  assert.deepEqual(
    bySubject(run.decided),
    Object.fromEntries(receipts.map(({ subject }) => [subject, 1])),
  );
  const read = reading(home.path);
  assert.equal(
    count(
      read,
      "SELECT count(*) AS n FROM email_kinds WHERE status = 'computed'",
    ),
    receipts.length,
  );
  assert.deepEqual(
    read('SELECT email_id, amount FROM payments ORDER BY amount'),
    receipts
      .filter(isPayment)
      .map(({ id }) => ({ email_id: String(id), amount: id })),
  );
});

test('an email whose change Jev decides is no longer a payment leaves the payments and the monthly totals', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [spotifyReceipt]);
  chatStore(home.path, []);
  await contextCompilerSync(home.path, ['mail', 'messages']);
  // The same email, now telling of a charge to come.
  const changed: Mail = {
    ...spotifyReceipt,
    text: 'Your Spotify Premium Individual plan renews on 5 November.\nWe will charge USD 11.99 to your card.',
  };

  const run = await running(
    t,
    home.path,
    {
      jev: {
        [spotifyReceipt.subject]: [
          paid('entertainment', 'monthly'),
          { kind: 'upcoming', category: 'entertainment', frequency: 'monthly' },
        ],
      },
      luna: { [spotifyReceipt.subject]: [{ payments: [spotifyPayment] }] },
    },
    {
      until: (read) =>
        count(read, 'SELECT count(*) AS n FROM monthly_payments') === 1,
      then: async () => {
        mailStore(home.path, [changed]);
        await contextCompilerSync(home.path, ['mail', 'messages']);
      },
    },
    {
      until: (read) =>
        count(
          read,
          `SELECT count(*) AS n FROM email_kinds WHERE id = '${spotifyReceipt.id}' AND kind = 'upcoming'`,
        ) === 1 && count(read, 'SELECT count(*) AS n FROM payments') === 0,
    },
  );

  assert.deepEqual(run.unplanned, []);
  assert.deepEqual(bySubject(run.decided), { [spotifyReceipt.subject]: 2 });
  assert.deepEqual(bySubject(run.asked), { [spotifyReceipt.subject]: 1 });
  const read = reading(home.path);
  assert.equal(count(read, 'SELECT count(*) AS n FROM invoice_payments'), 0);
  assert.equal(count(read, 'SELECT count(*) AS n FROM monthly_payments'), 0);
});

test('Ctrl-C while Jev decides an email cancels the decision request, ends ipay by the signal and stores no failure for the email', async (t) => {
  await using home = await new TemporaryFiles().directory('ipay-');
  mailStore(home.path, [careemReceipt]);
  chatStore(home.path, [careemCharge]);
  await contextCompilerSync(home.path, ['mail', 'messages']);

  const run = await running(
    t,
    home.path,
    { jev: { [careemReceipt.subject]: [{ hold: true }] } },
    {
      until: (_, stderr) =>
        stderr.includes(`decision {"subject":"${careemReceipt.subject}"`),
    },
  );

  assert.match(
    run.stderr,
    new RegExp(`cancelled decision request for ${careemReceipt.subject}`, 'u'),
    'Ctrl-C cancels the request to OpenRouter',
  );
  assert.equal(run.signal, 'SIGINT');
  assert.equal(run.code, null);
  assert.deepEqual(run.stdout, []);
  assert.deepEqual(run.asked, []);
  assert.equal(
    count(reading(home.path), 'SELECT count(*) AS n FROM email_kinds'),
    0,
  );
});
