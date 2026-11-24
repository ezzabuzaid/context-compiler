import { Command } from 'commander';

import { log } from './log.ts';
import { serve } from './serve.ts';
import { wait } from './wait.ts';

const program = new Command('notification-router').description(
  'Hands each new macOS notification to the idle Claude Code session that asked for it.',
);

program
  .command('wait')
  .description(
    "Claude Code's Stop hook (asyncRewake): record the session's last message as an open wait and print the notification that answers it.",
  )
  .action(async () => {
    try {
      process.exitCode = await wait();
    } catch (error) {
      // An async hook's failure would show in every session at every turn:
      // the router's log is where its failures go.
      log('wait-failed', { error: String(error) });
    }
  });

program
  .command('serve')
  .description('Run the router daemon. The first wait starts it.')
  .action(serve);

await program.parseAsync();
