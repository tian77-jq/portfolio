# 静态站点容器：python:3.12-slim + 内置 miniserve.py，无构建步骤、无外网依赖
# 设计取舍：docker.io 的匿名 token 端点在本机不可达，nginx 基础镜像拉不下来；
#   本机已有 python:3.12-slim，改用它做运行时，容器可离线构建。
#   代价是少了 nginx 的 sendfile / gzip，对一个纯静态作品集站点无实质影响。
FROM python:3.12-slim

LABEL org.opencontainers.image.title="agent-portfolio-site" \
      org.opencontainers.image.description="田德盛 Agent 工程作品集（静态站）" \
      org.opencontainers.image.version="1.1.0"

WORKDIR /srv

# 只复制站点产物与运行时，排除仓库元数据、构建脚本、Docker 描述文件
COPY miniserve.py /srv/miniserve.py
COPY index.html /srv/
COPY projects.html /srv/
COPY eval.html /srv/
COPY arch.html /srv/
COPY product-hengjian.html /srv/
COPY product-cement.html /srv/
COPY product-helan.html /srv/
COPY product-researchos.html /srv/
COPY assets/ /srv/assets/
COPY data/ /srv/data/

ENV PORT=80 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=3s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1/').status==200 else 1)"

CMD ["python", "/srv/miniserve.py"]
