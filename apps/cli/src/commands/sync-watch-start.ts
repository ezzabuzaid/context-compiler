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
          `Connectors that need Full Disk Access fail until ${node} is on in System Settings › Privacy & Security › Full Disk Access; then run sync watch restart.`,
          `Errors: ${log}`,
        ].join('\n'),
    };
  }
}
