#!/bin/bash
# 姥姥的回忆录 — 安装本机语音精修（开源 Qwen3-ASR）
# 双击运行。会装好独立的 Python 环境和识别模型，并设成开机自动运行。录音始终只在这台电脑上处理。
set -euo pipefail

UV_VERSION="0.13.5"
PKG="mlx-qwen3-asr==0.4.4"
APP_DIR="$HOME/Library/Application Support/LaolaoASR"
AGENT_ID="com.laolao.memoir.asr"
PLIST="$HOME/Library/LaunchAgents/$AGENT_ID.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m安装没有完成：%s\033[0m\n' "$1"; read -r -p "按回车关闭窗口…" _; exit 1; }

[ "$(uname -m)" = "arm64" ] || fail "这台 Mac 不是苹果芯片（M1/M2/M3/M4），跑不了本机识别。应用照常能用，只是没有精修。"

MEM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
if [ "$MEM_GB" -ge 16 ]; then MODEL="Qwen/Qwen3-ASR-1.7B"; else MODEL="Qwen/Qwen3-ASR-0.6B"; fi
say "这台电脑内存 ${MEM_GB}GB，使用模型：$MODEL"

say "1/5 准备安装工具 uv $UV_VERSION …"
export PATH="$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf "https://astral.sh/uv/$UV_VERSION/install.sh" | env UV_NO_MODIFY_PATH=1 sh || fail "下载 uv 失败，请检查网络后重试。"
fi

say "2/5 建立独立的 Python 环境（不影响电脑上其他软件）…"
mkdir -p "$APP_DIR"
cp "$HERE/server.py" "$APP_DIR/server.py"
uv venv --python 3.11 --allow-existing "$APP_DIR/venv" >/dev/null || fail "建立 Python 环境失败。"

say "3/5 安装识别引擎 $PKG …"
VIRTUAL_ENV="$APP_DIR/venv" uv pip install --quiet "$PKG" || fail "安装识别引擎失败，请检查网络后重试。"

say "4/5 下载识别模型（第一次大约 1–4GB，请耐心等待）…"
"$APP_DIR/venv/bin/python" -c "from mlx_qwen3_asr import Session; Session(model='$MODEL'); print('模型就绪')" || fail "下载模型失败，请检查网络后重新运行。"

say "5/5 设为开机自动运行 …"
mkdir -p "$HOME/Library/LaunchAgents" "$APP_DIR/logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$AGENT_ID</string>
  <key>ProgramArguments</key><array>
    <string>$APP_DIR/venv/bin/python</string><string>$APP_DIR/server.py</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>LAOLAO_ASR_MODEL</key><string>$MODEL</string>
    <key>HF_HUB_OFFLINE</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$APP_DIR/logs/asr.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/logs/asr.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$AGENT_ID" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" || fail "设置开机自动运行失败。"

say "正在检查服务 …"
for i in $(seq 1 90); do
  if curl -s --max-time 2 http://127.0.0.1:8765/health | grep -q '"ready": true'; then
    say "✅ 安装完成。本机语音精修已经在后台运行，以后开机会自动启动。"
    echo "打开回忆录应用，在「设置」里能看到「本机精修：已连接」。"
    read -r -p "按回车关闭窗口…" _ || true
    exit 0
  fi
  sleep 2
done
fail "服务没有按时启动。日志在：$APP_DIR/logs/asr.log"
