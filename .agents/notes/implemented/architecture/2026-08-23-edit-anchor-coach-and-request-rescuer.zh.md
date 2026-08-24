# Agent Note: 编辑锚点教练与瞬态请求施救插件

Status: implemented

[English](2026-08-23-edit-anchor-coach-and-request-rescuer.md) | 中文

## 问题

对 103 个已录会话（6,883 次工具调用、368 个轮次）的日志分析显示两类主导失败。其一，`edit` 产生 369 次工具错误——200 次过期锚点（"old_string 未找到"）、45 次歧义匹配，外加路径瞎猜——而工具生硬的拒绝没给模型任何修复线索，只能反复盲试。其二，368 个轮次中约 140 个死于提供方错误；网关以 400 应答瞬态词汇（`upstream_unavailable`）会被归一化为 `INVALID_REQUEST`，任何重试策略都不覆盖，轮次随之死亡，用户只能手动推一把（49 条裸「继续」，占用户输入的 9%）。

## 决策

两个可选的函数插件，零核心改动。

`@deepseek-ai/dsh-edit-anchor-coach` 挂在 `tools/pre-execute`，在分发前用文件当前文本重新推导编辑工具自身的判定：逐字唯一则放行；逐字多处且未设 `replace_all` 则拒绝并引用行号与总数；零匹配先走空白归一化变体阶梯，再走词元最近行候选（长度小于 3 的词元永不算作特征；平分按行号稳定排序）。一次拒绝恰好等于一次「注定失败的调用」，只是错误里带上了修法——与工具本会使用的 `Error:` 通道相同，但提前一轮就有用。路径不可读、文件超大、锚点为空、参数畸形一律不做分析直接放行；这些拒绝归工具所有。

`@deepseek-ai/dsh-request-rescuer` 挂在 `agent/request-error` 上、位于确切提供方执行器上游，并先委托（`await next()`）：只对「执行器已放弃且文本匹配某条受规范化代码门槛约束的瞬态模式」的失败施救，按规则做有界带抖动退避。该设计与注册顺序无关。每次施救都在 `rescuer:` 命名空间的策略键下复用共享的 `llm/retry` / `llm/retry-started` 事件，预算从持久日志读回（计数跨重启有效），UI 沿用既有重试状态，且不引入任何新会话事件类型。

## 已考虑的替代方案

- **在编辑工具内做宽容匹配**（替模型改写锚点的阶梯）——本次否决：pre-execute 接缝在设计上排除输入改写，且静默模糊匹配可能改错地方；教练负责定位，模型负责修复。
- **放宽 `retryableCodes` 默认值** —— 否决：`INVALID_REQUEST` 确实覆盖永久性拒绝；词汇门槛的施救把放宽限定在每条提供方路由、每条已声明模式之内。
- **为施救引入新会话事件类型** —— 否决：既有重试事件已携带全部事实；第二套词汇会分裂 UI 与日志读取器。
- **自动填充空 `justification` 字段** —— 暂缓否决：pre-execute 无法改写已记录的参数；这一摩擦属于归属工具的 schema。

## 后果

注定的编辑现在返回修复地图而非死胡同；瞬态不可用的网关不再终结轮次。两个插件均为可选（profile `cordis.patch.yml` 行），附带逐文件 100% 覆盖率的行为套件，且默认惰性（`tools: ['edit']` 只针对一个工具；`patterns: []` 不施救任何东西）。

`packages/guard/edit-anchor-coach/tests/edit-anchor-coach.spec.ts` 通过真实工具注册表管线驱动临时文件；`packages/llm/request-rescuer/tests/request-rescuer.spec.ts` 用脚本化适配器驱动真实 agent loop，含对已挂载 `dsh-llm-retry` 的委托、预算耗尽与施救等待期间的取消。
