---
description: "面向用户与维护者的 pi-ai 多提供方适配器说明：通过 pi-ai 目录与手工声明网关路由 harness LLM 服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-pi-ai

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-pi-ai` 是 harness LLM 服务基于 pi-ai 的多提供方适配器：一个插件实例拥有一份提供方路由字典，每条路由都通过 [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) 服务。点名已安装 pi-ai 提供方的路由会继承其端点、协议格式与模型目录作为默认值；pi-ai 不提供的路由可以直接声明，因此 OpenAI 兼容网关或自托管服务器只是配置，而非代码变更。profile 与凭据通过可选 settings 与凭据 seam 按请求解析，因此编辑用户设置文档即可改变下一个请求，无需重启。提供登录的提供方可以通过 harness 授权 seam 登录，存储的登录——OAuth grant，或在 pi-ai 自己的登录提示里键入的密钥——为其路由完成认证，并在存储的跨进程锁下自行刷新。插件可以零路由休眠挂载，一旦 settings 分节提供 profile 便立即激活它们。

## 目录

<<<<<<< HEAD
按提供方配置凭据、模型 catalog 与部署特定传输设置，并以提供方路由本身为键。每个 profile 都可以设置 `retryPolicy`；省略时使用 normal 模式并在两个延迟阶段重试十次。`apiKeyEnv` 是按请求解析的凭据*引用*，因此机密不进入该文件。省略它会让该路由处于未认证状态；对已安装 catalog 路由而言，这意味着交给 pi-ai 的提供方原生环境发现。已配置却解析不出任何值的引用则相反，会让请求以 `MISSING_CREDENTIAL` 失败，因为放行下去就会用环境里恰好持有的某个无关密钥完成认证。一条凭据服务该路由下的全部模型。
=======
- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当组合需要通过 pi-ai 的提供方目录、或通过 pi-ai 已安装目录未描述的网关路由模型请求时挂载本插件。`providers` 字典就是整个配置面：每个键都是请求用 `GenerateOptions.provider` 选择的提供方路由名。

### 何时选择

当同一组合服务多个提供方、某条路由需要 pi-ai 目录默认值并修正少数字段、或必须通过自有端点与协议到达手工声明网关时，选择本适配器。当部署不需要其他提供方时，选择 `dsh-llm-deepseek` 直连 DeepSeek 路由。两个适配器可以同时挂载，因为它们的路由名不冲突；注册其他适配器已拥有的路由会导致插件加载失败。

### 配置提供方路由

每个 profile 都可以设置 `retryPolicy`；省略时使用 normal mode、最多重试五次。`apiKeyEnv` 是按请求经 harness 凭据 seam 解析的凭据引用，因此配置文件绝不包含密钥；解析为空的引用会让请求以 `MISSING_CREDENTIAL` 失败。省略它会让路由保持已配置但无密钥（configured-but-keyless）状态，对已安装目录路由而言即交由 pi-ai 提供方原生的环境发现。
>>>>>>> upstream/master

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      openai:
        apiKeyEnv: OPENAI_API_KEY
        baseURL: https://proxy.example.com:8443
        reasoning: high
        requestImagePixelBudget: 4194304 # total pixels; 2048 by 2048 default
        requestImageMaxBytes: 1048576    # raw bytes before base64 expansion
        maxRequestImageBytes: 20971520   # accumulated base64 payload
        retryPolicy:
          mode: normal
          maxRetries: 3
      anthropic:
        apiKeyEnv: ANTHROPIC_API_KEY
<<<<<<< HEAD
        timeoutMs: 60000
        streamIdleTimeoutMs: 60000
=======
>>>>>>> upstream/master
        models:
          - id: claude-sonnet-4-5
            contextWindow: 200000
      acme-gateway:
        displayName: Acme Gateway
        apiKeyEnv: ACME_GATEWAY_API_KEY
        api: openai-completions
        baseURL: https://gateway.acme.example/v1
        compat:
          thinkingFormat: deepseek
        models:
          - id: acme-think
            name: Acme Think
            contextWindow: 262144
            reasoningEfforts:
              off:
              high: high
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyEnv` | 无 | 按请求解析的凭据引用；省略时交由 pi-ai 环境发现 |
| `displayName` | 提供方名 | 选择器界面显示的标签 |
| `api` | 目录协议 | 协议格式；仅目录不提供的路由需要 |
| `baseURL` | 目录端点 | 路由上所有模型的端点 |
| `models` | 已安装目录 | 整体替换路由目录；每个条目从已安装模型取默认值 |
| `modelOverrides` | 无 | 重塑个别已安装目录模型，而不替换其余模型 |
| `compat` | 目录检测 | 无法识别端点的协议兼容开关 |
| `defaultContextWindow` | `262,144` | 未描述模型的容量回退 |
| `defaultMaxTokens` | `32,768` | 未描述模型的输出上限回退 |
| `requestImagePixelBudget` | `4,194,304` | 每张确定性请求图片的总像素预算 |
| `requestImageMaxBytes` | `1 MiB` | 每张请求图片在 base64 扩展前的编码字节目标 |
| `maxRequestImageBytes` | `20 MiB` | 带最旧优先卸载的 base64 图片载荷总上限 |
| `retryPolicy` | normal，5 次重试 | 由 `dsh-llm-retry` 执行的提供方自有重试策略 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llm-pi-ai)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 登录提供方

