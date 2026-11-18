# leafy

个人项目总仓库，按以下结构维护：

```text
leafy/
├── 飞象评测平台/       # 完整项目仅保留本地，暂缓上传
└── portfolio/
    ├── doggo/
    ├── 瑶都/
    └── 爪爪日记/
```

## 项目

| 项目 | 内容 | 入口 |
|---|---|---|
| 飞象评测平台（EduBench） | 教育大模型真实调用、机评与人工评分中台 | 本地独立运行，源码暂未上传 |
| DOGGO | 犬种与城市探索、带宠搬家和生活照护前端原型 | [说明](portfolio/doggo/README.md) · [Demo](portfolio/doggo/index.html) |
| 爪爪日记 | 宠物成长记录响应式前端应用 | [说明](portfolio/爪爪日记/README.md) · [Demo](portfolio/爪爪日记/index.html) |
| 瑶都 | 瑶族非遗文化、纹样与文创网站 Axure 原型 | [说明](portfolio/瑶都/README.md) · [Demo](portfolio/瑶都/html/主页.html) |

## 本地查看

在仓库根目录运行：

```sh
python3 -m http.server 8000
```

访问 `http://localhost:8000`。各项目保留独立代码和相对资源路径。

## 发布与数据边界

GitHub Pages 只发布构建脚本明确列出的静态网页。飞象评测平台、API 密钥、`.env`、数据库及备份不进入仓库或 Pages。

原有四次 Git 提交保留，爪爪日记从仓库根目录完整迁入 `portfolio/爪爪日记`；本次当前目录只保留约定的项目范围。未纳入的项目及设计原稿继续保留本地。
