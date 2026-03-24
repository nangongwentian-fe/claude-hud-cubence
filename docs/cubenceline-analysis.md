# CubenceLine 额度查询实现分析

> 分析对象: `@cubence/cubenceline` v1.1.5
> 源码仓库: https://github.com/Cubence-com/CubenceLine

## 整体架构

CubenceLine 是用 **Rust** 编写的 Claude Code StatusLine 工具，npm 包只是一个 JS 分发包装器（负责平台检测和二进制分发），实际逻辑在编译好的 Rust 二进制中。

## 额度查询数据流

```
~/.claude/settings.json → 读取凭证/URL → HTTP 请求 Cubence API → 解析响应 → 格式化显示
```

## 关键步骤

### 1. 读取凭证 (`src/utils/credentials.rs`)

从 `~/.claude/settings.json` 的 `env` 字段读取：

- **`ANTHROPIC_AUTH_TOKEN`** — 用作 API 认证的 Bearer Token
- **`ANTHROPIC_BASE_URL`** — Cubence 的 API 基础地址（如 `https://api.cubence.com`）

### 2. 调用订阅信息 API (`src/utils/subscription.rs`)

**API 端点**: `{ANTHROPIC_BASE_URL}/v1/user/subscription-info`

```rust
agent.get(api_url)
    .set("Authorization", &format!("Bearer {}", token))
    .set("Content-Type", "application/json")
    .call()
```

支持从 `settings.json` 或环境变量读取 `HTTPS_PROXY` / `HTTP_PROXY` 代理配置。

### 3. 响应数据结构

```rust
struct SubscriptionInfo {
    normal_balance: BalanceInfo,             // 普通余额
    subscription_window: SubscriptionWindow, // 订阅窗口
    timestamp: i64,
}

struct BalanceInfo {
    amount_dollar: f64,   // 余额（美元）
    amount_units: u64,    // 余额（内部单位，1,000,000 units = $1）
}

struct SubscriptionWindow {
    five_hour: WindowInfo,  // 5小时窗口
    weekly: WindowInfo,     // 周窗口
}

struct WindowInfo {
    limit: u64,            // 总额度（units）
    remaining: u64,        // 剩余额度（units）
    used: u64,             // 已用额度（units）
    reset_at: Option<i64>, // 重置时间戳（Unix timestamp）
}
```

单位换算: `units / 1,000,000 = dollars`

### 4. 缓存机制

- 缓存文件: `~/.claude/ccline/.subscription_info_cache.json`
- 默认缓存时长: **180 秒**（可配置 `cache_duration`）
- 请求超时: **2 秒**（可配置 `timeout`）
- API 失败时回退到过期缓存

### 5. 渲染显示 (`src/core/segments/cubence.rs`)

状态栏输出格式：

- **有订阅**: `Cubence - 订阅[5h $已用/$总额 | week $已用/$总额]  余额[$余额]  延迟[XXms]`
- **无订阅**: `Cubence - 余额[$余额]  延迟[XXms]`

通过检查 `five_hour.limit > 0 || weekly.limit > 0` 判断是否有订阅。

### 6. 健康检查延迟

额外请求 `{ANTHROPIC_BASE_URL}/health` 端点，测量 API 延迟并附加到显示末尾。

## Usage Segment（官方 API 用量，独立模块）

`src/core/segments/usage.rs` 是另一个独立 segment，用于查询 **Anthropic 官方**的用量：

- API 端点: `{ANTHROPIC_BASE_URL}/api/oauth/usage`
- 认证: OAuth Bearer Token + `anthropic-beta: oauth-2025-04-20` header
- 返回 5 小时和 7 天的利用率百分比（`utilization: f64`）
- 缓存文件: `~/.claude/ccline/.api_usage_cache.json`，默认 300 秒

## 关键源文件索引

| 文件 | 作用 |
|------|------|
| `src/utils/credentials.rs` | 读取 settings.json 中的 token 和 base URL |
| `src/utils/subscription.rs` | 订阅 API 客户端、缓存、健康检查 |
| `src/core/segments/cubence.rs` | Cubence 额度 segment（余额+订阅窗口） |
| `src/core/segments/usage.rs` | Anthropic 官方用量 segment |
| `src/core/segments/cost.rs` | 会话成本 segment（从 stdin 读取） |
