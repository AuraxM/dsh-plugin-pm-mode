# dsh-pm-mode

PM Mode for the DeepSeek Harness: run subagent sessions as a **dispatched
project** instead of a pile of background jobs.

An agent on the `pm` preset is a **总控 (dispatcher)**: every user request goes
to **exactly one domain expert**, that expert owns the whole request (its
internal breakdown is the expert's own business), follow-up requests in the
same domain route back to the same expert, and the dispatcher alone hands out
the exclusive `shared-env` lease. All of it is written to a board the
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
movement bug into 4 lines and 6 child agents — root cause, observation prep,
environment bring-up, live baseline, then a repair line and a regression line —
while the dispatcher spent its own turns polling environment truth and relaying
notes between lines. The user's ask had been "give it to someone who knows this
area and tell me when it is done".

The three rules that came out of it, and where they are enforced:

1. **One request = one task = one expert.** Doctrine, plus `pm_task` writing the
   user's own words into `requestedBy`, plus a task model with `domainId`.
2. **A follow-up in the same domain goes back to the same expert.** Enforced by
   `pm_agent action=recommend` (material only — responsibilities, owners, work in
   flight; no keyword matching and no score) plus `pm_agent action=domain` /
   `bind role=expert`, which make the ownership table durable instead of a matter
   of the dispatcher's memory.
3. **The environment has one issuer.** `pm_mode action=grant` / `action=revoke`
   are the dispatcher's, and the expert persona refuses to touch a shared
   environment without a lease.

## Why it is two halves

The plugin deliberately splits into a **host-plane row** and an **agent-preset
row**, and that split is the whole design:

| Half | Mounted by | Owns | Publishes |
| --- | --- | --- | --- |
| `lib/index.js` | the web profile's `cordis.patch.yml` (once per process) | the board store, the runtime timeline collector, the `/pm-mode` panel route, the `/pm-mode` command | `pmMode`, into the ROOT realm — and **no tool, no prompt section** |
| `lib/preset.js` | the `pm` agent preset's composition | nothing | `pm_mode` / `pm_task` / `pm_agent` / `pm_memory` + `subagent_expert`, into *its own agent scope* |

Three consequences, all intended:

1. **`pm_*` stays out of every other preset's tool catalog.** Tool lookup is a
   scope chain, and a preset's rows register into that preset's layer — so a
   `standard` session never sees these tools, while the storage underneath is
   still a single process-wide instance.
2. **The host half must register nothing model-facing.** Its row is mounted by
   the profile, i.e. it runs in a root context, and a root context's
   `ctx.tools.register` writes into the process-**global** tool layer —
   `ToolRuntime.view(scope)` seeds *every* agent's visible catalog from
   `this.layers.global.tools.entries()`. Registering the toolset there publishes
   `pm_*` (and a section teaching board discipline) to every preset in the
   process. Earlier revisions of this plugin did exactly that; the symptom was a
   `standard` session listing `pm_mode` / `pm_task` / `pm_agent` / `pm_memory`
   plus the `[项目看板 pm-mode]` prompt block. Scope is the only thing separating
   the two halves, so the publishing side is the side that has one — see
   `scripts/validate-preset.mjs`, which applies both halves against stub
   contexts and fails if the host registers a tool or a section.
3. **The preset row needs no `isolate` realm.** A row that provides no service
   cannot leak one, and `pmMode` lives in the root realm precisely so a
   session-scoped row can read it. Wrapping that row in a realm would *hide*
   the service from it.

Because a delegated child joins its parent's standing composition, every expert
(and every helper an expert starts) gets the same toolset. That is intended:
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
| 经验 tab | The project's **cross-session experience memory**: every entry with its kind, tags, evidence and hit count, a filter over them, and 改正 / 删除 on each card. The agent writes them with `pm_memory`; this is where a human reads them and removes a mis-remembered one. |
| Metrics tab | Task counts, average duration, per-24-hour tool-call histogram, phase cost rollup, task-type rollup, and the most expensive tools. |
| Tool cards | A compact card per `pm_*` call with 在面板中打开. |
| Command | `/pm-mode status\|boards\|json` |

### The experience memory outlives the session that wrote it

A board is keyed by **session**, which is correct for work in flight and useless
for knowledge. A new session opens a new board, so every lesson the previous one
learned — the token that is valid only here, the ordering a subsystem requires,
the command that reports success while doing nothing — was gone with it, and the
next dispatcher re-derived it at full price.

`lib/memory.js` is the other half: entries keyed by **project**, so any PM session
in the same checkout reads and writes the same file. Three decisions carry it.

**The write gate is the feature.** The failure mode of a memory store is not that
it is empty — it is that it fills with things the model already knew, after which
nobody reads it. So the tool description, the preset doctrine and the panel all
state the same test: *delete it — would the next agent get this wrong?* If not, it
does not go in. What does: a credential valid only here, a domain's handling
pattern (the required order, the step everyone skips, the format something
downstream string-matches), a measured fact that contradicts the obvious reading,
or an already-proven conclusion with its evidence. Nothing about how a repo is
laid out or how a common tool is used, because a competent agent arrives at those
unaided.

**Only the dispatcher reads it, and nothing is injected.** No expert tool consults
the store, and no `pm_memory` entry is copied into a task book automatically. The
dispatcher recalls what it wants and decides whether a briefing should carry it.
A subagent that never sees the store cannot be misled by a stale entry, and the
store keeps exactly one reader whose queries are visible in the session log.

**A wrong entry must be cheap to remove.** A memory that outlives its session also
outlives its truth. So `forget` exists, the panel puts 删除 on every card, and an
entry with no `evidence` is flagged in place — an entry nobody can re-check is an
entry the next session has to take on faith.

**Which project, and why the rule is "outermost marker".** A session's identity is
its working directory, resolved upward to the **topmost** directory holding a
marker. Nearest-marker would fragment a monorepo: the root, each package, and
every nested `.git` would get its own memory, so a lesson learned in a root
session would be invisible one directory down. Outermost keeps the whole checkout
as one project, which is the granularity a dispatcher actually reasons at, and it
degrades safely — a session started deep inside a subtree still finds its
repository. `~` is never a project, and neither is whatever `DSH_HOME` points at.

The marker vocabulary has to cover the version control an agent actually meets,
and it shipped once WITHOUT the one this deployment uses. The checkout at
`E:\workflow\Project-Atom-Game-xiangliming-trunk` is a **Perforce** workspace —
`p4config.txt` + `.p4env` + `.p4ignore`, no `.git`, no `package.json`, no language
manifest anywhere — so it resolved to nothing and `pm_memory` refused every write
in the directory the dispatcher was working in. A memory tool that cannot file
anything in the main working directory is worse than no memory tool: it is a
feature that reports failure forever. The list now covers P4 alongside
git/hg/svn/jj, the language and build manifests, editor workspaces (`*.sln`,
`*.code-workspace`, `.vscode/`), and the weakest signals (`*.uproject`,
`.gitignore`, `.envrc`). A marker whose mere existence proves nothing —
`package.json`, `p4config.txt`, the pnpm files — must actually carry content.

Two rules keep that generous list from becoming a liability:

- **A project the walk cannot recognize can still be NAMED.**
  `resolveNamedProject` answers a different question than
  `resolveProjectIdentity`: "which project did I name" (obey) versus "where am I"
  (guess). A caller passing `project=<绝对路径>` has identified the project itself,
  so a directory with no marker of ours is filed under exactly that path instead
  of being refused. Naming a *subdirectory* of a known project still lands on the
  project, and naming a home directory is still refused. Guessing stays
  conservative — an unidentified cwd gets **no** memory rather than one shared
  bucket — because guessing wrong files a session's lessons under somebody else's
  project.
- **`.dsh/project.json` with a `name` overrides everything**, which is how a
  project the marker list will never know declares itself.

The files are plain JSON under `$DSH_HOME/pm-mode/memory/` — `index.json` for the
registry, one document per project — written atomically and read on every call, so
a human can open, edit, or delete one in an editor and the panel stays a thin
layer over the same bytes rather than a second source of truth.

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

Three sources, and the doctrine treats all of them as load-bearing:

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
- **Written by the dispatcher into the project's experience memory**
  (`lib/memory.js`, `pm_memory`): the lessons that must outlive the session that
  learned them. Recorded by hand rather than inferred, for the same reason as the
  board — and gated on being non-obvious, because a memory full of the obvious is
  a memory nobody reads.

Routing is the one derived read model, and it deliberately does not decide:
`pm_agent action=recommend` returns **material** — every domain with its prose
responsibility, its owner and that owner's work in flight, the experts that own no
domain yet, the registered subagents the board has not bound to a task, and the
resource leases. The dispatcher reads it and makes the call.

That is a correction, not an omission. An earlier revision scored the incoming
request against a `skills` keyword array (two-character CJK overlaps and Latin
words worth 3, single shared characters worth 1) and printed the matched tokens
and a confidence next to ranked candidates. The score was a lexical accident
standing where a judgement belongs, and it pushed whoever maintained a domain into
writing keyword soup so the matcher would fire. The plugin now reports what it
knows and lets the model reason; `scripts/check-tools.mjs` asserts that the
description promises material rather than a matcher.

## Installation

### 1. The package

This package is a **profile bundle**: `package.json` declares
`dsh.bundle.patch`, and `cordis.patch.yml` inserts the host row. One command
installs it into a profile — it links the package, registers the bundle and
enables the row — and the change applies immediately through HMR:

```
plugin_manager action=install_bundle target=E:\dsh\dsh-plugin-pm-mode
```

Do not write the profile's `package.json` or `cordis.patch.yml` by hand, do not
Junction the package into `$DSH_HOME\profiles\node_modules`, and do **not**
hand-build a `node_modules/@deepseek-ai` junction farm inside this repository.

> **Why the old Junction method broke on Desktop 0.2.0:** a Junction-mounted
> package resolves its `@deepseek-ai/*` peers against
> `$DSH_HOME\profiles\node_modules`, which the Desktop module resolver treats as
> an **obsolete fallback** and rejects. That farm pointed at a
> `AppData\Roaming\npm` install which the Desktop app does not use, so those
> links also resolved to a stale `0.1.5-rc.1` generation.
> `install_bundle` links the package under the profile instead, so `cordis`,
> `dsh-tools`, `schemastery`, `dsh-scope`, `dsh-llm`, `dsh-system-prompt`,
> `dsh-util-values` and `dsh-typert-protocol` all resolve from the app's own
> install.

Whether the new row mounts without a restart depends on the profile's
`patchReload`: `install_bundle` applies live in this deployment (`application:
applied`), so no restart is needed to mount the row. A **code** change inside
this directory still needs a process restart, because Node's ESM module cache
holds the old generation for the same specifier.
(`restart-pm-mode.ps1` in `$DSH_HOME` is a one-shot detached restarter:
it records the replacement pid *before* retiring the old server and hands the
health probe to a separate process, because a restarter torn down by its own
`taskkill` otherwise never reports anything.)

### 2. The host row

Supplied by `cordis.patch.yml` in this package — nothing to append by hand:

```yaml
- insert:
    - id: pm-mode
      name: dsh-pm-mode
```

To change the row, override it by id in the profile's `cordis.patch.yml` (a
matching override replaces the whole `config`).