pi-ai 提供登录的提供方可以通过 harness 授权 seam 登录：流程提供 OAuth 或交互式密钥提示（密钥键入 pi-ai 自己的登录提示，而非设置表单），得到的凭据存储在 harness 凭据存储的 `llm-pi-ai/<provider id>` 记录中。存储的登录在其路由的 `apiKeyEnv` 覆盖之下完成认证，并在存储的跨进程锁下自行刷新；退出登录即删除存储记录。落在记录文法之外——小写连字符标识符——的手工声明路由键无法登录，因为对它的记录写入会以 `LlmError('UNSTORABLE_PROVIDER_ID')` 拒绝；这类路由改用 `apiKeyEnv` 或提供方 ambient 设置认证。

### 解析模型目录

profile 的 `models` 列表会替换而非扩展路由的已安装目录；每个条目从同 id 已安装模型取未设置字段的默认值，因此把路由收窄到两个模型、修正一个容量或添加比已安装目录更新的模型都是一行编辑。`modelOverrides` 无需该代价即可重塑个别已安装目录模型——修正一个模型，保留其余三十七个——当它与 `models` 列表并存、位于手工声明路由上、或点名目录未描述的模型时会被拒绝，因为静默不变的模型会成为别人日后寻找的拼写错误。

### 带推理与协议兼容运行

`reasoningEfforts` 声明模型可选择的 thinking 等级：每个键都是选择器提供的等级，其值是该等级过线的拼写，因此 `max: ultra` 可以为拥有自有词汇的网关重命名等级。省略该字段时保留已安装目录条目的能力；`false` 声明非推理模型。对于 pi-ai 无法识别的端点，`compat` 开关重塑请求——哪个角色携带系统提示词、哪个字段限制输出、thinking 等级如何传递——可逐路由、逐模型配置。条目与已安装目录都没有尺寸的模型，会采用路由的 `defaultContextWindow` 与 `defaultMaxTokens` 回退值。

### 运行时更改配置

profile 通过可选 settings seam 每次操作重新读取：base 与用户的 `llm-pi-ai:` 设置分节按提供方合并，因此用户可以新增路由、覆盖组合路由的一个字段或把路由指向另一个代理，全部在下一个请求生效、无需重启。适配器无法服务的分节会在写入处被拒绝——`settings.mutate` 回答 `settings-rejected`——之后失效的已存储分节会保留 namespace 最后有效值。当路由集合或某路由的重试策略变化时，插件会原子地重新注册：冲突路由会让此前路由继续服务。

### 从端点发现模型

插件会回答"该提供方可以提供哪些模型？"，供配置界面正在编辑或起草的路由使用。已安装目录提供的路由直接由目录回答，不发网络请求；只有目录未描述的路由才会经网络询问（`openai-completions` 与 `openai-responses` 形状）。回答是界面可以提供给用户采纳的候选元数据——不存储任何内容，`settings.yaml` 仍然是决定路由服务内容的唯一事实。

### 失败与恢复

