#!/usr/bin/env bash
# 自动改版本号、构建 Mac 包、提交并推送源码到 origin。
# Tag/Release 由人工在仓库中处理。
# 用法: ./scripts/release.sh [patch|minor|major]
# 示例: ./scripts/release.sh patch
set -e

BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "用法: $0 [patch|minor|major]"
  echo "  版本: patch=0.0.x  minor=0.x.0  major=x.0.0"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -n $(git status -s --porcelain) ]]; then
  echo "错误: 工作区有未提交改动，请先 commit 或 stash。"
  git status -s
  exit 1
fi

echo ">>> 1. 升级版本号 ($BUMP)"
npm version "$BUMP" --no-git-tag-version
npm install --package-lock-only
VERSION=$(node -p "require('./package.json').version")
echo "    新版本: $VERSION"

echo ">>> 2. 构建 Mac"
npm run dist:mac

echo ">>> 3. 提交版本变更"
git add package.json package-lock.json
git commit -m "chore: release v$VERSION"

echo ">>> 4. 推送源码分支到 origin"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"

if [[ "$(uname -s)" == "Darwin" ]]; then
  open "$ROOT/release"
fi

echo ""
echo "完成。版本 v$VERSION 已构建并推送到源码仓库。"
echo "请手动在发布仓库创建 tag/release，并上传 release/ 下的 Mac 安装包。"
echo "自动更新需要至少上传：latest-mac.yml 和 NovarTerm-${VERSION}-mac.zip（universal）。"
echo "另外也会产出：NovarTerm-${VERSION}-arm64-mac.zip 和 NovarTerm-${VERSION}-x64-mac.zip。"
