# Development

## Local layout

```txt
frontend/public/          Static pages and assets
backend/server.js         Local API and static server
backend/data/articles.json
backend/data/blog.sqlite  Comments and likes database
backend/uploads/articles/ Uploaded article HTML files
```

## Run locally

```bash
cd backend
npm start
```

Open `http://127.0.0.1:3000/wechat/`.

## GitHub OAuth setup

Create a GitHub OAuth App:

```txt
Homepage URL: http://127.0.0.1:3000/
Authorization callback URL: http://127.0.0.1:3000/auth/github/callback
```

Copy `backend/.env.example` to `backend/.env`, then fill in the values:

```txt
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
SESSION_SECRET=replace_with_a_long_random_secret
ADMIN_GITHUB_LOGIN=conscient2025
APP_ORIGIN=http://127.0.0.1:3000
```

Or set the same values in PowerShell before running:

```powershell
$env:GITHUB_CLIENT_ID="your_client_id"
$env:GITHUB_CLIENT_SECRET="your_client_secret"
$env:SESSION_SECRET="replace_with_a_long_random_secret"
$env:ADMIN_GITHUB_LOGIN="conscient2025"
$env:APP_ORIGIN="http://127.0.0.1:3000"
npm start
```

The default admin login is `conscient2025`. Override `ADMIN_GITHUB_LOGIN` if the admin GitHub username changes.

## MVP article flow

1. Open the WeChat page.
2. Fill in title, article date, optional slug, and optional summary.
3. Choose an `.html` file.
4. Submit the form.
5. The backend downloads WeChat CDN images, saves them locally, rewrites image URLs, and saves the HTML file plus article metadata.
6. Readers open the article page, which renders the uploaded HTML in a sandboxed iframe.

Article dates are stored as `YYYY-MM-DD` and displayed on the article cards and reader page.

## Image localization

During upload, the backend scans `<img>` tags for `src` and `data-src` values from:

```txt
mmbiz.qpic.cn
mmbiz.qlogo.cn
```

Matched images are downloaded into:

```txt
backend/uploads/articles/{slug}/images/
```

The saved article HTML points to local paths such as:

```txt
/uploads/articles/{slug}/images/001.jpg
```

If an image fails to download, the article is still published and the failure is recorded in `imageFailures`.

## Delete articles

The WeChat page shows upload and delete controls only when the signed-in GitHub user matches `ADMIN_GITHUB_LOGIN`. The backend also enforces this on `/api/admin/articles`.

Admins can use the WeChat page's order dialog to drag articles into a custom display order. The backend stores that order in each article's `sortOrder` field.

Deleting removes:

```txt
backend/data/articles.json metadata entry
backend/uploads/articles/{slug}/
SQLite comments and likes for that article
```

## Comments and likes

Comments and likes are stored in SQLite through `better-sqlite3`:

```txt
backend/data/blog.sqlite
backend/data/blog.sqlite-wal
backend/data/blog.sqlite-shm
```

Readers can view comments and like counts without signing in. Posting comments, liking articles, and liking comments require GitHub login. The comment list displays the GitHub avatar and username from the signed session; the backend does not trust author data from the browser.

Admins can delete comments from the WeChat management page. There is no hide or restore workflow.
