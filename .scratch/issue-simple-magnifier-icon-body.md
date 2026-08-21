## 背景

当前品牌图标（#187）是「放大镜压在课表上」的复合构图，细节在浏览器标签页 16px 下不易辨认。改为更简单的放大镜图形，继续用作站点 favicon、apple-touch-icon、Open Graph 图与 README 图标。

## 范围

- 替换 `public/favicon.ico`、`favicon-16.png`、`favicon-32.png`、`apple-touch-icon.png`、`icon-512.png`
- 使用简单放大镜：白色镜圈 + 手柄，铺在站点 Sky accent 圆角方底上；不再画课表网格
- `index.html` / README 的引用路径保持不变
- 不改 AppShell 品牌字标

## 验收

- 各尺寸图标均为同一放大镜构图，16px 仍可辨认
- `index.html` 仍声明 favicon、apple-touch-icon、og:image
- README 顶部展示同一图标
- `vite build` 把 `public/` 中的图标复制到 `dist/`
