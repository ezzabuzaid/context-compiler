import { Client, FullDiskAccess } from '@zukhruf/tcc';

import { Command, type Output } from './command.ts';

export class SyncWatchStartCommand extends Command {
  readonly name = 'start';
  readonly summary =
    'Keep every selected connector current in the background, from each login on';

  protected configure(): void {}

  protected async run(): Promise<Output> {
    const watch = await this.imports.startWatch();
    const { node, log } = watch;
    return {
      data: { node, log },
      text: () =>
        [
          'Watching in the background, from each login on.',
          // The job runs node itself, so macOS charges node, not the terminal.
          `Connectors that need Full Disk Access fail until then. ${new FullDiskAccess().remedy(Client.executable(node))} sync watch restart starts it again.`,
          `Errors: ${log}`,
        ].join('\n'),
    };
  }
}
