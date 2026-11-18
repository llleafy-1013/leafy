#!/bin/zsh
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  print '请先安装 Node.js 22.13 或以上版本。'
  read '?按回车退出…'
  exit 1
fi
npm start
