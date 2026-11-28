/* ==========================================================================
   门户站项目注册表 —— 这是唯一需要改的文件
   新增一个项目：复制一份对象，改 8 个字段，保存刷新即可出现新卡片与新路由。
   生成 projects.json（给后端/工具用）：python tools/sync_projects.py
   ========================================================================== */
window.PROJECTS = [
  {
    id: "helan",
    name: "贺兰有灵",
    tag: "文旅 · 多 Agent",
    accent: "#7c9cff",
    accent2: "#8b7dff",
    desc: "宁夏文旅规划：文化问答、行程生成与连续修改收敛到同一流程，点位可溯源、路线带风险说明。",
    url: "product-helan.html",
    demoUrl: "product-helan.html#demo",
    tools: ["helan.ask_culture", "helan.plan_itinerary", "helan.revise_plan", "helan.verify_plan"],
    skills: ["ask_culture", "plan", "revise", "verify"],
    health: "http://127.0.0.1:8210/.well-known/agent.json",
    metrics: [
      { k: "MCP 冒烟", v: "28/28" },
      { k: "A2A 冒烟", v: "26/26" },
      { k: "三入口 trace", v: "逐字节一致" }
    ],
    prompts: [
      "三天两晚，带老人，预算 3000，别太赶",
      "把第二天的沙坡头换成水洞沟，其余不变",
      "这些景点的门票和开放时间可靠吗"
    ],
    demo: [
      {
        q: "三天两晚，带老人，预算 3000，别太赶",
        a: "按「少移动、多停留」排：D1 银川市区（宁夏博物馆 → 西夏陵），D2 沙坡头单点深度（不叠加沙湖），D3 水洞沟半日返程。\n\n为什么这样排：老人同行时，跨城单程超过 2 小时的点位会显著抬高疲劳度，所以把中卫放在中间整天，避免两头赶路。\n\n来源：宁夏文旅公开资料 + 本项目知识层；门票与开放时间以景区当日公告为准。",
        tools: ["helan.plan_itinerary", "helan.verify_plan"],
        ms: 412,
        evidence: "景点 8 条（含来源）、路线风险 2 条、未验证项 1 条（门票价）"
      },
      {
        q: "把第二天的沙坡头换成水洞沟，其余不变",
        a: "已替换 D2 为水洞沟，D1 / D3 保持原样。\n\n连带影响：水洞沟在银川东南，与 D1 的西夏陵同向，实际把长途移动集中到了 D1—D2 之间，D3 返程更松。若坚持「不折返」，建议改成 D2 西夏陵 + 水洞沟连游、D3 沙坡头单点，但总车程会增加约 40 分钟。",
        tools: ["helan.revise_plan", "helan.verify_plan"],
        ms: 358,
        evidence: "变更 1 处、连带调整建议 1 条、约束冲突 0 条"
      },
      {
        q: "这些景点的门票和开放时间可靠吗",
        a: "不可靠——这是本项目明确的能力边界。\n\n行程里的门票价与开放时间来自公开资料快照，不是实时数据。系统会在输出里把这些字段标为「未验证」，需要接入景区实时接口或人工核对后才能当结论用。\n\n这也是为什么门户站留了工具槽位：接上地图/天气/票务 API 后，这类字段才会从「待核」变成「有回执」。",
        tools: ["helan.ask_culture"],
        ms: 296,
        evidence: "知识条目 3 条、明确标注未验证字段 2 个"
      }
    ]
  },
  {
    id: "hengjian",
    name: "衡鉴",
    tag: "金融 · 财报核验",
    accent: "#d9b26a",
    accent2: "#8fa6d8",
    desc: "把公开财报变成可复算、可回查的核验线索：引文须为原文子串才采信，口径不混算，中断可接管。",
    url: "product-hengjian.html",
    demoUrl: "product-hengjian.html#demo",
    tools: ["hengjian.verify_filing", "hengjian.trace_fact", "hengjian.preview_report", "hengjian.get_calculation", "hengjian.list_report_snapshots", "hengjian.list_tasks"],
    skills: ["verify", "trace", "preview", "calc", "snapshots", "tasks"],
    health: "http://127.0.0.1:8220/health",
    metrics: [
      { k: "工作区回归", v: "2,058 项通过" },
      { k: "真实回放", v: "26/28" },
      { k: "故障探针", v: "16/16 ×2" }
    ],
    prompts: [
      "这份年报里研发费用同比变动多少，口径是什么",
      "把这个数字追溯到 PDF 哪一页",
      "帮我看看这份预览里哪几条不该采信"
    ],
    demo: [
      {
        q: "这份年报里研发费用同比变动多少，口径是什么",
        a: "研发费用：本期 12.83 亿元，上期 10.41 亿元，同比 +23.2%。\n\n口径：合并报表 · 本期/上期均为全年累计 · 单位元。计算只用同口径事实，未与单季数据混算。\n\n引文（原文子串，可逐字比对）：「研发费用……本期发生额 1,283,——」\n页码：合并利润表 P.87。",
        tools: ["hengjian.verify_filing", "hengjian.trace_fact"],
        ms: 268,
        evidence: "引文 1 处已逐字匹配、同口径事实 2 条、页码 1 处"
      },
      {
        q: "把这个数字追溯到 PDF 哪一页",
        a: "追溯到 2024 年年度报告 P.87「合并利润表」第 14 行。\n\n三层存储里这条值的链路：原文层（P.87 表格坐标）→ 标准化事实层（主体=本公司 / 期间=2024A / 单位=元 / 口径=合并累计）→ 计算层（同比）。\n\n如果 PDF 换版导致页码位移，会先报「定位失败」而不是给一个看似合理的页码。",
        tools: ["hengjian.trace_fact"],
        ms: 141,
        evidence: "页表定位 1 处、事实元数据 4 项、校验和一致"
      },
      {
        q: "帮我看看这份预览里哪几条不该采信",
        a: "本地候选导入 11 条事实，预览阶段排除 3 条待复核结论：\n\n1. 口径混算 1 条——单季数被当作累计数参与同比\n2. 引文不匹配 1 条——结论所附引文在原文中找不到逐字对应\n3. 主体不符 1 条——引文来自子公司报表，结论写的是合并口径\n\n排除动作本身留档可审计，不是静默丢弃。剩余 8 条可进入复核。",
        tools: ["hengjian.preview_report"],
        ms: 502,
        evidence: "导入 11 条、排除 3 条（附原因）、可复核 8 条"
      }
    ]
  },
  {
    id: "cement",
    name: "砼智销",
    tag: "工业 · 销售 Agent",
    accent: "#f0a35e",
    accent2: "#e0724f",
    desc: "混凝土行业销售：询价草稿确定性工作流（读上下文 → 检索产品 → 建草稿 → 回读 → 校验）+ 数字人「砼小智 TongBot」。",
    url: "product-cement.html",
    demoUrl: "product-cement.html#demo",
    tools: ["cement.quote_generate", "cement.read_customer", "cement.validate_quote", "cement.read_opportunity"],
    skills: ["quote", "read"],
    health: "http://127.0.0.1:8230/health",
    metrics: [
      { k: "容器开销", v: "+36.9ms" },
      { k: "checkpoint", v: "WAL + NORMAL" },
      { k: "数字人", v: "TongBot" }
    ],
    prompts: [
      "住宅建房用水泥，银川，200 平，帮我起一份询价草稿",
      "同一个客户换个目标再起一份，会覆盖上一份吗",
      "这单如果中途崩了，能接着算吗"
    ],
    demo: [
      {
        q: "住宅建房用水泥，银川，200 平，帮我起一份询价草稿",
        a: "已生成询价草稿（DRAFT_READY）。\n\n流程：读客户上下文 → 本地语料检索海螺产品 → 建草稿 → 回读 → 校验，五步确定性执行，不调模型、不联网。\n\n草稿字段来自你给的结构化事实（项目类型 / 城市 / 用途 / 面积），不是原始对话。缺的字段会标进 missing_information，不会被猜。\n\n注意：这不是报价。砼智销不出价格，价格与折扣由业务人员按当日行情复核。",
        tools: ["cement.quote_generate"],
        ms: 331,
        evidence: "5 步工具事件全 SUCCEEDED、缺失字段 0 条、草稿回读 rfq_id 一致"
      },
      {
        q: "同一个客户换个目标再起一份，会覆盖上一份吗",
        a: "不会。\n\n幂等键由 session_id + 目标描述共同决定：同客户同目标重放，返回同一任务、同一草稿，不重复执行；同客户换了目标，就是另一笔询价，新建任务，旧草稿原样保留。\n\n这是修过的一个缺陷：早期版本幂等键只含 session，换目标会错误命中旧草稿。现在不会。",
        tools: ["cement.quote_generate"],
        ms: 214,
        evidence: "重放 task_id 一致、换目标 task_id 新建、旧草稿未被改写"
      },
      {
        q: "这单如果中途崩了，能接着算吗",
        a: "能，但要分清能接什么。\n\n询价任务的状态与工具事件按步骤落 SQLite，每步有唯一 step_id；执行前先 claim，重复请求只会观察已有执行而不重放。\n\n能接：已落库的任务状态、草稿、工具事件。\n不能保证：崩溃瞬间正在进行的工具调用——这类按「未知」保留，交人工确认，而不是自动重试（重试会重复派发）。",
        tools: [],
        ms: 0,
        evidence: "任务/草稿/事件三层落盘说明，无工具调用"
      }
    ]
  },
  {
    id: "researchos",
    name: "ResearchOS",
    tag: "科研 · 证据检索",
    accent: "#3fd6b0",
    accent2: "#2f9fd6",
    desc: "科研工作空间：Model Gateway 唯一必经入口、混合检索 + 三态证据门禁、跨文件类事务落盘。",
    url: "product-researchos.html",
    demoUrl: "product-researchos.html#demo",
    tools: ["researchos.search_evidence", "researchos.gate_check", "researchos.gateway_invoke"],
    skills: ["search", "gate", "gateway"],
    health: "http://127.0.0.1:8240/health",
    metrics: [
      { k: "定向回归", v: "83/83" },
      { k: "融合权重", v: "0.7 词面 / 0.3 向量" },
      { k: "零传输验证", v: "3 类场景" }
    ],
    prompts: [
      "帮我找 Transformer 长上下文压缩的相关工作，要有原文出处",
      "这条结论的证据能通过门禁吗",
      "这个插件包能过质量门吗"
    ],
    demo: [
      {
        q: "帮我找 Transformer 长上下文压缩的相关工作，要有原文出处",
        a: "命中 4 篇，按证据门禁三态输出：\n\n【相关】2 篇——片段含「KV cache 压缩」「稀疏注意力」原词，重排分 ≥ 0.72，可直接引用。\n【待定】1 篇——只命中「长上下文」，缺具体方法词，需人工确认是否切题。\n【剔除】1 篇——相似度高但内容是基准测试综述，不支撑方法结论。\n\n每条都带原文段落定位；分数不作为相关性证据，只作排序依据。",
        tools: ["researchos.search_evidence", "researchos.gate_check"],
        ms: 386,
        evidence: "召回 12 条 → 重排 4 条 → 门禁 相关2/待定1/剔除1"
      },
      {
        q: "这条结论的证据能通过门禁吗",
        a: "不能，卡在第二重。\n\n三重准入：检索分 ✓（0.81）、重排分 ✗（0.44，低于阈值）、最小关键词重叠 ✓（2 项）。\n\n重排分低的原因是候选里「压缩」只出现在参考文献标题，正文讲的是位置编码——属于典型的「命中但仍偏题」。系统给「待定」，不进入引用。",
        tools: ["researchos.gate_check"],
        ms: 122,
        evidence: "三重准入 2 通过 1 未过、判定=待定"
      },
      {
        q: "这个插件包能过质量门吗",
        a: "六项静态检查通过，第七项 test_evidence 未验证——所以整体裁决是「不通过」。\n\n通过的六项：manifest、compatibility、provider_boundary、architecture、code_quality、secrets，全是确定性静态扫描，不调模型。\n\n未验证的一项：test_evidence 需要宿主真实跑过测试并签发证据。本入口不自己签——没有证据就如实显示 TEST_EVIDENCE_MISSING，不会凑一个「通过」。\n\n调用方手里有真实测试结果（命令、退出码、用例名）时可以传进来，入口只校验不生成：退出码非 0 或产物摘要对不上，一样判不通过。",
        tools: ["researchos.gate_check"],
        ms: 178,
        evidence: "静态检查 6/6 通过、test_evidence=TEST_EVIDENCE_MISSING、allowed=false"
      }
    ]
  }
];

