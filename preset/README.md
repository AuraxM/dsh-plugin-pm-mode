# 生效副本 vs 快照

这个目录里的是 **快照**，不是生效副本。

| | 路径 | 谁读它 |
| --- | --- | --- |
| **生效副本** | `%USERPROFILE%\.dsh\.agent-presets\pm\{preset.yml,agent.cordis.yml}` | dsh 名册（`agentPresets`）在会话创建时读它 |
| **快照** | 本目录 | 只有人和 `git` 读它 |

改的时候改**生效副本**，然后用 `scripts/sync-preset.mjs` 把快照刷新过来。反过来（只改快照）什么都不会发生——名册看不到这个目录。

```powershell
# 检查快照是否落后于生效副本（落后则打印 diff 并以非 0 退出）
node E:/dsh/dsh-plugin-pm-mode/scripts/sync-preset.mjs

# 用生效副本覆盖快照
node E:/dsh/dsh-plugin-pm-mode/scripts/sync-preset.mjs --write
```

## 为什么要把 preset 放进这个仓库

`pm` preset 的两半是同一个能力的两个平面，缺一不可：

- `lib/index.js`（host 平面）提供 `pmMode` 服务、看板存储、执行时间线采集器与 `/pm-mode` 面板路由；
- `lib/preset.js`（agent 平面）把 `pm_mode` / `pm_task` / `pm_agent` 注册进 PM 会话自己的 agent scope；
- `agent.cordis.yml` 里那一行 `- id: pm-tools / name: dsh-pm-mode/preset` 就是这两半的接缝。

把它作为快照放在一起，改工具面的时候能一眼看到另一半；但生效副本必须留在 `.dsh\.agent-presets\` 下——那是名册扫描根，仓库目录不在其中。

## 装一个 pm preset 需要哪几步

1. 包挂进 profile：`$DSH_HOME\profiles\node_modules\dsh-pm-mode` 指向本仓库的 Junction（包内自带 `node_modules/@deepseek-ai` 链接，因为 Junction 挂载的包解析 ESM 时会走仓库真实路径）。
2. host 行挂载：`$DSH_HOME\profiles\web\cordis.patch.yml` 里
   ```yaml
   - insert:
       - id: pm-mode
         name: dsh-pm-mode
   ```
   改完是否要重启取决于 profile 的 `patchReload`：`live`（随附的 `web` 模板就是）在校验通过后直接重组运行中的应用；`startup` 则只在启动时读一次，必须重启 `dsh web`。别盲信 live：实测遇到过一次 watcher 已注册却不生效（新路由 404、旧路由在同一 pid 上继续应答），改完务必回探 `/pm-mode/__health__` 确认落地。
3. preset 放到 `$DSH_HOME\.agent-presets\pm\`（就是本目录这两个文件的副本）。
4. 校验：`scripts/validate-preset.mjs`（36 项，必须从 profile 根目录跑）。

改 preset **不需要**重启：preset 是按会话挂载的，新开一个 PM 会话即可生效（已存在的会话仍持有旧的 standing composition）。
