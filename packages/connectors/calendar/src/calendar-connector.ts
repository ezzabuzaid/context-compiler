import {
  GMAIL_READONLY_SCOPE,
  GOOGLE_DRIVE_READONLY_SCOPE,
} from '@eltjs/google-auth/scopes';
import { CalendarStore } from '@eltjs/sdk-apple-eventkit';
import {
  AppleCalendarSource,
  type CalendarAttachmentFetcher,
} from '@eltjs/source-apple-calendar/apple-calendar-source';
import type { ImportScope } from '@eltjs/source-apple-macos/import-scope';
import {
  type Choice,
  accounts,
  collections,
  name,
} from '@workspace/connector/choice';
import { Connector, type Selection } from '@workspace/connector/connector';

export default class CalendarConnector extends Connector {
  readonly datedBy =
    'event dates (events that overlap the range; with none, every event from 2000 until a year after each import)';
  readonly fullDiskAccess = false;
  protected readonly choices: readonly Choice[] = [
    accounts(name),
    collections('calendars', 'calendars'),
  ];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(grantee: string): string {
    return `Allow ${grantee} full Calendar access when macOS asks, or in System Settings › Privacy & Security › Calendars.`;
  }

  // Calendar reads occurrences within a window: every event from 2000 to a
  // year ahead.
  override defaultScope() {
    const end = new Date(this.host.clock.Date.now());
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    return { startAt: '2000-01-01T00:00:00.000Z', endAt: end.toISOString() };
  }

  // Listing calendars leaves remote attachments as links.
  protected sources(scope: ImportScope) {
    return [this.#calendar(scope, async () => false)] as const;
  }

  // An import that stores attachments downloads those kept in Google Drive
  // and Gmail when the host offers a Google session; one that stores none
  // needs no session. The Google client loads only then, so a host without
  // one never runs it.
  protected override async importSources({
    scope,
    includeAttachments,
  }: Selection) {
    if (!includeAttachments || this.host.google === undefined)
      return this.sources(scope);
    const google = await this.host.google([
      GOOGLE_DRIVE_READONLY_SCOPE,
      GMAIL_READONLY_SCOPE,
    ]);
    const { googleCalendarAttachments } =
      await import('@eltjs/source-apple-calendar/google-calendar-attachments');
    return [this.#calendar(scope, googleCalendarAttachments(google))] as const;
  }

  #calendar(scope: ImportScope, attachments: CalendarAttachmentFetcher) {
    const window = this.defaultScope();
    return new AppleCalendarSource({
      store: new CalendarStore(this.host.eventKitHelper, {
        env: this.host.env,
      }),
      startAt: scope.startAt ?? window.startAt,
      endAt: scope.endAt ?? window.endAt,
      scope,
      attachments,
    });
  }
}
