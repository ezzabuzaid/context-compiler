import { execFileSync } from 'node:child_process';
import { hash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// What sync watch reads from its environment. launchd passes on none of the
// installing shell's, so the job gets these as the install saw them: the home
// the apps' stores and this store sit under, and the Google client of
// Calendar's attachments with where its session is kept.
const inherited = [
  'HOME',
  'XDG_CONFIG_HOME',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
];

// The launchd job that keeps sync watch running for one store with no
// terminal: launchd starts it at login and again whenever it dies. Each store
// has its own job, so a store chosen with --directory never replaces
// another's. macOS charges what the job reads to the node it runs, not to a
// terminal, so that node needs the access the terminal app had.
export class BackgroundWatch {
  readonly #label: string;
  // Where the job's own errors go; its passes show in status.
  readonly log: string;
  readonly #plist: string;
  readonly #program: string[];
  readonly #domain = `gui/${userInfo().uid}`;

  // entry: the CLI's entry script, which the job runs as this process does.
  constructor(directory: string, entry: string) {
    const root = resolve(directory);
    this.#label = `com.ezzabuzaid.context-compiler.sync-watch.${hash('sha256', root).slice(0, 16)}`;
    this.log = join(root, 'sync-watch.log');
    this.#plist = join(
      homedir(),
      'Library/LaunchAgents',
      `${this.#label}.plist`,
    );
    this.#program = [
      process.execPath,
      entry,
      '--directory',
      root,
      'sync',
      'watch',
    ];
  }

  // Starts the job now and at each login, in place of the one installed
  // before: launchd refuses a label it already runs.
  async install(): Promise<void> {
    mkdirSync(dirname(this.#plist), { recursive: true });
    execFileSync(
      '/usr/bin/plutil',
      ['-convert', 'xml1', '-o', this.#plist, '-'],
      {
        input: JSON.stringify({
          Label: this.#label,
          ProgramArguments: this.#program,
          EnvironmentVariables: Object.fromEntries(
            inherited.flatMap((name) => {
              const value = process.env[name];
              return value === undefined ? [] : [[name, value]];
            }),
          ),
          KeepAlive: true,
          StandardErrorPath: this.log,
        }),
      },
    );
    // It holds the Google client secret.
    chmodSync(this.#plist, 0o600);
    await this.#stop();
    this.#launchctl('bootstrap', this.#domain, this.#plist);
  }

  async uninstall(): Promise<void> {
    await this.#stop();
    rmSync(this.#plist, { force: true });
  }

  // The node the installed job runs; undefined while none is installed.
  node(): string | undefined {
    let plist: Buffer;
    try {
      plist = readFileSync(this.#plist);
    } catch (error) {
      if (Error.isError(error) && 'code' in error && error.code === 'ENOENT')
        return undefined;
      throw error;
    }
    return execFileSync(
      '/usr/bin/plutil',
      ['-extract', 'ProgramArguments.0', 'raw', '-o', '-', '-'],
      { input: plist, encoding: 'utf8' },
    ).trim();
  }

  // Ends the job's process and takes the job out of launchd. launchd answers
  // before the process is gone and refuses the label until then, so this asks
  // again until launchd has no such job, as brew services does. It ends:
  // launchd kills a process that outlives its exit timeout.
  async #stop(): Promise<void> {
    for (;;) {
      try {
        this.#launchctl('bootout', `${this.#domain}/${this.#label}`);
      } catch (error) {
        const status =
          Error.isError(error) && 'status' in error ? error.status : undefined;
        // 3: no such job.
        if (status === 3) return;
        // 36: the removal asked for before is still in progress.
        if (status !== 36) throw error;
      }
      await sleep(100);
    }
  }

  #launchctl(...command: string[]): void {
    execFileSync('/bin/launchctl', command, { stdio: 'pipe' });
  }
}
