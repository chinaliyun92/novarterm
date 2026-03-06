# NovarTerm

NovarTerm is a desktop terminal built for modern DevOps workflows, with instant local/remote switching, a unified file browser, remote file transfer, flexible tab+pane layouts, and trigger automation.

## Advantages

1. Instant Local and Remote Switching  
Move between local shell and remote SSH sessions at any time without losing momentum.

2. Unified Visual File Browser for Local + Remote  
Browse, navigate, and manage local and remote directories in one consistent file pane.

3. Remote File Transfer with Drag-and-Drop Upload  
Upload and download files on remote servers, and drag files directly from desktop for quick upload.

4. Multi-Tab + Multi-Pane Workspace  
Run parallel tasks cleanly with tabs and split panes, with up to six panes in one tab.

5. Custom Trigger Automation  
Define output-based triggers to auto-send predefined actions for repetitive terminal interactions.

## 发布与自动更新

应用内置了基于 **electron-updater** 的自动更新（仅打包后生效）：启动约 12 秒后检查、设置里可手动检查；有更新时可下载并重启安装。

你需要做的配置：

1. **把构建产物发到 GitHub Releases**  
   当前脚本是 `npm run dist:mac` / `dist:win` 等（`--publish never`），产物在 `release/`。创建新 Release 后，**只需上传以下文件**（其余可忽略）：

   **必须上传（缺一不可）：**

   | 文件 | 说明 |
   |------|------|
   | `latest-mac.yml` | Mac 自动更新用：版本号与下载链接 |
   | `latest.yml` | Windows 自动更新用（仅当打了 win 包时存在） |
   | `latest-linux.yml` | Linux 自动更新用（仅当打了 linux 包时存在） |
   | `NovarTerm-0.1.0.dmg` | Mac 安装包（用户下载） |
   | `NovarTerm-0.1.0-mac.zip` | Mac 自动更新时实际下载的包（electron-updater 用） |
   | `NovarTerm Setup 0.1.0.exe` 等 | Windows 安装包（打 win 包时） |
   | `NovarTerm-0.1.0.AppImage` 等 | Linux 安装包（打 linux 包时） |

   **不必上传：**  
   `*.blockmap`（可选，用于增量更新）、`builder-debug.yml`、`builder-effective-config.yaml`、`mac/` / `win/` 等目录。

   同一版本的 Release 里，**该平台对应的 `latest-*.yml` 和它里面写的安装包文件名**要一起上传，否则自动更新会找不到文件。

2. **（可选）自动发布：用 CI 或本机带 token 发布**  
   若希望构建后自动发布到 GitHub，可使用：
   ```bash
   export GH_TOKEN=你的GitHub个人访问令牌
   npm run build && electron-builder --mac --publish always
   ```
   Token 需有 `repo` 权限。CI 里把 `GH_TOKEN` 设为 secret 即可。

3. **（仅 macOS）代码签名**  
   macOS 上自动更新安装需要应用已签名。若未配置签名，Mac 用户仍可手动从 Releases 下载安装。要启用 Mac 自动更新，请在 electron-builder 中配置 [code signing](https://www.electron.build/code-signing)。

4. **仓库与 owner**  
   当前更新源为 `chinaliyun92/novarterm`（在 `electron-builder.yml` 的 `publish` 里）。若仓库或 owner 不同，请修改该文件中的 `owner` / `repo`。

## Screenshots

![](docs/screenshots/01.png)

![](docs/screenshots/02.png)

![](docs/screenshots/03.png)

![](docs/screenshots/04.png)

![](docs/screenshots/05.png)
