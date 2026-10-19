# Docker 部署

## 快速启动

```bash
docker compose up -d --build
```

打开 http://127.0.0.1:3210 。默认只绑定本机回环地址；应用没有内置登录，公网部署前必须加认证反向代理。

首次启动后到「设置」填模型服务；API Key 会写入容器内的 SQLite 数据库，不会打进镜像。

## 数据持久化

容器使用命名卷：

```text
history-atlas-data -> /data
```

数据库路径是 `/data/history-atlas.db`（WAL 模式，另有 `-wal`/`-shm`）。

- 不要删除这个卷，否则书、分析和设置都会丢失；
- 单实例使用；SQLite 不适合多个应用副本同时写；
- 备份前先停容器，或使用 SQLite `.backup`，避免只复制主文件而漏掉 WAL。

```bash
docker compose stop
docker run --rm \
  -v history-atlas-data:/data \
  -v "$PWD":/backup \
  alpine sh -c 'tar czf /backup/history-atlas-data.tgz -C /data .'
docker compose start
```

如果你改用 bind mount，请确保宿主机目录对容器用户 `1001:1001` 可写：

```yaml
volumes:
  - ./data:/data
```

```bash
mkdir -p data && chown -R 1001:1001 data
```

## 不作为镜像内容的数据

`.dockerignore` 已排除：

- `.data/`（本地开发数据库、旧 JSON）
- `.env*`（只保留 `.env.example`）
- `node_modules/`、`.next/`、测试产物、日志

API Key 不要写进 Dockerfile 或 compose 文件；用页面设置写入数据卷即可。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3210` | 容器内监听端口 |
| `HOSTNAME` | `0.0.0.0` | 必须绑定到容器外部 |
| `DATA_DIR` | `/data` | SQLite 数据目录 |
| `NEXT_TELEMETRY_DISABLED` | `1` | 关闭 Next 遥测 |
| `LLM_*` / `GEOCODER` | 空 | 可选的服务端兜底配置，设置页优先 |
| `PUBLIC_ORIGIN` | 空 | 反向代理后的公网源，多个用逗号分隔；本机端口映射无需设置 |
| `ALLOW_PRIVATE_LLM` | 空 | 允许 Base URL 指向内网/本机；Ollama 本地服务默认可用 |

## 更新版本

```bash
git pull
docker compose up -d --build
```

健康检查会自动请求 `/api/health`。数据在命名卷中，重建镜像不会清空。

## 反向代理

应用只监听容器内 `3210`。如果放到公网，建议用 Nginx/Caddy 终止 TLS，并把请求转发到 `127.0.0.1:3210`；不要直接暴露没有认证的实例，因为它能读取本机知识库和触发模型计费。

## 已知限制

- Docker 构建通过 `DOCKER_BUILD=1` 启用 Next.js standalone 输出；静态文件、`public/`、`assets/` 在镜像内分别复制；本地 `npm run build` 仍使用普通输出，`npm start` 可用；
- Node 22 的 `node:sqlite` 启动时会打印 experimental warning，不影响使用；
- 不要对同一 `/data` 卷启动多个副本。