pi-ai 不提供的路由需要 `api`、`baseURL` 与非空 `models` 列表；无法服务的 profile 会在写入处被拒绝，并点名路由与模型。失败携带稳定 code：无法使用的凭据以 `INVALID_CREDENTIAL` 失败并点名路由与引用，`apiKeyEnv` 引用解析为空的路由以 `MISSING_CREDENTIAL` 失败，未配置模型以 `UNKNOWN_MODEL` 失败，终止性提供方失败则区分 `QUOTA` 与暂时性 `RATE_LIMIT`。`GenerateOptions.stop` 以 `UNSUPPORTED_OPTION` 被拒绝，因为 pi-ai 的通用流式 UI 无法跨提供方保证它。

<<<<<<< HEAD
路由完全无法服务时解析仍会失败得响亮，并点名出问题的路由与模型：catalog 未提供的路由需要 `baseURL`，以及一个由唯一标识的模型组成的非空 `models` 列表。该解析在分节 schema 内部运行，因此无法服务的 profile 会在**写入之处**被拒绝——`settings.mutate` 以 `settings-rejected` 点名路由与模型——而不是先存下来、再悄悄让该 namespace 下每条路由失效。对于已经存下的、在此失败的分节，settings seam 会保留该 namespace 上一份可用值，因此这不会把部署卡死。`api` 接受 `supportedProtocols()` 中的协议；一旦点名，就会固定该路由上每个模型的协议。两个 catalog 都不认识的模型依然能解析出线协议，无需重述任何内容：路由选择 → 该 id 的已安装 catalog 或身份 catalog 答案 → 该路由所有已发布模型一致同意的协议 → 前一个 catalog 可描述的同级模型 → OpenAI 兼容网关默认值（`openai-completions`），与端点询问所用的假设一致。因此从列表端点采纳的最新发布模型可以立即服务；而解析出不一致协议的手工声明路由必须点名 `api`，因为 provider 构造每条路由只绑定一个实现。
=======
-----
>>>>>>> upstream/master

<a id="understand-the-implementation"></a>
## 理解实现

<<<<<<< HEAD
`baseURL` 设定该路由下每个模型的端点，因此仍支持 `https://proxy.example.com:8443` 等私有 proxy。省略它的 catalog 路由会保留每个 catalog 模型自己的端点；该模型条目与提供方条目都未描述的 id——从端点实时列表采纳的最新发布——会在已安装同级模型所声明的 API 挂载点上服务：取其中最短且携带版本号的写法，若所有写法都不带版本号，则为两种 OpenAI 形状的协议挂载到 `/v1`，因为这些客户端按字面使用 base。提供方声明的或路由配置的 `baseURL` 按字面采用。在 catalog 路由上点名 `api` 会把整条路由改指到该协议，这正是部署把某个提供方在 Responses 与 Chat Completions 之间迁移的方式。
=======
<details>
<summary>实现细节——点击展开</summary>
>>>>>>> upstream/master

本节解释适配器背后的设计；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

适配器建立在不可变快照与按操作解析之上。每个操作都会在第一次 `await` 前捕获整个快照——profile 加一个持有每条路由所构建 `Provider` 的 `createModels()` 集合——配置变更会构建新集合而非修改使用中的集合，因此在一个配置下开始的请求绝不会在另一个配置下结束。路由自己的凭据引用经 harness seam 解析，并以请求 `apiKey` 选项传入，pi-ai 将其视为优先级最高的 auth 覆盖——这正是快速失败（fail-loud）引用语义的所在。该覆盖未覆盖的一切都经集合自身的 auth 到达 pi-ai：凭据存储持有登录写入、刷新轮换的记录（以 `llm-pi-ai/<provider id>` 寻址），auth context 回答提供方解析时提出的 ambient 问题。两者跨快照保持稳定，因此配置变更重建集合时不会忘记谁已登录。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：profile 解析、settings 接线、目录与路由注册 |
| [`src/auth.ts`](src/auth.ts) | 覆盖 harness 凭据平面的凭据存储与 ambient auth context |
| [`src/login.ts`](src/login.ts) | 面向提供登录的已安装提供方的授权流程 |
| [`src/config.ts`](src/config.ts) | Profile schema、解析与可服务性校验 |
| [`src/catalog.ts`](src/catalog.ts) | 已安装目录集成与漂移门禁 |
| [`src/provider.ts`](src/provider.ts) | 受支持协议表与提供方构建 |
| [`src/context.ts`](src/context.ts) | Harness 到 pi-ai 的上下文转换、图片处理、回放恢复 |
| [`src/stream.ts`](src/stream.ts) | 把 pi-ai 事件转换为 harness `StreamChunk` 值 |
| [`src/replay.ts`](src/replay.ts) | 带版本的 `ReplayEnvelope` 存储与校验 |
| [`src/discovery.ts`](src/discovery.ts) | 面向配置界面的端点询问 |

