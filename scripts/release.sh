#!/usr/bin/env bash
# 自动改版本号、构建 Mac 包、打 tag 并推送。
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

echo ">>> 3. 提交并打 tag"
git add package.json package-lock.json
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"

echo ">>> 4. 推送分支与 tag"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"
git push origin "v$VERSION"

echo ""
echo "完成。版本 v$VERSION 已构建并推送。"
echo "请到 GitHub 为该 tag 创建 Release 并上传 release/ 下的 Mac 安装包与 latest-mac.yml。"
