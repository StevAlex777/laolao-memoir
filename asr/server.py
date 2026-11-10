"""姥姥的回忆录 — local speech-to-text service.

Runs Qwen3-ASR (open source) on this Mac via MLX. Listens only on 127.0.0.1 and only
answers the memoir app's own pages. Audio never leaves the computer.

  GET  /health      -> {"ok": true, "ready": bool, "model": "..."}
  POST /transcribe  -> body: 16 kHz mono WAV bytes; returns {"text": "..."}
                       optional header X-Context: URL-encoded hint words (names, places)
"""
import json
import os
import urllib.parse
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST, PORT = "127.0.0.1", int(os.environ.get("LAOLAO_ASR_PORT", "8765"))
MODEL = os.environ.get("LAOLAO_ASR_MODEL", "Qwen/Qwen3-ASR-0.6B")
LANGUAGE = os.environ.get("LAOLAO_ASR_LANGUAGE", "Chinese")
MAX_BYTES = 40 * 1024 * 1024  # ~20 minutes of 16 kHz mono WAV per request

# Pages allowed to use this service (the published app and local testing).
ALLOWED_ORIGINS = {
    "https://stevalex777.github.io",
    "http://localhost:8642",
    "http://127.0.0.1:8642",
}

_session = None
_ready = threading.Event()
_lock = threading.Lock()  # one transcription at a time; the GPU is shared


def _load():
    global _session
    from mlx_qwen3_asr import Session

    t = time.time()
    _session = Session(model=MODEL)
    _ready.set()
    print(f"[asr] model {MODEL} ready in {time.time() - t:.1f}s", flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "LaolaoASR/1"

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Context")
        # Chrome asks before a public page talks to a local service.
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        return origin is None or origin in ALLOWED_ORIGINS  # None = curl / local tools

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path != "/health":
            return self._json(404, {"error": "not found"})
        if not self._origin_ok():
            return self._json(403, {"error": "origin not allowed"})
        self._json(200, {"ok": True, "ready": _ready.is_set(), "model": MODEL})

    def do_POST(self):
        if self.path != "/transcribe":
            return self._json(404, {"error": "not found"})
        if not self._origin_ok():
            return self._json(403, {"error": "origin not allowed"})
        length = int(self.headers.get("Content-Length") or 0)
        if not 44 < length <= MAX_BYTES:
            return self._json(413, {"error": "audio missing or too large"})
        data = self.rfile.read(length)
        if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            return self._json(415, {"error": "send 16 kHz mono WAV"})
        if length - 44 < 16000:  # under ~0.5 s of audio: nothing to recognize
            return self._json(200, {"text": ""})
        context = urllib.parse.unquote(self.headers.get("X-Context") or "")[:500]
        if not _ready.wait(timeout=300):
            return self._json(503, {"error": "model still loading"})
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as f:
            f.write(data)
            f.flush()
            t = time.time()
            try:
                with _lock:
                    result = _session.transcribe(f.name, language=LANGUAGE, context=context)
            except Exception as e:  # report, keep serving
                print(f"[asr] error: {e!r}", flush=True)
                return self._json(500, {"error": str(e)})
        text = (result.text or "").strip()
        print(f"[asr] {length // 32000}s audio -> {len(text)} chars in {time.time() - t:.1f}s", flush=True)
        self._json(200, {"text": text})

    def log_message(self, fmt, *args):  # quiet access log
        pass


if __name__ == "__main__":
    threading.Thread(target=_load, daemon=True).start()
    print(f"[asr] listening on http://{HOST}:{PORT} (model {MODEL})", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