### 3. The agent preset

Supplied by the second patch file this bundle declares — nothing to copy by
hand:

```yaml
# presets/pm.patch.yml
- insert:
    - id: preset-pm
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: pm
        order: 9
        plugins: [ ...the dispatcher composition... ]
```

On Desktop 0.2.0 a preset **is an ordinary composition row**: a
`@deepseek-ai/dsh-agent-preset` entry whose `config.plugins` is the child list,
exactly how `@deepseek-ai/dsh-web-app` ships `presets/*.patch.yml`. The
`$DSH_HOME/.agent-presets/<id>/` directory this package originally targeted is a
0.1.x-era convention that **nothing reads any more** — which is why the preset
picker showed no `pm` mode even with the plugin row active and the host half
working.

`presets/pm.patch.yml` is GENERATED from `preset/agent.cordis.yml` (the
snapshot `scripts/sync-preset.mjs` keeps in step with the old live copy):

```sh
node scripts/build-preset-patch.mjs          # regenerate
node scripts/build-preset-patch.mjs --check  # fail if stale
```

Edit `preset/agent.cordis.yml` and regenerate; never hand-edit the patch file.

Inside that list the board row is:

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

Adding or editing the preset row needs a **process restart**, because a bundle's
patch files are composed when the profile loads (only the profile's own
`cordis.patch.yml` is watched). Once loaded, a preset mounts per session, so a
new PM session picks it up and an already-running session keeps the composition
it joined.

