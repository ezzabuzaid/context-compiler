# Ambient

A local, one-way observer. Context Compiler warehouse changes reach the model automatically; it decides whether there is something useful to say. The output is a notification feed with no chat input. There are no topic rules or predefined business triggers.

This implements the inference architecture of [Proactive Agent (ICLR 2025)](https://arxiv.org/abs/2410.12361): timestamped observations, prior decisions, optional evidence gathering, then assistance or silence. It is a **prompt-based notification adaptation**, not a reproduction of the paper's fine-tuned model, learned acceptance judge, action executor, or benchmark scores. Prompt wording here is original. The inspected upstream revision is `3fcf9beebe256b86871659fbb12541c41c9381b9` ([inference implementation](https://github.com/thunlp/ProactiveAgent/blob/3fcf9beebe256b86871659fbb12541c41c9381b9/gym/components/activeagent.py)).

[Horvitz's attention-sensitive alerting](https://www.erichorvitz.com/priorities.pdf) informs urgency, attention and repetition in the prompt. [ProAgentBench](https://arxiv.org/abs/2602.04482) informs chronological replay without future observations. These are design influences; no calibrated interruption-cost policy is claimed.

## Run

The model is **GPT-6-Luna**, through the Codex provider of `@deepagents/experimental` and your ChatGPT login of Codex (`~/.codex/auth.json`, or `CODEX_HOME/auth.json`). Run `codex login` once if you have no login. `src/model/gpt-6-luna.ts` holds the model id. Each change of the warehouse is one turn, so Ambient uses Luna, not Sol, to keep the quota of the subscription.

From the Context Compiler root:

```sh
npx nx run ambient:typecheck
npx nx run ambient:test
node apps/ambient/dist/server.js
```

Open `http://127.0.0.1:4325`. `AMBIENT_PORT` changes the port; it is the only environment variable that Ambient reads. Ambient reads the warehouse in Context Compiler's Imports folder, `~/Library/Application Support/Context Compiler/Imports`. It keeps its private runtime state (the SQLite stores, the disk-backed PGlite queue and the changefeed positions) in `~/Library/Application Support/Context Compiler/Ambient`, which it creates with mode 0700. The app binds only to loopback.

Ambient takes Deepagents 7.4.0 from npm: `@deepagents/experimental` 7.4.0 gives `defineAgent` its `stopWhen`. No framework fork is copied here. Microsandbox 0.7.8 must be installed on an Apple Silicon Mac or Linux host with KVM. The state folder has one named microVM, `ambient-<the first 16 hex digits of the SHA-256 of the state folder path>`, with no network and no host mounts. `msb ls` shows it. Each turn re-attaches to it by name. The microVM keeps its files across restarts; Microsandbox stops it but does not remove it. Remove it with `msb rm <name>`. Each test runs Ambient with its own temporary home, thus its own state folder and its own microVM, so the tests never attach to the microVM of a running Ambient.

## Warehouse input

The existing DataVersion watcher detects changes to selection without requiring WAL for settings. The worker follows the databases named by the published `selected_connectors` view in `settings.sqlite`. Selection changes start and stop subscriptions automatically. There is no event POST endpoint and no hand-authored input envelope.

`@zukhruf/sqlite-changefeed` owns detection and position files. Each selected source's feed keeps its position in a `PositionFile` and starts with a `Baseline`: the first pass keeps a fingerprint of each existing row and gives no events, so the rows that were there before Ambient first followed a source never become turns (the real warehouse holds about 7.7 million). Later passes emit `insert`, `update`, `delete`, or `truncate`, and a `read` for each row of a table that appears later; all native tables and payloads pass through. Each SQLite integer arrives as a `bigint`, and the journal keeps its exact digits as a string. Source name and an application evidence ID accompany each change. The agent can query the warehouse to interpret those facts.

The feed requires WAL databases. The destination of elt writes each import with persistent WAL. Thus the feed can read the imports. Ambient does not change source database settings. An unreadable or non-WAL selected source fails the process instead of leaving a healthy-looking listener that receives nothing.

This is snapshot-based change data capture: it captures net differences between passes, not every intermediate transaction. Checks run once a second. Position files in the `positions` folder of the state folder allow offline catch-up; the package acknowledges a batch only after Ambient has durably handed its events to Zukhruf. At-least-once delivery means an interrupted batch can repeat. The journal reuses the latest identical row event's evidence identity, while subsequent value changes receive new identities.

`GET /notifications` returns the persistent feed and cited evidence. `GET /decisions` exposes each received native change, its outcome and any failure. `GET /health` reports process readiness, not model health.

## Execution and boundaries

1. Record native warehouse changes and enqueue through Zukhruf. `PgBossTurnQueue` owns FIFO execution, pending work and crash recovery; PGlite persists the queue on disk.
2. `SqliteContextStore` owns chronological conversation history and `SqliteStreamStore` owns resumable turn output. Native compaction triggers above 24,000 estimated input tokens and targets 12,000, using the same model. Native rows are not silently truncated or filtered. Four SQL reads may return at most 6,000 bytes of evidence per turn. A single row larger than the model context remains an inference failure recorded in the audit.
3. One `defineAgent` declaration uses `sources`, `query`, and `notify`, plus Zukhruf's native sandbox and collaboration primitives. No subagents are declared. `stopWhen: [hasToolCall('notify'), isStepCount(6)]` and the 90-second model timeout are passed to the native agent loop. Microsandbox provides Bash and file tools inside the isolated VM. Warehouse access remains a host-side read-only tool.
4. The changes plugin projects terminal streams into the application ledger. A single valid `notify` result commits one notification; invalid or multiple notification results produce no delivery. Finishing without `notify` records silence. Zukhruf's completion hook performs this without an output subscriber; initialization also projects any completed work left by a previous process. The tiny unlinked-change handoff closes a crash between recording an event identity and obtaining its native queue receipt; it never executes inference.
5. The changes plugin owns only source subscriptions and hands inference to the native worker. There is no application mutex or inference drain loop. [Files](#files) says where each part lives.

The persistent native history includes assistant/tool messages; it replaces the previous manually assembled recent-observation and notification snapshots. The replay retains the same eight fictional facts and fixed model, now committed through real warehouse tables. One calendar insert precedes them, after each source took its baseline. Native change representation and history differ from the earlier manual-event replay. Audit failures use the native stream error text, which can redact a tool exception to “An error occurred.”

There is no separate decision model call or structured decision output. The notification tool accepts only the message and evidence IDs needed for delivery. `GET /decisions` retains its audit shape; its reason describes whether the agent called `notify`, rather than requesting a model-written justification. Deepagents owns context rendering, the tool loop, and native repair of malformed tool arguments. Repair can make an additional model request on invalid arguments; it is not an unconditional decision pass.

Citation validation proves that a source was received, not that every claim follows from it. Model usefulness, factual grounding, timing, and semantic repetition still need evaluation. The interrupted-handoff test verifies replay of a captured initial row without resampling. General exactly-once delivery across arbitrary schema changes and crashes is not claimed. Suppression of equivalent discoveries from different changes remains model-driven. Warehouse queries read current data. Historical evaluation must supply a warehouse snapshot containing only information available at that point. SQL reads are synchronous; the SQLite timeout is a lock-wait timeout, not a query execution deadline.

The installed `just-bash@3.2.0` package, transitively exposed by Deepagents' root types, references unpublished `security/` and `transform/` declarations. This app uses `skipLibCheck`, as the Deepagents checkout does, while checking its own source strictly. This dependency packaging issue is separate from observer behavior.

## Files

`src/` follows the layout of Zukhruf (`@deepagents/experimental/zukhruf`). The Zukhruf parts are at the root:

- `agent.ts`: the `defineAgent` declaration. It uses the fixed GPT-6-Luna model for inference and compaction and owns the changes plugin.
- `instructions.ts`: the prompt, as `defineInstructions`.
- `sandbox.ts`: the named Microsandbox microVM of the state folder, as `defineSandbox`.
- `stack.ts`: the infrastructure, as `defineStack`: the PGlite queue, the SQLite stores and the plugin bindings. It finds the state folder and the warehouse under the home folder. It also exports the state folder path, which `sandbox.ts` uses for the microVM name.
- `run.ts`: the `AgentRuntime` of the declaration.
- `server.ts`: the top-level process. It initializes the runtime, starts its worker, serves HTTP on `AMBIENT_PORT` and owns shutdown.
- `plugins/changes/`: the changes plugin, in the layout of Zukhruf's own `plugins/<name>/`. `index.ts` is the plugin definition: it follows the warehouse and enqueues each change. `services.ts` is the capability that `stack.ts` binds. `projection.ts` projects terminal turn streams into the journal. `read-budget.ts` holds the per-turn read limits. `tools/notify.ts`, `tools/sources.ts` and `tools/query.ts` are the plugin's tools, one `defineTool` each. Each file default-exports a function that returns its tool, because the tool needs the plugin's bindings (the warehouse and the read budget).

The other parts are in folders by concept:

- `model/gpt-6-luna.ts`: the fixed model, through the ChatGPT login of Codex.
- `warehouse/warehouse.ts`: reads the selected sources and runs read-only federated SQL. `warehouse/follow-warehouse.ts`: follows each selected source's changefeed and the selection.
- `journal/journal.ts`: the application ledger of changes, turns, decisions and notifications. `journal/tables.ts`: its schema.
- `contracts/`: the shared shapes: `evidence.ts`, `notification.ts` and `decision.ts`.
- `http/app.ts`: the routes. `http/feed-page.ts`: the notification feed page.

`channels/`, `connections/`, `schedules/`, `skills/` and `subagents/` are Zukhruf's reserved declaration slots. They are empty. Ambient has no `tools/` folder at the root, because Zukhruf keeps it for tools that `agent.ts` imports. The tools of Ambient come from the changes plugin.

## Evaluate

The tests are black-box. Each test makes a temporary home with a real warehouse in its Imports folder (a `settings.sqlite` and WAL imports). Then it starts `src/server.ts` as a child process with only `HOME`, `MSB_HOME` (the developer's Microsandbox home, which holds the runtime and the images), `CODEX_HOME` (the developer's Codex home, which holds the ChatGPT login) and a free `AMBIENT_PORT`. It reads the results through `GET /health` and `/decisions`. Everything runs for real, GPT-6-Luna included, so the tests need a ChatGPT login of Codex and use its quota. The model decides freely, so the tests assert only what Ambient does around a decision: which changes become turns, and that each turn ends in a recorded decision or failure. Each test stops its child process, removes its temporary home and removes its microVM.

These behaviors have no test, because each needs a model answer that the real model does not give on demand: invalid citations fail closed; several `notify` calls in one step deliver nothing; warehouse reads stay read-only, and the queried evidence reaches the notification; a queued change cannot see later evidence, and a turn stops at six steps; a `bash` call runs inside the microVM.

The optional live replay uses only fictional warehouse writes and an isolated warehouse. It runs only when `AMBIENT_REPLAY_OUTPUT` names its report file:

```sh
AMBIENT_REPLAY_OUTPUT=/absolute/path/replay.json npx nx run ambient:test
```

The replay records every decision, latency, expected author label, and notification. It includes routine activity, two cross-source situations, repeated information, prompt injection, and a warehouse lookup opportunity. It checks that every committed case produces a terminal audit result. Restart and redelivery assertions run in the normal tests. Expected labels are reported for inspection rather than enforced as flaky assertions. It is a smoke evaluation, not a published benchmark or user acceptance study.

The app-scoped ESLint rules reject direct low-level agent/context construction, the old mutex, and alternate sandbox providers. Each Zukhruf part has one file: `defineAgent` in `agent.ts`, `defineInstructions` in `instructions.ts`, `defineSandbox` in `sandbox.ts`, `defineStack` in `stack.ts`, `AgentRuntime` in `run.ts`, and `defineTool` in `plugins/<name>/tools/`. They run in `ambient:typecheck` with the existing lint target.
