# Notification router

When a Claude Code session ends its turn waiting for something, such as "send me the code Stripe texted you", and a macOS notification brings it, the router wakes that session with it. Ezz does not relay codes, replies or build results.

## How it runs

- **Trigger:** each Claude Code turn end runs the `Stop` hook in `~/.claude/settings.json`:

  ```json
  {
    "type": "command",
    "command": "node <repo>/apps/notification-router/dist/main.js wait",
    "asyncRewake": true,
    "timeout": 86400
  }
  ```

  `asyncRewake` runs the hook in the background while the session is idle. When the hook exits with code 2, Claude Code wakes the session with what the hook wrote to stderr. Exit code 0 ends the wait silently.

- **Wait:** `wait` sends the session id and its last message (`last_assistant_message` of the hook input) to the router over a Unix socket (`@zukhruf/pipes`, `/tmp/context-compiler-<uid>/notification-router`) and blocks. The open connection is the wait: when the session ends, or starts a new turn, the wait goes away.
- **Router:** the first `wait` starts the daemon (`serve`) when no router listens. Two that start it at once elect one (`@zukhruf/election`). It exits five minutes after the last wait closes.
- **Notifications:** every two seconds, while waits are open, the router reads the last 15 minutes of the Notification Center import (the `notifications` view of the `notification-center` connector that `cli sync watch` keeps current). It skips cmux's own notifications, macOS chores and its own pings.
- **Matching:** each new notification goes to Claude Code's harness (`@anthropic-ai/claude-agent-sdk`, `claude-sonnet-5-5`, Ezz's main Claude login) with the open waits. The call has no tools and loads none of Ezz's settings, so it cannot run the `Stop` hook itself. It returns the waits that the notification answers.
- **Delivery:** one match wakes that session with the notification, its sender app and the value it asked for. Two or more matches deliver nothing. Either way Ezz gets a macOS notification ("Sent the Stripe verification code to meddit-d7", or which sessions it could be for). A notification goes to one session once: `delivered.json` keeps that across restarts, because the woken session ends its turn again.
- **Trigger health:** while waits are open, the router reads the import's `stream_status` row of the `notifications` stream. When that stream starts failing, Ezz gets one macOS notification with the import's error, and one more when it loads again. A failure of another stream of the import (such as `categories`, elt #5528) does not blind the router and raises nothing.

## Files

- `src/main.ts`: the `wait` and `serve` commands.
- `src/wait.ts`: the hook side: reads the hook input, connects (starting the router when none listens), prints the delivery.
- `src/serve.ts`: the daemon: election, socket, shutdown.
- `src/router.ts`: open waits, routing, delivery, ties.
- `src/notifications.ts`: reads the recent notifications and the notifications stream's status from the import.
- `src/trigger.ts`: the two states of the trigger (seeing, blind), each of which tells Ezz when it ends.
- `src/judge.ts`: the matching call.
- `src/claude-sessions.ts`: reads `~/.claude/sessions/<pid>.json` for a session's name and status.
- `src/delivered.ts`, `src/ping.ts`, `src/log.ts`, `src/places.ts`, `src/protocol.ts`.

State and log: `~/Library/Application Support/Context Compiler/Notification Router` (`router.log` has one JSON line per start, stop, delivery, tie and failure).

## Limits

- A question an agent asks through an `AskUserQuestion` dialog is not covered: the turn does not end, so no `Stop` hook runs.
- The router knows only what reaches Notification Center and the import. When macOS loses its Notification Center database (it did when the disk filled up on 2026-11-24), nothing arrives until `usernoted` starts again; the trigger health ping says so.
- The trigger health check runs only while a session waits, because the router runs only then.
- Matching reads the last message of every idle session, so a vague last message can match a notification it was not waiting for. Delivered text names its sender app, and agents check it: a code that came from Script Editor instead of Messages was not used.
