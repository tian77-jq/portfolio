#!/usr/bin/env python3
"""作品集站点的静态文件服务（容器内用，零第三方依赖）。

为什么不用 nginx：
  构建时 docker.io 的匿名 token 端点返回 502，nginx 基础镜像拉不下来；
  本机已有 python:3.12-slim，直接用它做运行时，容器可离线构建。
  代价是少了 nginx 的 sendfile / gzip，对一个纯静态作品集站点无实质影响。

行为对齐原来的 nginx 配置：
  - 目录不做列表（autoindex off）
  - HTML 不缓存，静态资源 7 天缓存
  - 不存在返回 404
"""
from __future__ import annotations

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
LONG_CACHE = (".css", ".js", ".png", ".jpg", ".jpeg", ".svg", ".woff2", ".ico")


class Handler(SimpleHTTPRequestHandler):
    server_version = "portfolio/1.0"
    sys_version = ""

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0].lower()
        if path.endswith(LONG_CACHE):
            self.send_header("Cache-Control", "public, max-age=604800")
        elif path.endswith(".html") or path.endswith("/"):
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def list_directory(self, path):  # noqa: ANN001 - 签名随标准库
        # 关掉目录列表：返回 None 会让标准库回 404
        self.send_error(404, "Not Found")
        return None

    def log_message(self, fmt: str, *args) -> None:  # noqa: ANN002
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    port = int(os.environ.get("PORT", "80"))
    handler = partial(Handler, directory=ROOT)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"serving {ROOT} on :{port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
