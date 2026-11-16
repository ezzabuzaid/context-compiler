import { hash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  type AbsolutePath,
  Launchd,
  ServiceNotFoundError,
  isAbsolutePath,
} from '@zukhruf/launchd';

// What sync watch reads from its environment. launchd passes on none of the
// starting shell's, so the job gets these as the start saw them: the home
// the apps' stores and this store sit under, and the configuration folder
// that holds the Google client of Calendar's attachments and its session.
const inherited = ['HOME', 'XDG_CONFIG_HOME'];

// The launchd job that keeps sync watch running for one store with no
// terminal: launchd starts it at login and again whenever it dies. Each store
// has its own job, so a store chosen with --directory never replaces
// another's. macOS charges what the job reads to the node it runs, not to a
// terminal, so that node needs the access the terminal app had.
export class BackgroundWatch {
  readonly #label: string;
  // Where the job's own errors go; its passes show in status.
  readonly log: AbsolutePath;
  // The node the job runs, which needs the access the terminal app had.
  readonly node = process.execPath;
  readonly #program: [string, ...string[]];

  // entry: the CLI's entry script, which the job runs as this process does.
  constructor(directory: string, entry: string) {
    const root = resolve(directory);
    if (!isAbsolutePath(root))
      throw new Error(`${root} is not an absolute path.`);
    this.#label = `com.ezzabuzaid.context-compiler.sync-watch.${hash('sha256', root).slice(0, 16)}`;
    this.log = `${root}/sync-watch.log`;
    this.#program = [this.node, entry, '--directory', root, 'sync', 'watch'];
  }

  // Runs the job now and at each login, in place of a changed one started
  // before; an unchanged job that launchd runs stays as it is.
  async start(): Promise<void> {
    await this.#agents().install({
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
    });
  }

  // Ends the job's process and runs it again, as after a change of the
  // access its node has.
  async restart(): Promise<void> {
    try {
      await this.#agents().service(this.#label).kickstart({ kill: true });
    } catch (error) {
      if (error instanceof ServiceNotFoundError)
        throw new Error(
          'No background watch runs for this store. Run sync watch start.',
          { cause: error },
        );
      throw error;
    }
  }

  // Ends the job and removes it, so nothing runs it at login.
  async stop(): Promise<void> {
    await this.#agents().service(this.#label).uninstall();
  }

  // This user's agents, looked up only by the commands that change the job.
  #agents() {
    return Launchd.agents({ clock: globalThis });
  }
}
