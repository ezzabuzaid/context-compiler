import { join } from 'node:path';

import { open } from '@zukhruf/sqlite-open';

import { importsFolder } from './places.ts';

export interface Notification {
  uuid: string;
  bundleId: string;
  deliveredAt: string;
  title: string;
  subtitle: string;
  body: string;
}

export const pingTitle = 'Notification router';

// A code expires in minutes, and a reply is read soon after it arrives.
const window = 15 * 60_000;

// cmux posts the agents' own "Claude question" notifications; the rest are macOS chores.
const noise = new Set([
  'com.cmuxterm.app',
  'com.apple.BTMNotificationAgent',
  'com.apple.wifi.usernotifications.autohotspot',
  'com.apple.controlcenter.notifications.low-battery',
  'com.apple.SoftwareUpdateNotification',
]);

/** The notifications of the last minutes, read from the Notification Center import. */
export function recentNotifications(now: Date): Notification[] {
  const database = notificationImport();
  if (database === undefined) return [];
  using db = open(database, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT uuid, bundleId, deliveredAt, title, subtitle, body FROM notifications
       WHERE deliveredAt >= ? AND deliveredAt <= ? ORDER BY deliveredAt`,
    )
    .all(
      new Date(now.getTime() - window).toISOString(),
      // Calendar stores alerts with future delivery dates (elt #5328).
      now.toISOString(),
    );
  return rows
    .map((row) => ({
      uuid: String(row.uuid),
      bundleId: String(row.bundleId ?? ''),
      deliveredAt: String(row.deliveredAt),
      title: String(row.title ?? ''),
      subtitle: String(row.subtitle ?? ''),
      body: String(row.body ?? ''),
    }))
    .filter(
      (notification) =>
        !noise.has(notification.bundleId) &&
        !notification.bundleId.toLowerCase().startsWith('_system_center_') &&
        notification.title !== pingTitle,
    );
}

function notificationImport(): string | undefined {
  using settings = open(join(importsFolder, 'settings.sqlite'), {
    readOnly: true,
  });
  const row = settings
    .prepare(
      "SELECT database FROM selected_connectors WHERE connector = 'notification-center'",
    )
    .get();
  return row === undefined
    ? undefined
    : join(importsFolder, String(row.database));
}
