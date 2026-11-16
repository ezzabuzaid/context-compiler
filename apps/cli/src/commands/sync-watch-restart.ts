import { Command } from './command.ts';

export class SyncWatchRestartCommand extends Command {
  readonly name = 'restart';
  readonly summary =
    'Run the background watch again, as after giving its node access';

  protected configure(): void {}

  protected async run(): Promise<undefined> {
    await this.imports.restartWatch();
  }
}