### 4. Verify

- the row `include:pm-mode` reports `enabled: true, fiberPhase: "active"` and
  `Config.listConfigs name=@deepseek-ai/dsh-agent-preset` lists a
  `include:preset-pm` entry (`plugin_manager action=list_plugins`),
- the preset picker on a **new** session offers `总控模式`,
- `pm_mode action=summary` answers with a board summary — that single call
  proves the host service, the tool row and the store are all live, and
- `GET /pm-mode/__health__` → 200 with
  `{"service":"pm-mode","magic":"pm-mode-ok",…}`.

**Do not probe `/plugins/<id>/client.js` directly.** Every deployment plugin
404s there (doc-present and skill-panel included): the real artifacts are served
through a combo URL whose `rev` appears only in `__DSH_BOOT__` inside the
authenticated index HTML. That single path is a false-alarm generator.

Board data lives under `$DSH_HOME\pm-mode`, not inside the plugin package, so
reinstalling the bundle leaves every existing board and memory entry in place.

## Tools

| Tool | Actions |
| --- | --- |
| `pm_mode` | `summary`, `tasks`, `experts`, `timeline`, `agents`, `resources`, `define-resource`, `grant`, `revoke`, `note` |
| `pm_task` | `create`, `update`, `phase`, `link`, `list` |
| `pm_agent` | `list`, `recommend`, `domain`, `bind`, `unbind`, `ctx` |
| `pm_memory` | `remember`, `recall`, `list`, `update`, `forget` |
| `subagent_expert` | no actions — one call dispatches one expert (see below) |

