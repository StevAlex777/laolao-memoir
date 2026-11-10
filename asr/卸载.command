#!/bin/bash
# 姥姥的回忆录 — 卸载本机语音精修。不会删除应用里的任何内容和录音。
AGENT_ID="com.laolao.memoir.asr"
launchctl bootout "gui/$(id -u)/$AGENT_ID" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$AGENT_ID.plist"
rm -rf "$HOME/Library/Application Support/LaolaoASR"
echo "已卸载本机语音精修。识别模型缓存在 ~/.cache/huggingface，需要的话可以手动删除。"
read -r -p "按回车关闭窗口…" _ || true
