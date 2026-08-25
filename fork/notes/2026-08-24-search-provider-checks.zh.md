# Agent Note: 搜索提供方预设、实时池与密钥检查

[English](2026-08-24-search-provider-checks.md) | 中文

Status: implemented

## Problem

搜索提供方面板无法产生可用的 Firecrawl 请求：它的预设指向 `api.firecrawl.ai`——一个已停放（parked）的域名（lander 域名服务器、共享主机地址）——并使用真实 API 从未有过的 `GET` + `x-api-key` 形态和 `results` 响应路径。保存的池修改同样从未到达运行中的插件：`installSettingsSection` 只在挂载时调用 `setSource`，因此池里的 `onChange: () => {}` 把运行时配置冻结在加载时刻，直到重启。而且存储的密钥什么都看不到——既看不到是否被接受，也看不到剩余配额——无法区分“搜索失败”和“配额耗尽”。

## Decision

池仍然完全由配置驱动；改变的是数据和新鲜度。Firecrawl 预设和独立的 `web-search-firecrawl` 提供方改用当前的 v2 API：`POST https://api.firecrawl.dev/v2/search`，带 `Authorization: Bearer`，结果从 `data.web` 读取；Brave 预设在 `/res/v1/web/search` 上使用 `x-subscription-token` 与 `web.results`，Exa 使用 `x-api-key`。池插件现在在每次设置提交时从权威来源重建运行时配置，因此浏览器里保存的提供方或密钥无需重载即进入运行中的池——与它的健康补丁同等的实时性。

每个提供方可以携带可选的 `check` 规格（账户端点，加上用量、限额与剩余额度的点路径）。卡片上的密钥检查在宿主侧执行——密钥从不进入浏览器——通过池插件自有的仅限回环的 `/web-search-pool` Connection 通道；报文封套是共享的 `client-request`/`server-response` 对，因此调用方就是通用的 `connection.rpc`。有规格的提供方通过一次账户调用获得有效性与额度数字（Firecrawl 预设自带 `v2/team/credit-usage`）；没有的退回为一次最小真实查询，任何非 401/403 的回答都确认密钥有效。面板以 Models 页面提供方的视觉语言重绘——带凭据圆点与密钥计数的轮廓行、每个提供方的填充式编辑器与只写密钥行、虚线的添加按钮、折叠在披露后的高级选项、共享的 Discard/Save 页脚——让搜索标签页读起来像 API providers 标签页的兄弟。

## Alternatives considered

**只修存储的文档：** 一次性的设置写入能修好当前条目，但每个新添加的提供方仍然是坏的；错误的 API 位于预设和提供方里。

**为检查建一个 apiProxy 域：** freebuff 模式（接口、schema、rpc-map、handler、客户端外观、桥接）为整个功能家族购买类型化表面；对于 apiproxy 从不接触的密钥上的一个方法，一个回环路由加上一次形状校验就足够了。

**对所有人只做有效性 ping：** Brave 和 Exa 没有额度端点，但 Firecrawl 的账户调用免费且精确——规格在提供方支持处携带更丰富的路径，ping 作为通用回退。

## Consequences

保存的池修改无需重启即作用于下一次搜索，密钥检查把“搜索失败”变成每把密钥的判定与剩余额度。在无账户端点的提供方上，检查花费一次最小查询。`web-search-deepseek` 曾有存储的 `baseURL: https://firecrawl.dev` 覆盖，把回退提供方送到非 Messages 端点；清除它恢复了文档化的默认值，也暴露出单独过期的 DeepSeek 搜索凭据。
