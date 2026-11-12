# 姥姥的回忆录 — 给 Claude Code 的项目说明

家用口述史访谈 + 回忆录网页应用。**先读 `交接说明.md`**（本机私有文件，不在仓库里），里面有当前进度、待办和家里的安排；`PRODUCT.md`（同样私有）记录产品事实和姥姥的个人信息。和用户交流用中文。

## 运行与测试

- 纯静态，无构建：`python3 -m http.server 8642 --bind 127.0.0.1`，打开 http://localhost:8642/
- 单元测试：`npm test`（`node --test 'tests/*.test.js'`，只覆盖 `js/core.js` 的纯函数）
- 线上：https://stevalex777.github.io/laolao-memoir/ ，仓库 `StevAlex777/laolao-memoir`（公开）。**推到 `main` 即部署**。
- 浏览器端到端测试：用 Node 24 自带的 fetch/WebSocket 通过 CDP 驱动无头 Chrome（`--headless=new --remote-debugging-port=… --user-data-dir=<新临时目录>`）。坑：
  - Chrome 启动慢，连接 `/json` 要重试；
  - `Page.captureScreenshot` 配 `captureBeyondViewport+clip` 会截出空白，改成调大视口高度再截；
  - REA 的 `capture_browser_scenario` 要用 `http://localhost:8642`，用 `127.0.0.1` 会超时；
  - 无头模式下假麦克风读不到音频文件，真实录音只能人工测。
- 本机识别服务（可选）：`asr/server.py`，正式安装用 `asr/安装.command`（会装开机自启的 LaunchAgent，必须由用户亲自运行）。临时测试可以在 venv 里直接 `python asr/server.py`，用环境变量 `LAOLAO_ASR_MODEL`、`LAOLAO_ARCHIVE_DIR`、`LAOLAO_ASR_PORT` 控制。
- 这台机器的 bash 是 3.2：复杂命令写成脚本文件再执行；`rm` 的路径里不要用变量。

## 架构

| 文件 | 作用 |
|---|---|
| `index.html` / `styles.css` | 外壳与全部样式（磁州窑视觉：白釉底、铁黑线、赭色表示当前） |
| `js/app.js` | 所有视图（模板字符串）、状态、交互 |
| `js/core.js` | 纯逻辑与提示词（访谈者规则、抽取/归类/找线索/写章节的提示与工具定义、时间线合并、WAV 编码等），有单测 |
| `js/ai.js` | Claude 调用。SDK 打包在 `vendor/anthropic-sdk-1.3.0.mjs`，用到时才加载 |
| `js/speech.js` | Chrome 实时识别（草稿）+ 录音，每 60 秒切一段并立即存盘，64 kbps |
| `js/asr.js` | 调本机服务 127.0.0.1:8765：精修识别、另存档案 |
| `js/db.js` | IndexedDB（v2：kv / sessions / turns / audio / timeline / chapters / photos） |
| `js/backup.js` | JSON 快速备份 / ZIP 完整备份（含录音、照片）/ 恢复 |
| `js/photos.js` | 照片压缩（**界面入口已按用户要求隐藏**） |
| `data/questions.json` | 8 个人生阶段的题库（带手机短名） |
| `data/timeline.json` | 50 条时代背景，每条有中文维基出处 |
| `asr/` | 本机 Qwen3-ASR 服务、安装 / 卸载脚本 |
| `写书指南.md` | 写书规则：混合叙述 + 合理还原的边界 |
| `DESIGN.md` / `.impeccable/` | 设计系统、设计契约、评审存档 |

## 必须遵守

- **不要改仓库名或网址**：浏览器里的数据绑在这个网址上，换了就看不到。
- **公开仓库里不放姥姥的个人信息**（生日、具体家乡、家庭细节）。这些只在 `PRODUCT.md` 和应用内由家人填写。
- **模型**：日常调用（追问、归类、整理时间线、上网找）用 `claude-sonnet-5-5`，只有「写成文章」用 `claude-opus-5-5`。这是用户为了控制花费做的决定，不要擅自改回。
- **不编造**：时间线条目必须引用原话编号；时代背景每条都要有可核实出处（中文维基 API 有限流，批量查询时放慢）；写书按 `写书指南.md`。
- **改了界面后**：遵守 `DESIGN.md` 和 `.impeccable/surfaces/index-html.md`（只用 token 颜色、一屏一个赭色重点、2px 铁黑线、楷体 / 宋体 / 苹方三种字体分工）。
- 依赖版本全部锁定：SDK 1.3.0、fflate 0.8.2、mlx-qwen3-asr 0.4.4、uv 0.13.5、霞鹜文楷 webfont 1.7.0。
- 提交信息结尾加：`Co-Authored-By: Claude <noreply@anthropic.com>`（按当前会话提示的署名为准）。
