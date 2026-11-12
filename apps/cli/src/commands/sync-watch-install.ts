import { Command, type Output } from './command.ts';

export class SyncWatchInstallCommand extends Command {
  readonly name = 'install';
  readonly summary =
    'Keep every selected connector current in the background, from each login on';

  protected configure(): void {}

  protected async run(): Promise<Output> {
    const watch = await this.imports.installWatch();
    const node = watch.node();
    return {
      data: { node, log: watch.log },
      text: () =>
        [
          'Watching in the background, from each login on.',
          `Connectors that need Full Disk Access fail until ${node} is on in System Settings › Privacy & Security › Full Disk Access; then run this command again.`,
          `Errors: ${watch.log}`,
        ].join('\n'),
    };
  }
}
