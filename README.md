# Conscient Blog

Local-first blog project with a static frontend and a small Node.js backend for the article reader MVP.

## Start

```bash
cd backend
npm start
```

Then visit:

```txt
http://127.0.0.1:3000/
http://127.0.0.1:3000/wechat/
```

The WeChat page can upload article HTML, localize WeChat CDN images, list published articles, open articles in a sandboxed reader, and delete existing articles.

## GitHub login

Create a GitHub OAuth App and set the callback URL to:

```txt
http://127.0.0.1:3000/auth/github/callback
```

Copy `backend/.env.example` to `backend/.env`, then fill in the values:

```txt
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
SESSION_SECRET=replace_with_a_long_random_secret
ADMIN_GITHUB_LOGIN=conscient2025
APP_ORIGIN=http://127.0.0.1:3000
```

Or set the same values in PowerShell before starting the backend:

```powershell
$env:GITHUB_CLIENT_ID="your_client_id"
$env:GITHUB_CLIENT_SECRET="your_client_secret"
$env:SESSION_SECRET="replace_with_a_long_random_secret"
$env:ADMIN_GITHUB_LOGIN="conscient2025"
$env:APP_ORIGIN="http://127.0.0.1:3000"
npm start
```

`ADMIN_GITHUB_LOGIN` is the only GitHub account that can upload or delete articles in `wechat/`. Everyone else can read articles only.