### 注册与目录

插件会在可配置提供方目录中声明它能认证的每个已安装目录提供方，并加入当前 profile 声明的每条路由，因此配置界面可以在任何路由存在之前提供完整目录。每个条目都携带 `declared`——pi-ai 是否在该键下不提供任何内容——因为只有适配器能区分手工声明路由与收窄目录路由。路由注册具有原子性：与其他适配器冲突的候选集合会让此前路由继续服务。零路由的裸挂载即休眠姿态：settings 分节提供 profile 前不注册任何内容，分节清空时路由随之消失。

<<<<<<< HEAD
受支持的 profile 字段是 `apiKeyEnv`、`displayName`、`api`、`baseURL`、`models`、`modelOverrides`、`compat`、`defaultContextWindow`、`defaultMaxTokens`、`defaultInput`、`headers`、`reasoning`、`thinkingBudgets`、`cacheRetention`、`transport`、`timeoutMs`、`websocketConnectTimeoutMs`、`streamIdleTimeoutMs`、`maxRequestImageBytes`、`replayMode` 和 `retryPolicy`。`replayMode` 默认为 `native`；`portable` 会把 assistant 历史转换为与提供方无关的内容，并省略 response id 与原生块签名。每个 profile 的重试策略都会与该提供方路由一同捕获；省略时对暂时性失败执行两个延迟阶段、最多十次的有界重试。HTTP 请求超时与流空闲间隔都必须是正的有限 Node 定时器延迟，且均默认为一分钟；空闲时间只覆盖未完成提供方读取。`maxRequestImageBytes` 约束单个请求的 base64 图片载荷（默认 20 MiB）；超限时从最旧图片开始替换为文本占位。若已配置标头中有同名项，则以 Harness 应用归因为准。
=======
### 回放与词汇
>>>>>>> upstream/master

成功 assistant 响应会存储带版本的、无损 JSON 回放状态，与产生它们的提供方和模型放在一起——响应级事实加每个流式块一条逐块条目。请求时，`LlmRuntime` 仅当同一适配器实例拥有两条路由时才传递回放状态；适配器校验它并恢复原生响应 id 与提供方签名，无法使用的状态会降级为提供方无关内容而不是让请求失败。pi-ai 工具调用参数是解析后的对象，因此适配器解析输入并重新字符串化输出，以符合 harness 原始 JSON 约定；pi-ai 流内错误事件映射为终止 `finish` 分片。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从服务约定逐步进入孪生适配器与共享类型。

- [dsh-llm 服务](../llm/README.zh.md)——本适配器注册其上的提供方无关服务。
- [llm-deepseek 适配器](../llm-deepseek/README.zh.md)——`deepseek-official` 路由的 DeepSeek 直连孪生。
- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md)——`StreamChunk` 协议与适配器约定。
- [llm-retry](../llm-retry/README.zh.md)——应用每个 profile `retryPolicy` 的重试执行器。
- [孪生 LLM 适配器](../../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.zh.md)——为什么 DeepSeek 路由交付两个结构不同的适配器。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llm-pi-ai)——每个受支持配置字段及其源声明。

<<<<<<< HEAD
多数列表只公布 id；`context_window`/`context_length` 与 `max_output_tokens`/`max_tokens` 在网关提供时会被读取，没有可用 id 的条目会被跳过而不是让整份列表失败，其余仍由采纳方补齐。每个候选还会携带参考 catalog 对该确切 id 的了解：先查已安装 pi-ai catalog、再查共享身份 catalog 的输入模态与思考级别，外加回答“是否有 catalog 描述过它”的 `catalogMatched` 标记。配置界面会把这些显示为徽标，并把图像能力写入采纳的行；推理保持由解析层负责，因为其线上拼写属于适配器词汇。两个 catalog 都未描述的 id 也能顺利采纳——解析会回退到路由自身的协议事实（见 Catalog resolution）——所以端点一列出未收录的模型即可选用。回复在四兆字节上限下读取，且上限落在实际收到的字节上——端点是用户自己填的 URL，因此会先看声明长度，但绝不把它当作边界。端点不可达、凭据被拒、响应非 JSON、以及响应没有 `data` 数组，都会以 `DISCOVERY_FAILED` 失败，消息点名端点；仅当 401 或 403 时才点名凭据。读取响应体期间被取消会呈现为 `ABORTED`，与请求发出之前被取消一致。

