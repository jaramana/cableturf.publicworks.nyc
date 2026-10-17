"""Serve a folder locally with caching off, so edits show on reload.

    python3 tools/serve.py 8772 docs
"""

import functools
import http.server
import sys
from pathlib import Path


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8772
    folder = Path(sys.argv[2] if len(sys.argv) > 2 else "docs").resolve()
    handler = functools.partial(NoCache, directory=str(folder))
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
