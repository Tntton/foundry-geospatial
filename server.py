#!/usr/bin/env python3
"""Dev server: serves src/* at root, falls back to repo root for /data/*."""
import http.server, socketserver, os
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')

class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Strip query string
        p = path.split('?', 1)[0].split('#', 1)[0]
        # /data/* served from repo root
        if p.startswith('/data/'):
            return os.path.join(ROOT, p.lstrip('/'))
        # Everything else from src/
        if p == '/' or p == '':
            return os.path.join(SRC, 'index.html')
        return os.path.join(SRC, p.lstrip('/'))

PORT = int(os.environ.get('PORT', 8765))
with socketserver.TCPServer(('', PORT), H) as httpd:
    print(f'Serving on http://localhost:{PORT}')
    httpd.serve_forever()