## 提供方／模型路由与回放

每次解析产出一份**不可变**快照——profiles 加上一个持有各路由所建 `Provider` 的 `createModels()` 集合——每个操作都在自己第一个 `await` 之前整体捕获一份快照。配置变化会构造**新**集合，而不是改动正在被使用的那个：`Models.streamSimple()` 是惰性的，它在流首次被消费时才解析 provider，而那已在 credential await 之后，因此改动共享集合会让一个在旧配置下开始的请求在新配置下结束，或者撞上一个已不存在的 provider。这正是 seam 的每步调用冻结（`llm.prepareCall()`）能贯通到底的原因——回复途中切换模型会在下一步生效，绝不会影响在途的那一步。请求经 `Models.streamSimple()` 抵达提供方。保持 catalog 协议不变的 catalog 路由会**复用**已安装提供方，只替换其模型列表，因为该提供方持有本包无法重建的 API 实现——Bedrock 经由独立入口加载其 Smithy 模块——从零件重建会静默收窄可用提供方的范围。其余路由都由 `createProvider()` 基于 `supportedProtocols()` 背后的协议表构造，表中条目正是 pi-ai 自己的提供方工厂所用的同一批 factory。

凭据绝不进入该集合。harness 在请求抵达 pi-ai 之前经自身 seam 解析路由密钥，并作为请求的 `apiKey` 选项传入，而 pi-ai 将其视为优先级最高的 auth 覆盖；因此 `Models` 不持有任何凭据存储，harness 也保住了自己明确失败的引用语义。没有点名任何凭据的路由会解析为「已配置但无密钥」，把该要求留给协议——那才是它真正所在的位置。

所选模型 descriptor 提供协议实现。这包括原生 API 差异，例如 descriptor 使用 Responses API 而非 Chat Completions 的 OpenAI 模型；harness 适配器不会按模型名称硬编码端点选择。

成功的 assistant 响应会将经版本化的无损 JSON 回放状态与生成该响应的提供方和模型一同存储，其形式是 `ReplayEnvelope`：一个响应级半区（kind、版本、API、路由、响应 id、原生停止原因），加上每个流式块一条、携带该块 signature 的逐块条目。逐块对齐正是 `BlockAssembler` 在组装丢弃某个块（`max-tokens` 下的工具调用）时裁剪的对象，因此存储的条目始终描述存储的内容——保留的块保有其 signature。请求时，`LlmRuntime` 只有在历史提供方路由与目标提供方路由当前由同一个 `PiAiAdapter` 实例拥有时，才会传递回放状态。即使目标提供方或模型改变，适配器也会验证状态并恢复 pi-ai 响应 id 与提供方 signature；随后由 pi-ai 判定目标 API 可以复用哪些元数据。没有回放状态的历史会被转换为外来的、与提供方无关的内容，绝不伪装为原生 pi-ai 响应。

持久化内容是权威记录；回放状态只负责恢复原生保真度。当前构建无法使用的已存状态——其他适配器的 kind、其他版本（包括旧日志携带的平铺前信封形式）、格式错误的元数据、消息与回放状态之间的提供方／模型不匹配，或内容／块不匹配——会把这一条 assistant 消息降级为同样的外来提供方无关转换而不是让请求失败，插件通过其 `onReplayDegrade` 钩子记录 `INVALID_REPLAY_STATE` 诊断。

## 词汇差异

