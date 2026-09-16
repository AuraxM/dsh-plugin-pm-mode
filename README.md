# dsh-pm-mode

PM Mode for the DeepSeek Harness: run subagent sessions as a **dispatched
project** instead of a pile of background jobs.

An agent on the `pm` preset is a **总控 (dispatcher)**: every user request goes
to **exactly one domain expert**, that expert owns the whole request (its
internal breakdown is the expert's own business), follow-up requests in the
same domain route back to the same expert, and the dispatcher alone hands out
the exclusive Unity + private-server lease. All of it is written to a board the
Web GUI renders as a **24-hour Gantt chart** plus an **expert/domain roster**.
The dispatcher does none of the work itself and stays free to answer the user
at any moment.

项目看板插件：以「派单台」方式管理子 Agent 会话 —— 一个用户诉求交给一个专家 Agent，
任务内部怎么分工由专家自己决定；领域/专家/任务/令牌状态写进看板，会话头部
「📋 项目看板」按钮打开 24 小时甘特图、任务看板、**专家（领域与负责人）**、资源令牌与统计。

## The model this board implements

Three tiers, and each tier exists for one reason:

| Tier | Depth | Owns | May delegate? |
| --- | --- | --- | --- |
| 总控 dispatcher (`pm` session) | 0 | routing, the board, the environment lease, talking to the user | yes — one expert per request |
| 专家 expert (`subagent_expert`) | 1 | one user request, end to end, inside one domain | yes — internal helpers, when it decides they help |
| 助手 helper (`subagent` scout / `subagent_fork`) | 2 | one lookup or one second opinion | no — the runtime refuses depth 3 on the scout route |

Why this replaced the older "decompose into lines" doctrine: an earlier revision
of this preset told the session to split a request into task lines and dispatch
each one. A measured run (`session-7564825d`, 2026-09-15) turned **one**
npc-movement bug into 4 lines and 6 child agents — root cause, observation prep,
environment bring-up, live baseline, then a repair line and a regression line —
while the dispatcher spent its own turns polling environment truth and relaying
notes between lines. The user's ask had been "give it to someone who knows this
area and tell me when it is done".

The three rules that came out of it, and where they are enforced:

1. **One request = one task = one expert.** Doctrine, plus `pm_task` writing the
   user's own words into `requestedBy`, plus a task model with `domainId`.
2. **A follow-up in the same domain goes back to the same expert.** Enforced by
   `pm_agent action=recommend` (a transparent scorer over declared domains) and
   by `pm_agent action=domain` / `bind role=expert` making the routing table
   durable instead of a matter of the dispatcher's memory.
3. **The environment has one issuer.** `pm_mode action=grant` / `action=revoke`
   are the dispatcher's, and the expert persona refuses to touch Unity or the
   private server without a lease.

## Why it is two halves

The plugin deliberately splits into a **host-plane row** and an **agent-preset
row**, and that split is the whole design:

| Half | Mounted by | Owns | Publishes |
| --- | --- | --- | --- |
| `lib/index.js` | the web profile's `cordis.patch.yml` (once per process) | the board store, the runtime timeline collector, the `/pm-mode` panel route, the `pmMode` service | `pmMode`, into the ROOT realm |
| `lib/preset.js` | the `pm` agent preset's composition | nothing — it registers `pm_mode` / `pm_task` / `pm_agent` into *its own agent scope* | nothing |

Two consequences, both intended:

1. **`pm_*` stays out of every other preset's tool catalog.** Tool lookup is a
   scope chain, and a preset's rows register into that preset's layer — so a
   `standard` session never sees these tools, while the storage underneath is
   still a single process-wide instance.
2. **The preset row needs no `isolate` realm.** A row that provides no service
   cannot leak one, and `pmMode` lives in the root realm precisely so a
   session-scoped row can read it. Wrapping that row in a realm would *hide*
   the service from it.

Because a delegated child joins its parent's standing composition, every expert
(and every helper an expert starts) gets the same three tools. That is intended:
an expert records its internal split as child tasks on the dispatcher's board by
passing the `boardId` it was given, so the split shows up in the panel instead
of becoming a black box.

The `pm` agent preset's composition is snapshotted under `preset/` in this repo —
see `preset/README.md` for why, and for the `scripts/sync-preset.mjs` check that
keeps the snapshot honest.

## Surfaces

| Surface | What you get |
| --- | --- |
| Session-header button | `📋 项目看板 (n) ⛔m` — active task count and blocked count, opening the drawer. |
| Gantt tab | One lane per task (with its 🧭 domain), one row per agent, bars = measured execution spans (window: 1 h / 6 h / 24 h). Segments inside a bar are individual tool calls, so a long bar reads as *what it spent the time on*. Unbound agents land in a 未归属 swimlane rather than disappearing. |
| Experts tab | One card per **domain**: its name and id, its owning expert (or a loud 无人负责), the expert's live status and delivered count, the routing keywords, and which tasks it has handled — plus the environment leases and who holds them. This is the tab that answers "who already has the context for this?" |
| Tasks tab | Kanban cards grouped by 进行中 / 需要关注 / 未开始 / 已结束, each carrying its domain chip, the user's original request, its parent line when it is an expert's internal split, phase chips with their own durations, bound agents with live status, the transition log, and 加备注 / 移除. |
| Resources tab | Exclusive leases: holder + hold time + wait queue, with 强制释放 and 转交队首 for the paths that need a human. |
| Metrics tab | Task counts, average duration, per-24-hour tool-call histogram, phase cost rollup, task-type rollup, and the most expensive tools. |
| Tool cards | A compact card per `pm_*` call with 在面板中打开. |
| Command | `/pm-mode status\|boards\|json` |

### The drawer follows the conversation on screen

A board is keyed by **session**, but the drawer is registered in
`shell.overlay` — a frame-level slot with no session prop — so the only session
it ever knew was the one whose header button opened it, and that id went into a
single `localStorage` entry (`dsh-pm-mode/session`) shared by the whole GUI.

That combination produced two confusing states: the drawer left open while the
reader moved to another conversation kept painting the PREVIOUS session's board,
and reopening it from a different conversation could land on a board with no
tasks — answered by a dead-end sentence telling the reader to run
`pm_task action=create` while the real board was busy one conversation away.

The drawer therefore reads the GUI's own `dsh.sessions.current` selection
(written by the session controller) and keeps following it:

- **following (default, `🔗 跟随会话`)** — the board on screen is always the one
  belonging to the conversation being read, re-resolved when the drawer opens
  and while it stays open across a session switch;
- **pinned (`📌 已钉住`)** — picking a board by hand (the `全部看板` list, or a
  sibling-board jump) stops the following so the choice is not yanked away; the
  badge toggles back;
- an **empty board** is answered with *where the work actually is*: the other
  boards on this machine that have tasks, one click away, instead of a dead end;
- the dispatcher's own conversation is filtered out of the Gantt's 未归属
  swimlane — the collector legitimately observes it, but drawing the reader's
  own session as an unbound subagent reads as a forgotten child process.

## Where the data comes from

Two sources, and the doctrine treats both as load-bearing:

- **Recorded by the runtime collector** (`lib/collector.js`, host plane):
  `subagent/start|end`, `agent/status`, and `session/event` `tool/call` +
  `tool/result` pairs. This is what makes "what is running now" and "how long
  did that step take" facts rather than self-reports. A 5-second reconciliation
  poll over `agents.list()` heals any gap, including an agent that started
  before the plugin mounted.
- **Written by the dispatcher and by experts through the tools**: domains and
  their owning experts, tasks (with the user's original request), statuses,
  phases, agent bindings, leases, evidence. None of this is inferable, so the
  `pm` preset's doctrine makes "update the board" part of the job rather than
  bookkeeping.

Routing is the one derived read model: `pm_agent action=recommend` scores an
incoming request against the declared domains (two-character CJK overlaps and
Latin words count 3, single shared characters count 1) and returns ranked
candidates, each with the tokens that matched, the owning expert, what that
expert currently holds, and a next-action line. It is a **scorer, not a
classifier**: the dispatcher still makes the decision and records it.

## Installation

### 1. The package

```powershell
git clone https://github.com/AuraxM/dsh-plugin-pm-mode.git E:\dsh\dsh-plugin-pm-mode
New-Item -ItemType Junction `
  -Path "$HOME\.dsh\profiles\node_modules\dsh-pm-mode" `
  -Target "E:\dsh\dsh-plugin-pm-mode"
```

A Junction-mounted package resolves ESM imports against the repository's real
path, where `@deepseek-ai/*` is **not** resolvable. This package therefore
carries its own `node_modules/@deepseek-ai` links:

```powershell
$dsh = "C:\Users\<you>\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai"
New-Item -ItemType Directory -Force "E:\dsh\dsh-plugin-pm-mode\node_modules\@deepseek-ai"
foreach ($dep in @("dsh-tools","cordis","schemastery","dsh-scope","dsh-llm","dsh-system-prompt","dsh-util-values","dsh-typert-protocol")) {
  New-Item -ItemType Junction -Path "E:\dsh\dsh-plugin-pm-mode\node_modules\@deepseek-ai\$dep" -Target "$dsh\$dep"
}
```

### 2. The host row

Append to `$HOME\.dsh\profiles\web\cordis.patch.yml`:

```yaml
- insert:
    - id: pm-mode
      name: dsh-pm-mode
```

Whether the new row mounts without a restart depends on the profile's
`patchReload`: the shipped `web` template is `live`, so `watchUserPatches` is
registered and a **valid** edit to this file recomposes the running app on the
spot (a rejected edit leaves the last good app running); a profile declaring
`startup` reads the file at boot only and needs a **restart of `dsh web`**.
(`restart-pm-mode.ps1` in `$DSH_HOME` is a one-shot detached restarter:
it records the replacement pid *before* retiring the old server and hands the
health probe to a separate process, because a restarter torn down by its own
`taskkill` otherwise never reports anything.)

### 3. The agent preset

Copy `preset/` into `$HOME\.dsh\.agent-presets\pm\`. Its board row is:

```yaml
- id: pm-tools
  name: dsh-pm-mode/preset
```

The row names a **subpath module**. The Loader's `unwrapExports` falls back to
the module namespace when there is no default export, and Cordis then applies
`namespace.apply` — so a subpath module exporting `{ apply, inject, name }` is a
complete plugin and needs no `config` channel. `inject` lives in that module
(its only possible home for a subpath row): without it the row would apply
immediately and throw on the absent `pmMode` instead of parking until the host
row provides it.

Editing the preset needs **no restart**: presets mount per session, so a new PM
session picks it up. An already-running session keeps the composition it joined.

### 4. Verify

- `GET /pm-mode/__health__` → 200 with `{"service":"pm-mode","magic":"pm-mode-ok",…}`.
- `window.__DSH_BOOT__.entries` contains id `dsh-pm-mode`.
- Refresh the browser once, then start a session on the `pm` preset and call
  `pm_task action=create`.

**Do not probe `/plugins/<id>/client.js` directly.** Every deployment plugin
404s there (doc-present and skill-panel included): the real artifacts are served
through a combo URL whose `rev` appears only in `__DSH_BOOT__` inside the
authenticated index HTML. That single path is a false-alarm generator.

## Tools

| Tool | Actions |
| --- | --- |
| `pm_mode` | `summary`, `tasks`, `experts`, `timeline`, `agents`, `resources`, `define-resource`, `grant`, `revoke`, `note` |
| `pm_task` | `create`, `update`, `phase`, `link`, `list` |
| `pm_agent` | `list`, `recommend`, `domain`, `bind`, `unbind`, `ctx` |
| `subagent_expert` | no actions — one call dispatches one expert (see below) |

The three board actions that carry the model:

- `pm_agent action=domain id=... name=... skills=[...]` declares an expertise
  area; `skills` is the routing keyword list, so it is what makes the next
  request in that area find this expert.
- `pm_agent action=bind sessionId=... taskId=... role=expert domainId=...`
  registers the expert that owns the area. Without it the domain has no owner
  and the next request in the area opens a fresh agent instead of reusing the
  context.
- `pm_mode action=grant id=unity sessionId=<expert> taskId=<task>` is the only
  way a worker gets the environment. `action=revoke` takes it back (promoting
  the queue head unless `promote: false`), and `force: true` on a grant hands it
  over in one recorded step when the previous holder has already stopped.

## The expert model is a plugin setting (and the plugin ships no model)

`subagent_expert` is the delegation the plugin performs itself, and that is
deliberate: a composition row's `agentOptions` is resolved when a session is
composed and **cannot be rewritten afterwards**, so "which model does the expert
run on" was only ever editable by hand-editing `preset/agent.cordis.yml`. The
route now lives in the plugin's own settings document
(`$DSH_HOME/pm-mode/settings.json`) and is settable from the panel:
**项目看板 → 专家 → 专家模型** (provider / model / reasoning effort / maxDepth).
The same card also sits in the **资源** tab, because that is where
deployment-level resources are configured — one component, two places, so the
setting is where either kind of reader looks for it.

> Placement is not cosmetic. This card first shipped only in 资源, and the person
> who asked for the feature could not find it — a setting nobody can find is a
> setting that does not exist.

**This plugin names no provider and no model.** An earlier revision pinned
`kimi-coding/k3/max` — one route on one machine, hard-coded into a plugin meant
to be generic. `DEFAULT_EXPERT_MODEL` is now empty on purpose, and:

- **Out of the box the route is 未配置.** The panel shows that state, the tool
  description says it, and a delegation **refuses with the way out** rather than
  guessing. A wrong guess is worse than a refusal: the operator would never learn
  their choice was not used.
- **`reasoningEffort` empty means "the model's own default"** — the field offers
  `（模型默认档）`, and an empty value is omitted from the child request rather
  than substituted, because effort ids are adapter-owned and model-specific.
- **`maxDepth` DOES ship with a value (2)**, because it is not model-specific: it
  is a property of this plugin's three-tier design (dispatcher 0 → expert 1 → the
  expert's internal helper 2). It is what stops an expert's helper from starting
  its own helper; the preset's scout/fork rows enforce the same tiering from the
  other side.
- The model catalog in the picker comes from the live LLM adapter
  (`llm.listProviders` + `llm.listModels`), and the reasoning-effort options come
  from `llm.resolveModelInfo` for the *selected* model — so the form offers what
  that model actually accepts rather than a guessed list.
- Saving is validated before it is written (`resolveModelInfo` + effort
  membership + depth range): an unresolvable route is refused while the picker
  is on screen, instead of failing in a session that starts ten minutes later.
  Clearing the route (`provider`/`model` empty) is a legitimate request and skips
  adapter resolution entirely — there is no model to ask about.
- **When it applies**: the route is read when the expert tool is registered by
  the preset — i.e. it takes effect for **newly opened sessions**. A session
  already running keeps the model it started with. The panel says so where the
  setting lives.

## HTTP surface

| Route | Purpose |
| --- | --- |
| `GET /pm-mode/__health__` | liveness probe |
| `GET /pm-mode/__api__/state?sessionId=…&windowMs=…` | one board: summary + gantt + metrics + tasks + **domains + experts** + resources + **settings** + notes |
| `GET /pm-mode/__api__/boards` | every board on disk, newest first |
| `GET /pm-mode/__api__/models` | the expert-model catalog: providers, models, the active route, and the effort ids that route accepts |
| `POST /pm-mode/__api__/manage` | panel mutations — **loopback only**; a LAN reader can view but never rewrite. Board actions plus `set-expert-model` (the plugin setting, validated against the live LLM adapter before it is written) |

## Configuration

- Board root: `DSH_HOME` (default `~/.dsh`) + `/pm-mode`, one directory per
  session holding `board.json`, written atomically (tmp + rename). The document
  is at `version: 2`; a `v1` board (no `domains`) is read as-is, so upgrading
  throws nothing away.
- Plugin settings: `DSH_HOME/pm-mode/settings.json`, a FILE beside the board
  directories (`listBoardIds()` only treats subdirectories as boards). Written
  atomically; read on every call rather than cached, so a change cannot be
  silently ignored.
- Gantt window: 1 h / 6 h / 24 h, chosen in the panel; the HTTP route clamps any
  `windowMs` to 5 min – 30 days.

## Development

```powershell
node scripts/smoke.mjs                 # 109 checks: store, domains, routing, leases, grants, settings, delegation, metrics, persistence
node scripts/check-tools.mjs           # 47 checks: compiled schemas against a real ToolRuntime, expert tool included
cd $HOME\.dsh\profiles
node E:/dsh/dsh-plugin-pm-mode/scripts/check-settings-routes.mjs  # 23 checks: the panel's settings routes over a fake llm
node E:/dsh/dsh-plugin-pm-mode/scripts/validate-preset.mjs   # 53 checks: the preset composition, its depth tiers, its doctrine
node E:/dsh/dsh-plugin-pm-mode/scripts/sync-preset.mjs       # snapshot vs live preset
```

`lib/store.js`, `lib/collector.js`, `lib/routes.js`, `lib/tools.js` and
`lib/expert*.js` import nothing from dsh except `lib/expert-tool.js`, which
imports `defineTool` (the mandatory compilation step — see trap 1). The last
three scripts must run **from the profile root**, because they resolve
`@deepseek-ai/*` and the composition's bare specifiers through the deployment's
own resolver.

Host-half changes need a profile reload: either a valid edit to the profile's
patch file on a `patchReload: live` profile, or a restart. **Do not trust the
live half blindly.** On one deployment the watcher was registered but inert —
the new `/pm-mode` route stayed 404 for 40s while the old route kept answering
on the same pid — and `watchUserPatches` throws when the Cordis HMR service is
absent, an error boot swallows. Confirm the new route answers
(`GET /pm-mode/__health__`) instead of assuming the edit took. Client-half
changes need a page refresh unless a bundle watcher is rebuilding.

## Known traps

Four failures that each cost real time, recorded so the next person does not
pay for them again.

### 1. Every tool definition MUST go through `defineTool`

`ToolRuntime.register()` validates only the OUTPUT schema. `schemaOf()` copies
`definition.parameters` **verbatim** into the schema the model provider
receives. A hand-written definition carrying the parameter DSL therefore
registers without complaint and fails at the first model call:

```
Invalid schema for function 'pm_agent':
schema must be a JSON Schema of 'type: "object"', got 'type: null'.
```

`defineTool` is the step that compiles that DSL
(`parameterSchemaSpecToJsonSchema`). This plugin shipped once with three
hand-written definitions and took the whole session down with it.
`scripts/check-tools.mjs` asserts on the **projected** schema for exactly this
reason, and carries a negative control: it registers an intentionally
uncompiled definition and asserts the projection still yields a null root type,
so a passing run cannot be a false negative.

### 2. A goal round driver and a delegating dispatcher are semantically incompatible

`dsh-goal-round-driver`'s readiness predicate is
`agent.status === "idle" && !competingQueued` — it reads `idle` as "the work is
not finished, wake it again", and injects a `<goal_round>` demanding
"make concrete progress and verify the result" while forbidding a false
completion report. A dispatcher session's `idle` between rounds is the
**correct** state: its child agents hold the work.

Measured on a real run (`session-a3fc6670`, 2026-09-15): after `create_goal` the
session was re-woken at ~10-second intervals; turns 2–5 burned 561–1325 input
tokens each doing nothing but re-reading the board and announcing there was
nothing to advance, and it eventually invented busywork (writing a token-
arbitration note) to satisfy "make progress". The one valuable round —
discovering that the Unity + private-server environment had been running with no
lease holder — happened only **after the user cleared the goal by hand**.

The `pm` preset therefore disables both goal rows (`tool-goal`,
`command-goal`). The driver, the goal service, and the GoalBar surface stay on
the host plane and are untouched: this removes the dispatcher's ability to hand
itself a goal, not the deployment's goal support. `scripts/validate-preset.mjs`
fails loudly if either row is re-enabled.

### 3. `session.vN.jsonl.zstd` is multi-frame, and `zstdDecompressSync` stops at frame one

Each line of that file is **not** one zstd frame: line 1 is a single frame
holding the session header, and the remainder is a *concatenation* of frames (a
130 KB child log carries 30). `zlib.zstdDecompressSync` returns after the first
frame, so the naive read reports `1 line, 0 events` — a full conversation that
looks empty, in a 349 KB file that appears to have no content.
`scripts/session-log.mjs` locates frame boundaries by magic bytes and verifies
each candidate by decoding from it; `scripts/read-pm-session.mjs` is the reader
built on top.

### 4. `maxDepth` is an absolute cap, and the three-tier model depends on it

`dsh-subagent` validates depth as `childDepth = delegationDepth(parent) + 1`
rejected when `childDepth > maxDepth` (`resolveChildDepth`). So the cap is not a
per-tool budget: a value of 2 means "no agent at depth 3 anywhere", whatever row
it was set on, and one uncapped row silently permits a level the others forbid
(the schema default is 3).

That matters because the dispatcher (depth 0) hands work to an expert (depth 1),
and the expert's persona promises it may split off an internal helper (depth 2).
With a cap of 2 on the EXPERT's own route that promise would be a lie: every
attempt by an expert to start a helper would be refused by the runtime while the
doctrine kept telling it to feel free. (The route's cap is 2 because the
dispatcher is depth 0 — `resolveChildDepth` counts the child, so an expert at 1
reaches 2 and a helper at 2 reaches nothing.)

The shipped arrangement is therefore deliberate and asserted in
`scripts/validate-preset.mjs`:

| Route | `maxDepth` | Reachable |
| --- | --- | --- |
| the plugin's expert tool (`lib/expert-tool.js`) | from the setting, default 2 | expert at 1, its helper at 2 |
| `tool-subagent-fork` | 2 | the dispatcher's review child at 1, an expert's second opinion at 2 |
| `tool-subagent` (scout) | 2 | a scout spawned at 2 **cannot** spawn a scout — "helpers only execute" is enforced by the runtime on this route, not merely requested by its persona |

## License

MIT
