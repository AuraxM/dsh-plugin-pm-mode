# preset/ —— pm preset 组合的快照

这个目录里的 `agent.cordis.yml` 是 **pm（总控）preset 的源文件**。它不是被
运行时直接读取的副本；运行时读的是由它**生成**的 composition row：

```
preset/agent.cordis.yml  --(scripts/build-preset-patch.mjs)-->  presets/pm.patch.yml
```

`presets/pm.patch.yml` 由 `package.json` 的 `dsh.bundle.patch` 声明，安装 bundle
时被 profile 组合成一行 `@deepseek-ai/dsh-agent-preset` 记录（id `preset-pm`），
preset picker 里的「总控模式」由此而来。

> 历史注意：`$DSH_HOME\.agent-presets\pm\` 是 0.1.x 时代的约定，**0.2.0 起没有任何
> 东西读它**。旧脚本 `scripts/sync-preset.mjs`（跟那个死目录对拍）已删除；现在的
> 防漂移检查是：

```powershell
node scripts/build-preset-patch.mjs --check   # 快照与生成物不一致时非 0 退出
```

## 改动流程

1. 编辑 `preset/agent.cordis.yml`；
2. `node scripts/build-preset-patch.mjs` 重新生成 `presets/pm.patch.yml`；
3. **重启 DSH**：bundle 的 patch 文件在 profile 加载时才组合（只有 profile 自己的
   `cordis.patch.yml` 被 watch）。preset 按会话挂载，重启后新开 PM 会话生效；
   已在跑的会话保持它加入时的组合。

## 为什么把它放进这个仓库

`pm` preset 的两半是同一个能力的两个平面，缺一不可：

- `lib/index.js`（host 平面）提供 `pmMode` 服务、看板存储、执行时间线采集器与
  `/pm-mode` 面板路由；**它不注册任何工具或提示段**——host 作用域的注册是全局的，
  会把 `pm_*` 漏进其它 preset 的会话（`scripts/validate-preset.mjs` 有哨兵断言）；
- `lib/preset.js`（agent 平面）把 `pm_mode` / `pm_task` / `pm_agent` / `pm_memory` /
  `subagent_expert` 注册进 PM 会话自己的 agent scope；
- `agent.cordis.yml` 里那一行 `- id: pm-tools / name: dsh-pm-mode/preset` 就是
  这两半的接缝。

把组合快照放在仓库里，改工具面的时候能一眼看到另一半。