- pi-ai 工具调用参数是已解析对象；harness 存储原始 JSON 字符串。适配器会解析输入，并将输出重新字符串化。
- pi-ai 将失败报告为流内错误事件；它们会映射到 `finish {kind:'error'|'aborted', failure}` 分片。提供方特定错误文本会区分终止型 `QUOTA` 与暂时型 `RATE_LIMIT` 和 `SERVER`，包括在 HTTP 400 下报告 `upstream_unavailable` 的网关；HTML 网关错误会缩减为 HTTP 状态与标题，而不会作为文档显示。针对已解析模型上下文窗口评估的文本与 usage 信号则将溢出规范化为 `CONTEXT_WINDOW_EXCEEDED`。终止时的 `stop` 若消息不含内容块，则会映射为 `finish {kind:'error'}`，code 为 `EMPTY_RESPONSE`（默认策略会重试），而非成功空消息。
- pi-ai 将推理 token 折叠到输出 usage 中；没有可映射的独立推理计数。
- pi-ai 的 `off` 思考级别会原样穿过 Harness 能力 seam，并在分派时变为被省略的 pi-ai 通用 `reasoning` 选项。
- `GenerateOptions.stop` 会以 `UNSUPPORTED_OPTION` 被拒绝，因为 pi-ai 的通用流式输出接口无法保证所有提供方都支持它。

## 应用归因

