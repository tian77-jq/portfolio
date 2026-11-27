# Agent 工程作品集 · 田德盛

四个业务 Agent + 一个统一评测中心。全部指标由评测中心的真实运行产物编译生成，可在本地重跑复核。

> **English**: A portfolio of four production-oriented agents (industrial sales, financial-report risk, travel itinerary, research retrieval) evaluated by a single, provenance-tracked evaluation center. Every number on the site is generated from archived run artifacts, not typed by hand.

在线站点：<https://tiandesheng475-OSS.github.io/portfolio/>

---

## 这个仓库想证明什么

不是"我做过 Agent"，而是"我的 Agent 结论可被检验"。具体三件事：

1. **同一契约**：`Case / Response / Verdict / RunContext`。四个领域完全不同的系统，接进同一套判分管线。
2. **先判断能不能比，再比**：分区套件不合并分母；不适用就声明拒绝，而不是跑一遍拿个低分。
3. **缺失就写缺失**：样本不足不出 P95，未达标的指标保留 `INCOMPLETE`，不写"基本达标"。

## 目录

```
portfolio/
├── index.html               # 首页：产品矩阵 + 评测中心概览 + 架构对照
├── projects.html            # 四个产品的详情（关键决定 / 验证 / 未做好的地方）
├── eval.html                # 数据看板：逐套件明细、Wilson 区间、排除记录
├── arch.html                # 架构对照：四种编排容器的成本/能力/边界
├── assets/style.css         # 单文件样式，无外部依赖
├── miniserve.py             # 容器内静态服务（标准库，无第三方依赖）
├── Dockerfile               # 静态站镜像
├── docker-compose.yml       # 本地一键起站
├── data/
│   ├── metrics.json         # 由脚本生成，勿手改
│   ├── metrics.js           # 同上，包装成 window.METRICS 以支持 file:// 直开
│   ├── arch.json            # 架构对照页数据，由脚本生成
│   └── arch.js              # 同上，包装成 window.ARCH
└── tools/
    ├── build_site_data.py   # 从评测中心 runs/*/result.json 编译评测数据
    └── build_arch_data.py   # 从 archcompare/results 编译架构对照数据
```

## 本地运行

零依赖，两种方式：

```bash
# 方式一：直接打开（data 走 metrics.js，不依赖 fetch）
start index.html

# 方式二：静态服务
python -m http.server 8899
# http://127.0.0.1:8899/index.html
```

或容器托管：

```bash
docker compose up -d       # http://127.0.0.1:8901
docker compose ps          # 应显示 (healthy)
docker compose down        # 停止
```

镜像的两个取舍：

| 选择 | 原因 |
|---|---|
| 运行时用 `python:3.12-slim` + 内置 `miniserve.py`，不是 nginx | 构建机上 `auth.docker.io` 匿名 token 端点返回 502，nginx 基础镜像拉不下来；改用本机已有镜像可离线构建。代价是少了 sendfile/gzip，对静态站无实质影响 |
| 端口绑 `127.0.0.1:8901` | 只回环可达，不暴露到局域网；8899 在本机已被占用 |

`miniserve.py` 对齐了原 nginx 配置的行为：关目录列表、HTML 不缓存、静态资源 7 天缓存、未知路径 404。

## 重新生成数据

站点上的数字不是手写的。给定一个评测中心目录，脚本会重新编译：

```bash
python tools/build_site_data.py --center "D:/Agent评测与数据中心" --out .
```

脚本行为（已实现，可核对 `tools/build_site_data.py`）：

| 行为 | 原因 |
|---|---|
| 以 `runs/*/result.json` 为权威源，`runs/_index/*.sqlite` 仅作回退 | 索引可能滞后于目录 |
| 每个 `(套件, 适配器)` 只取最新一次 | 避免历史版本混入当前结论 |
| Wilson 区间优先用中心自算值，并交叉校验自己算的 | 不一致会打印 `CI mismatch`，不静默选一个 |
| 排除 `INVALID_CONFIG` 与非 `DONE` 运行，但写入 `excluded` 字段 | 排除必须留痕，否则等于篡改分母 |
| `n < 200` 时 `p95_ms` 置 `null` 并附原因 | 小样本的 95 分位约等于最大值，会被误读 |

## 数据口径

- **置信区间**：Wilson 95%。12 例全过是 100%，但真实水平可能只有 76%——区间宽度本身是信息。
- **重采样**：bootstrap `seed=2027`，可复现。
- **溯源**：每次运行归档数据源 SHA-256、数据集卡与 `git_head`。
- **域隔离**：分区套件（如 `intent_clarify`）跨域不相减、不排名。
- **尾延迟**：`n < 200` 输出 `INSUFFICIENT_SAMPLE_FOR_P95`，不硬报。

## 已知不足

- 站点为静态页，评测中心的**执行**能力不在此仓库（见 `agent-eval-center`）。
- 架构对照页的四框架数据是真实测量，但只覆盖"同一 5 步有界循环"这一种负载，不外推到长链推理或工具密集场景。
- 四个产品的"未做好的地方"是刻意保留的，不是遗漏。

## 许可

代码 MIT。页面中的业务数据均为脱敏样例，不含真实客户信息。

## 联系

田德盛 · 计算机学院 · 智科 251 · GPA 3.72 / 4.0
GitHub: [@tiandesheng475-OSS](https://github.com/tiandesheng475-OSS)
