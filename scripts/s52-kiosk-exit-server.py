#!/usr/bin/env python3
"""Tiny localhost-only server: POST /exit terminates the kiosk Chromium PID."""
from __future__ import annotations

import http.server
import os
import signal
import socketserver
import urllib.parse

PID_FILE = os.environ.get("S52_KIOSK_PID_FILE", "")
PORT = int(os.environ.get("S52_KIOSK_EXIT_PORT", "8765"))


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        if urllib.parse.urlparse(self.path).path != "/exit":
            self.send_error(404)
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:
        if urllib.parse.urlparse(self.path).path != "/exit":
            self.send_error(404)
            return
        try:
            with open(PID_FILE, encoding="utf-8") as f:
                pid = int(f.read().strip())
            os.kill(pid, signal.SIGTERM)
        except (OSError, ValueError):
            pass
        self.send_response(204)
        self._cors()
        self.end_headers()


def main() -> None:
    if not PID_FILE:
        raise SystemExit("S52_KIOSK_PID_FILE is required")
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
