import { Command } from './command.ts';

export class SyncWatchUninstallCommand extends Command {
  readonly name = 'uninstall';
  readonly summary = 'Stop keeping the connectors current in the background';

  protected configure(): void {}

  protected async run(): Promise<undefined> {
    await this.imports.uninstallWatch();
  }
}