The three board actions that carry the model:

- `pm_agent action=domain id=... name=... skills=[...]` declares an expertise
  area; `skills` is the routing keyword list, so it is what makes the next
  request in that area find this expert.
- `pm_agent action=bind sessionId=... taskId=... role=expert domainId=...`
  registers the expert that owns the area. Without it the domain has no owner
  and the next request in the area opens a fresh agent instead of reusing the
  context.
- `pm_mode action=grant id=shared-env sessionId=<expert> taskId=<task>` is the only
  way a worker gets the environment. `action=revoke` takes it back (promoting
  the queue head unless `promote: false`), and `force: true` on a grant hands it
  over in one recorded step when the previous holder has already stopped.
  The resource id is caller-chosen and stored verbatim — declare yours with
  `action=define-resource`, and note that ids already on a board keep working
  as-is (no migration, no error).

## The expert model is a plugin setting (and the plugin ships no model)

`subagent_expert` is the delegation the plugin performs itself, and that is
deliberate: a composition row's `agentOptions` is resolved when a session is
composed and **cannot be rewritten afterwards**, so "which model does the expert
run on" was only ever editable by hand-editing `preset/agent.cordis.yml`. The
route now lives in the plugin's own settings document
(`$DSH_HOME/pm-mode/settings.json`) and is set in **DSH 设置 → 专家模型**
(provider / model / reasoning effort / maxDepth). The board panel's **专家** tab
carries the same form — one component, both surfaces — so the setting is also
where someone already reading the board reaches for it, and the **资源** tab
keeps it beside the leases.

> Placement is not cosmetic, and this setting has now moved twice for the same
> reason. It first shipped only in 资源, and the person who asked for the feature
> could not find it. It moved to 专家, and the case that broke was different: the
> board panel is only reachable from a session header, so a **fresh session had
> no way to configure the route before its first dispatch** — the one moment the
> setting is actually needed. A deployment-level value belongs in DSH Settings;
> the panel keeps the in-context copy.

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
- **When it applies**: per DELEGATION. The tool description is written at session
  composition (so the dispatcher reads the route that session will use), but the
  value itself is read through `pmMode.expertModel()` on every `subagent_expert`
  call — so a save applies to the next expert started anywhere, with no restart
  and no new session. An expert already running keeps the model it started with.
  The save's confirmation says exactly this.