每个请求都携带 dsh-llm `attributionHeaders()` 的共享归因标头，并通过 pi-ai `headers` 流选项合并。不会合成提供方特定应用归因标头。详见 [dsh-llm § 应用归因](../llm/README.md#app-attribution-attributionts)。

## 依赖体量

pi-ai 会安装多个提供方 SDK，并延迟加载 catalog 模型所选的 SDK。该可选适配器包将依赖体量隔离在自身范围内。
=======
-----
>>>>>>> upstream/master

<a id="model-experience"></a>
## 模型体验

### 经 pi-ai 的提供方请求

#### 模型看到什么

所选目录模型会收到 `GenerateOptions.system`、历史、工具与 pi-ai 通用流式 API 支持的采样字段。每张保留图片前都会有文本，注明其完整附件 id 与实际请求尺寸。当前执行文件系统可以映射附件提供方的宿主对象时，该文本还会携带只读规范化对象路径，并警告规范化或请求投影可能缩放或重新编码上传内容。当累计 base64 图片载荷超过路由的 `maxRequestImageBytes` 时，每张卸载图片都会在替换文本中保留自己的身份与当前已解析访问方式。卸载的规范化附件不会读取或变换。提供方原生回放元数据只在适配器针对历史内容校验通过后恢复。

#### Token 影响

提供方分词决定精确输入。保留图片会添加稳定的附件与尺寸描述符；卸载占位符会替代省略图片的视觉 token。回放元数据可能让原生 API 复用提供方侧状态。

#### KV Cache 影响

转换保持逻辑请求顺序，图片句柄与卸载占位符则会添加模型可见文本。即使附件身份与请求字节保持稳定，执行世界路径变化也会改写历史句柄，并可能从该图片起阻止复用。更换适配器实例、提供方、模型或其他上游 token 具有相同的后缀影响。越过图片上限会把较早图片替换为占位文本，因此复用在该消息处结束，直到被卸载前缀稳定。

### 提供方响应

#### 模型看到什么

pi-ai 事件变成 harness 的推理、文本、工具调用、用量与 finish 分片。适配器把解析后的工具参数以原始 JSON 字符串传给 harness。

#### Token 影响

生成内容只在 loop 记录后才影响后续输入。提供方未单独报告推理 token 时，pi-ai 会把推理 token 并入输出用量，并原样保留其精确 `totalTokens` 值。

#### KV Cache 影响

已记录的响应内容会追加到下一个请求，不会使其更早可复用前缀失效。未记录的传输元数据与用量计量不影响缓存标识。

## 已知限制与延期工作

<<<<<<< HEAD
- **`maxRequestImageBytes` 只统计 base64 图片载荷**：文本、工具与 JSON 结构不计入上限，因此该值必须低于网关请求体上限并留出余量。offload 在请求转换时决定，是历史与配置的纯函数，不记录为会话事件；由按路由能力元数据（图片数量、单图大小、请求总大小）同时驱动准入与组装的完整设计属于暂缓工作。
- **仅以 OAuth 认证的提供方不予提供**：pi-ai 的 OAuth 只从*已存储*的 OAuth 凭据解析，而本适配器构造 `Models` 集合时不注入凭据存储、也不运行登录流程，因此这类路由的每个请求都会在发出之前以 `Provider is not configured` 失败。可配置提供方目录因此不列出它们；已安装 catalog 中只有 `openai-codex` 属于此类。settings 文档已经写过的路由仍保留目录条目，配置界面据此可以编辑或删除；`apiKeyEnv` 也仍能用该密钥完成认证——对 Codex 而言那是一个会过期、且这里没有任何环节会去刷新的 token。
- **提供方自带的凭据发现只读进程环境**：不指定凭据的路由交由 catalog 提供方自行解析，而它探测的是环境变量（`AZURE_OPENAI_API_KEY`、`AWS_PROFILE`、`AWS_ACCESS_KEY_ID` 以及各提供方自己的那一组）。它不读任何本地凭据目录，因此只有 `~/.aws/credentials` 而未导出 `AWS_PROFILE` 会被解析为未配置；由 harness 凭据 seam 保管的值，除非进程环境里也有，否则对它不可见。
- **settings 能新增或覆盖路由，但不能移除组合路由**：用户层合并在组合 `base` 之上，因此删除 `cordis.yml` 提供的提供方属于组合变更；对该 namespace 执行 `replace` 只会重置用户层。
- **分层合并对字典键没有删除语义**：settings seam 把组合 `base` 与用户层按键递归合并，因此 base 声明的某个 `reasoningEfforts` 档位、`modelOverrides` 条目或 `compat` 字段，用户层只能覆盖、无法移除——而 `reasoningEfforts` 里缺席本身*就是*语义（「不提供」），于是 base 声明过的档位会一直被提供。只有 `cordis.yml` entry config 为用户层正在编辑的同一模型声明了按模型推理字段才会触发；受支持的姿态是把这些字段留给 settings 文档（shipped 组合以 dormant 方式挂载该适配器），且 `models` 列表是数组、整体替换，这是带内的解决办法。
- **`headers` 可能承载一条脱敏器看不见的凭据**：profile 的 `headers` 是纯字符串字典，因此设在其中的 `Authorization` 或 `api-key` 会被脱敏后的 `describe()` 原样返回，并被任何配置 UI 渲染出来。请把凭据存为 `apiKeyEnv` 引用；把该字典整体改为只写与其余[协议边界工作](../llm/README.md#known-limitations-and-deferred-work)一并暂缓。
- **路由的 catalog 不会自我刷新**：catalog 就是 `settings.yaml` 所写的内容，因此模型列表的新鲜度只到最近一次编辑为止。这里没有任何环节会去问提供方它服务哪些模型；路由要多一个模型，得有人写进去。
- **每条路由只有一种协议格式**：`api` 作用于整条路由，因此混合协议的 catalog 路由（跨 Responses 与 Chat Completions 的 OpenAI 式 catalog）无法承载另一种协议的模型，向这类路由添加它未描述的模型必须点名 `api` 并把全部模型一起迁过去。把该提供方拆成两个路由键是变通办法。
- **模态声明不经验证，且多声明的后果超出本轮**：没有任何环节会去询问端点接受什么，因此声明了网关并不提供的 `image` 的模型不会在这里被拦下，而是由提供方在轮次中途拒绝。prompt 准入在构造请求之前就把用户消息持久化提交，于是被拒绝的图片留在会话日志里：该模型会不断重发它，而模型选择拒绝切换到任何纯文本模型。恢复途径是换一个确实支持图片的模型、fork 到图片之前，或开启新会话；发送失败时把尚未消费的图片消息从日志中回滚出去这件事已暂缓。
- **未认证路由取决于其协议**：不点名凭据会让路由解析为「已配置但无密钥」，但 pi-ai 的 OpenAI 兼容实现仍要求 API key 或 `Authorization` 标头，因此无鉴权的本地服务需要一个由 `apiKeyEnv` 引用的占位凭据，或在 `headers` 中给出 `Authorization` 条目。
- **不支持 `GenerateOptions.stop`**：pi-ai 的通用流选项无法保证所有提供方都支持 stop sequence，因此适配器会拒绝该字段。
- **历史中的 `system` 消息使用 pi-ai 通用上下文转换**：提供方特定位置由 pi-ai 决定，而非由 harness 拥有的协议覆盖决定。
- **无法获取提供方 HTTP 状态**：pi-ai 错误事件不会在所有提供方上公开稳定 HTTP 状态；失败只公开稳定 harness 错误 code。
- **重试策略由提供方持有，而不是 SDK 重试**：每个提供方 profile 都可以提供嵌套的 `retryPolicy`；省略时解析为 normal 模式并在两个延迟阶段重试十次，`dsh-llm-retry` 会在 agent 的失败步骤扩展点上执行有效路由策略。pi-ai SDK 重试仍保持禁用，因此持久化的 agent 步骤与 `llm/retry` 事件记录每次可见尝试，直接 `ctx.llm.stream()` 调用仍只尝试一次。
=======
<a id="known-limitations-and-deferred-work"></a>


这些限制说明适配器在哪里停止、由未来工作接续。它们是当前包约束，不是通用 pi-ai 对比或任务积压。

- **`maxRequestImageBytes` 只计算 base64 图片载荷**——文本、工具、描述符与 JSON 结构在该上限之外，因此它必须留有余量地低于网关请求体上限。卸载是确定性请求投影，不会记录为会话事件。
- **登录只存在于发起它的进程中**——授权尝试不持久，因此登录中途刷新页面会放弃它，用户需要重新开始。退出登录是对已存储记录执行 `deleteRecord`，只在本地忘记它，不会告知签发方。
- **提供方原生发现经本插件的 ambient context 回答**——不点名凭据的路由交由目录提供方自身解析，它会询问环境值（`AZURE_OPENAI_API_KEY`、`AWS_PROFILE` 及各提供方自有集合）与本地凭据文件。两个问题都在这里得到回答：凭据 seam 先于进程环境被查询，文件存在性则针对宿主进程的文件系统以 `~` 展开后检查。它做不到的是*读取*凭据文件内容——自行解析 `~/.aws/credentials` 的提供方会直接读取，不经该 seam。
- **设置可以新增或覆盖路由，不能移除组合路由**——用户层覆盖组合 base，因此删除 `cordis.yml` 提供的提供方属于组合变更。
- **分层合并对字典键没有删除**——base 声明的 `reasoningEfforts` 等级、`modelOverrides` 条目或 `compat` 字段可以被用户层覆盖，但不能被移除。
- **`headers` 可以携带 redactor 永远看不到的凭据**——profile 的 `headers` 字典是纯字符串；以 `apiKeyEnv` 引用存储凭据。
- **路由目录不会自行刷新**——目录就是 `settings.yaml` 的内容；这里没有任何机制向提供方查询它提供的模型。
- **每条路由一种协议格式**——混合协议目录路由无法承载另一协议格式的模型；把提供方拆到两个路由键是变通办法。
- **模态声明不受校验**——声明 `image` 而其网关不支持的模型会在提示词准入后被提供方拒绝。持久图片仍留在历史中，同一误声明模型可能再次失败；切换到纯文本模型仍然可行，因为共享 LLM 运行时会针对该请求把图片引用投影为稳定文本。
- **未认证路由取决于其协议**——不点名凭据的路由解析为已配置但无密钥，但 pi-ai 的 OpenAI 兼容实现仍要求 API 密钥或 `Authorization` 标头，因此无密钥本地服务器需要由 `apiKeyEnv` 引用或 `headers` 中的 `Authorization` 条目提供的占位凭据。
- **不支持 `GenerateOptions.stop`**——pi-ai 的通用流式选项无法跨提供方保证停止序列行为。
- **历史中的 `system` 消息使用 pi-ai 通用上下文转换**——提供方专属放置遵循 pi-ai，而非 harness 自有的协议覆盖。
- **提供方 HTTP 状态不可用**——pi-ai 错误事件不跨提供方暴露稳定 HTTP 状态。
- **重试策略由提供方自有，而非 SDK 重试**——pi-ai SDK 重试保持禁用，因此持久 agent 步骤与 `llm/retry` 事件拥有每个可见尝试，直接 `ctx.llm.stream()` 调用仍是单次尝试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是不具权威性的工作上下文：尚未决定的探索方向与维护者备注。已交付的行为与既定理由以上文、包代码和相关 Agent Note 为准。

- 提供的协议集合刻意比 pi-ai 的完整 API 集合更窄：Bedrock、Vertex、Azure 与 Codex 通过 profile 无法以密钥、端点与标头完整描述的流程认证；目录路由仍可经自有提供方到达它们，只有显式覆盖会被拒绝。Codex 可经授权流程的 OAuth grant 登录。
- `compat` 开关集合由漂移门禁钉在 pi-ai 的 compat 类型上；上游升级若新增字段、为更多协议赋予 compat 类型或扩大值联合，会在有人分类前让构建失败。

</details>
>>>>>>> upstream/master
