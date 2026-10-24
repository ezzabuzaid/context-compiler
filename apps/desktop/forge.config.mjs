import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const server = resolve(import.meta.dirname, '../server/dist/server');

export default {
  outDir: 'dist/package',
  packagerConfig: {
    name: 'Context Compiler',
    executableName: 'Context Compiler',
    appBundleId: 'com.ezzabuzaid.context-compiler',
    appVersion: JSON.parse(
      readFileSync(resolve(server, 'version.json'), 'utf8'),
    ).version,
    asar: true,
    prune: false,
    // Only the bundled runtime enters ASAR; the backend's entire directory
    // remains outside it so Node and the native helpers can open real files.
    ignore: (path) =>
      path !== '' &&
      path !== '/package.json' &&
      path !== '/dist' &&
      !/^\/dist\/(host|preload|renderer)(\/|$)/.test(path),
    extraResource: [server],
    extendInfo: {
      CFBundleDisplayName: 'Context Compiler',
      NSCalendarsFullAccessUsageDescription:
        'Import the calendars you connect to Context Compiler.',
      NSRemindersFullAccessUsageDescription:
        'Import the reminders you connect to Context Compiler.',
    },
    osxSign: {
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile: () => ({ timestamp: 'none', hardenedRuntime: false }),
    },
  },
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
};
