# Development

## Local layout

```txt
frontend/public/          Static pages and assets
backend/server.js         Local API and static server
backend/data/articles.json
backend/uploads/articles/ Uploaded article HTML files
```

## Run locally

```bash
cd backend
npm start
```

Open `http://127.0.0.1:3000/wechat/`.

## MVP article flow

1. Open the WeChat page.
2. Fill in title, optional slug, and optional summary.
3. Choose an `.html` file.
4. Submit the form.
5. The backend downloads WeChat CDN images, saves them locally, rewrites image URLs, and saves the HTML file plus article metadata.
6. Readers open the article page, which renders the uploaded HTML in a sandboxed iframe.

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

The WeChat page has a delete button on each article card. Deleting removes:

```txt
backend/data/articles.json metadata entry
backend/uploads/articles/{slug}/
```