/* 门户自身配置（网关端口、探针超时）。server/hub_server.py 与 hub.html 都从这里读，不硬编码。 */
window.HUB_CONFIG = {
  port: 8250,
  probe_timeout_ms: 2500,
  map: {
    provider: "tencent",                       /* 白名单：tencent / amap / baidu / tianditu；默认腾讯，不许换境外源 */
    coord: "GCJ-02",
    script: "https://map.qq.com/api/gljs?v=1.exp",
    /* 占位符原样保留，由部署环境替换；前端任何地方不许出现真实 key */
    serviceHost: "http://127.0.0.1:__WB_HTTP_PORT__/_TMapService/_wbt/__WB_TMAP_SECRET__",
    fallback: "text"
  }
};

/* 门户自身的能力清单（不属于任何子项目）。
   地图/天气三项的“数据”走贺兰 adapter 已有工具（via），门户自己只做展示层（腾讯地图渲染 + 文字降级），不重复造数据源。 */
window.HUB_TOOLS = [
  { name: "hub.route", desc: "按 @项目 或意图选择目标 adapter" },
  { name: "hub.trace", desc: "回传 route → tool → latency → evidence" },
  { name: "hub.probe", desc: "对各项目健康探针做并行探测（共享截止时间）" },
  { name: "tools.map_geocode", desc: "地址 → GCJ-02 坐标", via: "helan.helan_places", provider: "tencent", fallback: "text" },
  { name: "tools.map_route",   desc: "两点 → 驾车/公交里程与时长", via: "helan.helan_travel", provider: "tencent", fallback: "text" },
  { name: "tools.weather_now", desc: "城市 → 当前天气（含数据时间戳与来源）", via: "helan.helan_weather", provider: "helan", fallback: "unconfigured" }
];