## HTTP surface

| Route | Purpose |
| --- | --- |
| `GET /pm-mode/__health__` | liveness probe |
| `GET /pm-mode/__api__/state?sessionId=…&windowMs=…` | one board: summary + gantt + metrics + tasks + **domains + experts** + resources + **settings** + notes |
| `GET /pm-mode/__api__/boards` | every board on disk, newest first |
| `GET /pm-mode/__api__/models` | the expert-model catalog: providers, models, the active route, and the effort ids that route accepts |
| `GET /pm-mode/__api__/memory` | one project's experience memory (`?sessionId=…` resolves that board's project, `?project=<key\|绝对路径>` names one directly; `q` / `kind` / `limit` filter) |
| `POST /pm-mode/__api__/manage` | panel mutations — **loopback only**; a LAN reader can view but never rewrite. Board actions, the memory writes (`memory-remember`, `memory-forget`, same store methods the tool uses), plus `set-expert-model` (the plugin setting, validated against the live LLM adapter before it is written) |

## Configuration

- Board root: `DSH_HOME` (default `~/.dsh`) + `/pm-mode`, one directory per
  session holding `board.json`, written atomically (tmp + rename). The document
  is at `version: 2`; a `v1` board (no `domains`) is read as-is, so upgrading
  throws nothing away. A board also records the session's **project** (`projectKey`
  / `projectRoot`), which is what the 经验 tab reads to find its memory — resolved
  from the agent's own cwd on every `open()`, never from the harness process's.
- Experience memory: `DSH_HOME/pm-mode/memory/`, a directory INSIDE the board
  root so `listBoardIds()` skips it for free (it reports a directory as a board
  only when its `board.json` reads). `index.json` is the project registry and
  `<key>.json` one project's entries; both written atomically and plain enough to
  hand-edit.
- Plugin settings: `DSH_HOME/pm-mode/settings.json`, a FILE beside the board
  directories (`listBoardIds()` only treats subdirectories as boards). Written
  atomically; read on every call rather than cached, so a change cannot be
  silently ignored.
- Gantt window: 1 h / 6 h / 24 h, chosen in the panel; the HTTP route clamps any
  `windowMs` to 5 min – 30 days.

## Development

```powershell
node scripts/probe-memory.mjs            # 47 checks: project identity, the write/read/forget paths, pruning, ranking
node scripts/smoke.mjs                 # 125 checks: store, domains, dispatch material, leases, legacy ids, settings, delegation, metrics, persistence
node scripts/check-tools.mjs           # 66 checks: compiled schemas against a real ToolRuntime, expert tool and the memory write gate included
node scripts/check-client.mjs          # 55 checks: the inlined bundle stays in sync with its modules, token-only colours, the model picker, a poll that stays silent, the 经验 tab's delete path
node scripts/check-terms.mjs           # vocabulary: no project-specific term outside the two documented allowances
cd $HOME\.dsh\profiles
node E:/dsh/dsh-plugin-pm-mode/scripts/check-settings-routes.mjs  # 39 checks: the panel's settings AND memory routes over a fake llm
node E:/dsh/dsh-plugin-pm-mode/scripts/validate-preset.mjs   # 72 checks: the preset composition, its depth tiers, its doctrine, that the memory reaches both halves, and the two-half boundary (the host row registers no tool and no prompt section)
node E:/dsh/dsh-plugin-pm-mode/scripts/sync-preset.mjs       # snapshot vs live preset (`--mirror` publishes a repo-side change)
```

`lib/store.js`, `lib/collector.js`, `lib/routes.js`, `lib/tools.js`, `lib/memory.js`
and `lib/expert*.js` import nothing from dsh except `lib/expert-tool.js`, which
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

Node caches the host modules for the process lifetime, so a restart is the only
reliable path — and **doing it wrong takes the server down**, which is what
happened here three times before the shape was fixed. The rule is that nothing
involved in the restart may wait inside the server's own process tree:

1. **Never block in the turn that requests the restart.** A `Start-Sleep` (or any
   poll) in the requesting tool call is a child of the server being restarted, so
   it dies with it — the turn is interrupted, the outcome never observed, and a
   reload that actually WORKED reads as a failure. This is the mistake that made
   three restarts look broken.
