# 已知边界与后续事项

> 记录当前仍未彻底解决、但不阻塞单机使用的问题。后续按需处理。

## 部署与安全

1. **没有内置登录/权限系统**
   - `docker compose` 默认只绑定 `127.0.0.1:3210`，不要直接把未加认证的实例暴露到公网。
   - 公网部署必须在 Nginx/Caddy 等反向代理层加认证、TLS 和访问控制。
   - 能访问实例的人可以读取书稿、修改设置、触发模型计费。

2. **单实例 SQLite**
   - 当前使用 `.data/history-atlas.db`（WAL），不支持多个应用副本同时写。
   - 多用户/多副本部署需要迁 Postgres，并重新设计缓存与锁。

3. **上传请求体没有流式硬上限**
   - 目前依赖 `Content-Length`、文件大小和抽取后的上限；PDF 最多 1200 页，EPUB 单个条目解压上限 100MB。
   - 没有 `Content-Length` 的 chunked 超大请求仍建议由反向代理限制。
   - 没有用户级限流、配额或模型调用预算。

4. **Base URL 的安全校验是保存/测试时校验**
   - 保存时会拒绝非 HTTP(S)、凭据、本机/内网地址，并解析 DNS；但运行期间 DNS 变化（rebinding）没有再次校验。
   - 自定义本机/内网 OpenAI 兼容服务需要显式设置 `ALLOW_PRIVATE_LLM=1`；Ollama 预设允许本机地址。
   - 更换 Base URL 会清空旧 API Key，这是有意的安全行为，需要重新填 key。

5. **Node 版本**
   - `node:sqlite` 需要 Node >=22.5；当前 Docker 使用 Node 22。
   - 启动时会打印 `SQLite is an experimental feature` 警告，不影响使用；升级 Node 时需复查 API。

## 功能与代码

6. **地图点选定位修正未接入主界面**
   - `corrections` 表和后端 API 仍保留，主界面当前不展示“定位修正/采用候选”入口。
   - 这是之前“主界面不要求用户标注”的产品决定；如果恢复该功能，需要重新接通 `WorkspaceClient -> AtlasWorkspace -> AtlasMap/AtlasPanels` 的回调链。

7. **分析缓存是内容缓存**
   - key 已包含 `bookId/chapterId/text/scope/promptVersion/provider/model`，并按 500MB 上限淘汰最旧记录。
   - 没有手动清理缓存的 UI；如需释放空间，可在数据库里删除 `analysis_cache`（停服务后操作）。
   - 旧版本留下的无 `book_id/chapter_id` 的缓存行不会再命中，会随淘汰逐步消失。

8. **文档中的数据计数可能漂移**
   - 古地名/示例数据统计写在文档里，数据更新后需要同步；目前未加自动计数检查。
   - 内置样板 `meta.promptVersion` 固定为 `p1`，这是人工样板的元数据，不代表当前生成提示词版本（当前 `p17`）。

9. **E2E 测试产物**
   - Playwright 使用独立的 `.next-e2e/` 和 `.data-e2e/`，不会读写你的 `.data`。
   - 这些目录已被 gitignore，但运行 E2E 后会留在本机，可随时删除。
   - E2E 会在测试数据库写入假 key；不要把它当作真实配置。

10. **Docker 镜像未做签名/镜像扫描**
    - 已提供多阶段构建、非 root、健康检查、CI 构建工作流；尚未加入 SBOM、签名或漏洞扫描。
    - `history-atlas:local` 是本地构建标签，升级后重新 `docker compose up -d --build` 即可。

## 明确的非目标

- 不提供扫描件 OCR、竖排自动识别、原生 App、账号/云同步。
- 不把地图当作考古级坐标或军事仿真；模型定位仍是近似值。
