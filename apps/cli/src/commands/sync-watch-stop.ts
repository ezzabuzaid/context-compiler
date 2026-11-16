import { Command } from './command.ts';

export class SyncWatchStopCommand extends Command {
  readonly name = 'stop';
  readonly summary = 'Stop keeping the connectors current in the background';

  protected configure(): void {}

  protected async run(): Promise<undefined> {
    await this.imports.stopWatch();
  }
}
