# Conscient Blog

这是一个前后端分离的个人博客项目。前端是静态页面，主页作为个人空间入口，连接公众号、B站、项目、G.E.M. 等板块；后端是一个轻量的 Node.js 服务，主要负责公众号文章系统里的文章上传、GitHub 登录、管理员权限、评论点赞和本地数据保存。

## 目前功能

### 站点板块

- 主页：`/` 是整个博客的入口，有首屏展示、板块导航和卡片翻转动效。
- 公众号：`/wechat/` 是文章阅读与管理板块，用来沉淀长文、观察和阶段总结。
- B站：主页里的 B站入口会跳转到外部 Bilibili 空间。
- 项目：项目板块已经在主页入口中预留，目前还没有开始施工，后续会用于展示作品、实验和阶段成果。
- G.E.M.：`/gem/` 是独立主题页面，用来放和 G.E.M. 相关的内容与视觉表达。

### 公众号文章系统

- 文章阅读：`/wechat/` 展示已发表文章，阅读器页面用独立 iframe 打开文章正文。
- 文章上传：管理员可以上传微信公众号导出的 HTML 文章。
- 图片本地化：上传时会尝试下载微信 CDN 图片并替换为本地地址，减少外链失效风险。
- 文章日期：上传时需要填写日期，文章列表和阅读器都会展示这项信息。
- 文章排序：管理员可以在 `wechat/` 页面打开排序窗口，通过拖拽调整已发表文章顺序。
- GitHub 登录：用户通过 GitHub OAuth 登录，页面会显示 GitHub 用户名和头像。
- 权限控制：`ADMIN_GITHUB_LOGIN` 对应的 GitHub 账号是管理员；其他 GitHub 用户是普通用户。
- 管理员操作：管理员可以上传文章、删除文章、设置文章日期、调整文章顺序、删除评论。
- 普通用户权限：普通用户和未登录访客可以阅读文章；登录用户可以评论和点赞。
- 评论与点赞：文章页支持文章点赞、评论发布、评论点赞；评论会展示 GitHub 头像和 username。
- 数据保存：文章元数据保存在 JSON 文件里，评论和点赞保存在 SQLite 数据库里。

## 本地启动

第一次运行先安装后端依赖：

```bash
cd backend
npm install
```

之后启动服务：

```bash
npm start
```

打开：

```txt
http://127.0.0.1:3000/
http://127.0.0.1:3000/wechat/
http://127.0.0.1:3000/gem/
```

## GitHub 登录配置

需要先在 GitHub 创建一个 OAuth App，并把 callback URL 设置为：

```txt
http://127.0.0.1:3000/auth/github/callback
```

复制环境变量示例文件：

```bash
copy backend\.env.example backend\.env
```

然后在 `backend/.env` 里填写：

```txt
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
SESSION_SECRET=replace_with_a_long_random_secret
ADMIN_GITHUB_LOGIN=conscient2025
APP_ORIGIN=http://127.0.0.1:3000
```

也可以在 PowerShell 里临时设置：

```powershell
$env:GITHUB_CLIENT_ID="your_client_id"
$env:GITHUB_CLIENT_SECRET="your_client_secret"
$env:SESSION_SECRET="replace_with_a_long_random_secret"
$env:ADMIN_GITHUB_LOGIN="conscient2025"
$env:APP_ORIGIN="http://127.0.0.1:3000"
npm start
```

`ADMIN_GITHUB_LOGIN` 必须填写你的 GitHub username。只有这个账号登录后会被识别为管理员，其他账号都会被识别为普通用户。

## 数据与文件

文章元数据：

```txt
backend/data/articles.json
```

文章 HTML 和本地化图片：

```txt
backend/uploads/articles/
```

评论、文章点赞、评论点赞：

```txt
backend/data/blog.sqlite
```

部署到云服务器后，需要持久化并备份 `backend/data/` 和 `backend/uploads/articles/`。`.env` 里的 GitHub OAuth 密钥和 `SESSION_SECRET` 不要提交到 git。

## 部署提醒

部署到正式域名后，需要把 GitHub OAuth App 的 callback URL 改成线上地址，例如：

```txt
https://your-domain.com/auth/github/callback
```

同时把线上环境变量里的 `APP_ORIGIN` 改成你的正式域名：

```txt
APP_ORIGIN=https://your-domain.com
```
