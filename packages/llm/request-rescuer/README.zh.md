# @deepseek-ai/dsh-request-rescuer

[English](README.md) | 中文

与「确切提供方重试策略」并列的第二次机会执行器：在 agent loop 的 `agent/request-error` waterfall 上它先委托（`await next()`），只有当确切提供方执行器放弃——失败的规范化代码不在任何已配置的 `retryableCodes` 内——才用配置的瞬态模式去核对失败自身的词汇。网关以 400 应答 `upstream_unavailable` 会被归一化为 `INVALID_REQUEST` 并直接杀死轮次；匹配的模式会以有界、带抖动的退避施救并返回 `{ kind: 'retry' }`。每次施救都在共享的 `llm/retry` / `llm/retry-started` 事件上以 `rescuer:` 命名空间的策略键持久化，因此预算从会话日志读回（计数跨重启有效），UI 也展示与策略重试相同的重试状态。

## 配置

```yaml
- id: request-rescuer
  name: '@deepseek-ai/dsh-request-rescuer'
  config:
    patterns:
      - match: 'upstream[_ -]?(unavailable|error)'  # regex source, case-insensitive, tested against "code message"
        codes: ['INVALID_REQUEST']                  # optional gate on normalized codes; empty means any
        maxRetries: 4                               # per request coordinate (turn+step+provider+rule)
        initialDelayMs: 1000                        # backoff floor; doubles per attempt
        maxDelayMs: 20000                           # backoff ceiling
```

`patterns` 默认 `[]`——出于选择而不作为，绝不猜测。每个条目在加载时响亮失败：`match` 无法编译、界限非整数或小于 1、或 `initialDelayMs` 大于 `maxDelayMs`。规则按顺序求值；第一个匹配的规则拥有该失败。

## 链语义

- **先委托。** 施救者在行动前等待下游决策：确切提供方执行器会重试的失败（或任何更靠后的监听者会恢复的失败）绝不会被重复调度。该设计与注册顺序无关——两个执行器无论以何种顺序挂载，施救者只对被放弃的失败行动。
- **持久预算。** 先前尝试通过扫描会话日志中同一 `turn`/`step`/`provider` 下属于该规则策略键的 `llm/retry` 事件来计数；重试链在其全部尝试间保持一个稳定的 `retryId`。
- **配合取消。** 施救等待将轮次信号与插件生命周期融合；被中止的等待不再调度任何东西，并保留原始失败。
- **无词汇即无施救。** 不匹配任何模式（或模式的 `codes` 门槛）的失败原样通过——配置错误无法把重试范围扩大到已声明词汇之外。

## Model Experience

### 已调度的施救

#### 模型看到什么

什么也看不到：施救走与策略执行器相同的非表层 `llm/retry` / `llm/retry-started` 状态事件，重试后的尝试像任何策略重试一样开启新的编号步骤。

#### Token 影响

每次施救零模型可见 token；重试后的请求携带不变的对话。

#### KV Cache 影响

失败尝试的前缀保持可复用；重试以其热身回放。

## 已知限制与暂缓事项

- **与词汇耦合** —— 模式匹配提供方措辞；网关改写其瞬态词汇需要更新配置。
- **AUTH 需显式开启** —— 自动重试认证失败会掩盖真正过期的密钥，因此默认模式不针对它们。
- **仅按坐标预算** —— 没有跨步骤熔断；一条每步都失败的路由每次都会在 `maxRetries` 内施救。
- **不切换提供方** —— 施救仍指向同一路由；改投他处是 LLM 接缝的路由决策，不是本插件的。