2. **Never launch the restarter as an ordinary child process.** `Start-Process`
   still lands inside the harness's job object, so a `taskkill` of the tree (or
   the harness retiring a timed-out turn) kills the restarter mid-flight — with
   the server already stopped. That is the real hazard: not a failed reload, an
   outage. Use `$HOME\.dsh\reload-pm-mode-safe.ps1`, which hands the restarter to
   WMI (`Win32_Process.Create`, running as SYSTEM outside every job object this
   process owns), returns immediately, and lets that detached process do the
   stop → wait-for-port → start → verify sequence.
3. **Read the outcome from a FILE on a later turn**, never by waiting now:
   `$HOME\.dsh\pm-mode-safe-restart-status.txt` holds `PASS` / `PARTIAL` / `FAIL`
   plus the new pid, and `pm-mode-safe-restart.log` holds the sequence. The
   wrapper CLEARS the status file before queueing, so a stale `PASS` can never be
   read as this run's result.

The verification probe matters as much as the mechanics: `-ExpectTag` must be a
string only the NEW code emits (`projectKey` for the memory work), because the
health endpoint and the old routes answer identically before and after a reload —
a tag the old build also produces makes the check pass while proving nothing.

## Known traps

Six failures that each cost real time, recorded so the next person does not
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
discovering that a shared environment had been running with no
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

### 5. A resolved project is `{key, root}`; passing the key alone loses the root

The experience memory is keyed by project, and a resolved project has TWO halves:
the `key` that names its document, and the `root` it was derived from. Passing
only the key — which looks completely natural, since the key is what every
message and the panel display — makes the store re-derive a key FROM the key, and
the project that was just handed to it becomes unfindable.

This shipped broken three ways at once, and all three were found by the route
test rather than by reading the code:

- `memory.remember(identity, { project: identity.key })` — the key went in as an
  OVERRIDE, so the store re-resolved a project whose document did not exist yet.
  That is the ordinary FIRST write, and it was refused;
- `routes.js` built `{key, root}` and then passed `project: project.key`, with the
  same effect;
- `memory.view(resolved.key)` dropped the root on the read path, so `GET
  /__api__/memory?project=<path>` answered 500 for a directory that resolved
  perfectly one line earlier.

The guard that makes this class of bug impossible is in `projectFor`: an
identity arriving with a key and NO root must already exist on disk, and a key
that cannot be found is an ERROR rather than a silent fall-through to a derived
key. Silence is what made all three survive review — a write that quietly lands
in a document nobody ever reads looks exactly like a successful write.

### 6. A row the PROFILE mounts is a root context, and its tools are global

The two-half split was written down long before it was true. `lib/index.js`
mounted by the profile's patch layer ran in a root context, and it registered the
whole `pm_*` toolset plus a `[项目看板 pm-mode]` prompt section from there. Both
landed in the process-**global** layer — `ToolRuntime.view(scope)` starts from
`new Map(this.layers.global.tools.entries())` and only then stacks the scope
chain — so EVERY preset in the process saw them:

- a `standard` session listed `pm_mode` / `pm_task` / `pm_agent` / `pm_memory`;
- its system prompt carried the dispatcher doctrine, i.e. instructions to update
  a board and honour a `shared-env` lease for tools the same session may or may
  not have;
- and the same four tools were registered TWICE in a `pm` session (global layer +
  preset scope). That duplicate is what made it survivable and therefore
  invisible: scoped registrations shadow globals, so nothing errored, and the
  redundant registration had no effect on the only preset that was supposed to
  have it. A second registration that changes nothing is the signature of this
  bug — the only sessions it affects are the ones it was never meant to reach.

`tools.restrict()` is the other direction to look for (a per-agent `deny` solves
the symptom for one preset at a time); the fix here is structural instead: the
host row registers nothing and its `inject` no longer names `tools` or
`systemPrompt`, so it cannot read either registry even by accident. Which side
publishes is decided by scope: only the preset row has one.

`scripts/validate-preset.mjs` applies BOTH halves against stub contexts and fails
if the host registers a tool or a section — a source-text assertion would not
have caught the original, because the original looked deliberate.

## License

MIT
