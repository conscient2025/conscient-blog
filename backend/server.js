const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'frontend', 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads', 'articles');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const IMAGE_HOSTS = new Set(['mmbiz.qpic.cn', 'mmbiz.qlogo.cn']);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

async function ensureStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(ARTICLES_FILE)) {
    await fsp.writeFile(ARTICLES_FILE, '[]\n', 'utf8');
  }
}

async function readArticles() {
  await ensureStorage();
  const raw = await fsp.readFile(ARTICLES_FILE, 'utf8');
  const articles = JSON.parse(raw || '[]');
  return Array.isArray(articles) ? articles : [];
}

async function writeArticles(articles) {
  await ensureStorage();
  await fsp.writeFile(ARTICLES_FILE, `${JSON.stringify(articles, null, 2)}\n`, 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function normalizeSlug(value, fallback) {
  const base = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `article-${Date.now()}`;
}

function articleSummary(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeImageUrl(value) {
  const decoded = decodeHtmlAttribute(value).trim();
  if (!decoded || decoded.startsWith('data:')) return null;
  const absolute = decoded.startsWith('//') ? `https:${decoded}` : decoded;

  try {
    const url = new URL(absolute);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (!IMAGE_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extensionFromImage(url, contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const byType = {
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
  };
  if (byType[type]) return byType[type];

  try {
    const parsed = new URL(url);
    const wxFmt = parsed.searchParams.get('wx_fmt');
    if (wxFmt) {
      const normalized = wxFmt.toLowerCase().replace('jpeg', 'jpg');
      if (['gif', 'jpg', 'png', 'webp'].includes(normalized)) {
        return `.${normalized}`;
      }
    }

    const ext = path.extname(parsed.pathname).toLowerCase();
    if (['.gif', '.jpeg', '.jpg', '.png', '.webp'].includes(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch {
    return '.jpg';
  }

  return '.jpg';
}

async function downloadImage(url, fileBasePath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 ConscientBlog/0.1',
      Referer: 'https://mp.weixin.qq.com/'
    }
  });

  if (!response.ok) {
    throw new Error(`图片下载失败 ${response.status}: ${url}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const ext = extensionFromImage(url, contentType);
  const filePath = `${fileBasePath}${ext}`;
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(filePath, buffer);
  return { filePath, ext };
}

async function localizeWechatImages(html, slug) {
  const imageDir = path.join(UPLOAD_DIR, slug, 'images');
  await fsp.mkdir(imageDir, { recursive: true });

  const imgTagPattern = /<img\b[^>]*>/gi;
  const attrPattern = /\s(src|data-src)=["']([^"']+)["']/gi;
  const sources = new Map();
  let tagMatch;

  while ((tagMatch = imgTagPattern.exec(html)) !== null) {
    const tag = tagMatch[0];
    let attrMatch;
    while ((attrMatch = attrPattern.exec(tag)) !== null) {
      const normalizedUrl = normalizeImageUrl(attrMatch[2]);
      if (normalizedUrl && !sources.has(normalizedUrl)) {
        sources.set(normalizedUrl, null);
      }
    }
  }

  const failures = [];
  let index = 1;
  for (const url of sources.keys()) {
    try {
      const baseName = String(index).padStart(3, '0');
      const { ext } = await downloadImage(url, path.join(imageDir, baseName));
      sources.set(url, `/uploads/articles/${slug}/images/${baseName}${ext}`);
      index += 1;
    } catch (error) {
      failures.push(error.message);
    }
  }

  const rewrittenHtml = html.replace(imgTagPattern, tag => {
    let firstLocalUrl = '';
    let hasSrc = /\ssrc=["'][^"']*["']/i.test(tag);
    const replaced = tag.replace(attrPattern, (full, attrName, rawValue) => {
      const normalizedUrl = normalizeImageUrl(rawValue);
      const localUrl = normalizedUrl ? sources.get(normalizedUrl) : null;
      if (localUrl) firstLocalUrl ||= localUrl;
      return localUrl ? ` ${attrName}="${localUrl}"` : full;
    });
    if (!hasSrc && firstLocalUrl) {
      return replaced.replace(/<img\b/i, `<img src="${firstLocalUrl}"`);
    }
    return replaced;
  });

  return {
    html: rewrittenHtml,
    imageCount: [...sources.values()].filter(Boolean).length,
    imageFailures: failures
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('上传内容太大，请控制在 15MB 以内'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeJoin(baseDir, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const joined = path.normalize(path.join(baseDir, decoded));
  if (!joined.startsWith(baseDir)) return null;
  return joined;
}

async function serveFile(res, filePath, extraHeaders = {}) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      return serveFile(res, path.join(filePath, 'index.html'), extraHeaders);
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      ...extraHeaders
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/articles') {
    const articles = await readArticles();
    const published = articles
      .filter(article => article.status === 'published')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return sendJson(res, 200, { articles: published });
  }

  const articleMatch = pathname.match(/^\/api\/articles\/([a-z0-9-]+)$/);
  if (req.method === 'GET' && articleMatch) {
    const articles = await readArticles();
    const article = articles.find(item => item.slug === articleMatch[1] && item.status === 'published');
    if (!article) return sendError(res, 404, '文章不存在');
    return sendJson(res, 200, { article });
  }

  if (req.method === 'POST' && pathname === '/api/admin/articles') {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return sendError(res, 400, error.message || '请求体不是有效 JSON');
    }

    const title = String(payload.title || '').trim();
    const html = String(payload.html || '').trim();
    if (!title) return sendError(res, 400, '请填写文章标题');
    if (!html) return sendError(res, 400, '请上传 HTML 文件内容');

    const now = new Date().toISOString();
    const slug = normalizeSlug(payload.slug, title);
    const articleDir = path.join(UPLOAD_DIR, slug);
    const filePath = path.join(articleDir, 'content.html');
    const articles = await readArticles();
    const existing = articles.find(item => item.slug === slug);
    const localized = await localizeWechatImages(html, slug);
    const article = {
      id: existing ? existing.id : crypto.randomUUID(),
      slug,
      title,
      summary: String(payload.summary || '').trim() || articleSummary(localized.html),
      htmlPath: `/articles/${slug}/content`,
      localImageCount: localized.imageCount,
      imageFailures: localized.imageFailures,
      status: 'published',
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    await fsp.mkdir(articleDir, { recursive: true });
    await fsp.writeFile(filePath, localized.html, 'utf8');
    if (existing) {
      Object.assign(existing, article);
    } else {
      articles.unshift(article);
    }
    await writeArticles(articles);
    return sendJson(res, existing ? 200 : 201, { article });
  }

  const adminArticleMatch = pathname.match(/^\/api\/admin\/articles\/([a-z0-9-]+)$/);
  if (req.method === 'DELETE' && adminArticleMatch) {
    const slug = adminArticleMatch[1];
    const articles = await readArticles();
    const index = articles.findIndex(item => item.slug === slug);
    if (index === -1) return sendError(res, 404, '文章不存在');

    const [removed] = articles.splice(index, 1);
    await writeArticles(articles);
    await fsp.rm(path.join(UPLOAD_DIR, slug), { recursive: true, force: true });
    await fsp.rm(path.join(UPLOAD_DIR, `${slug}.html`), { force: true });
    return sendJson(res, 200, { article: removed });
  }

  return sendError(res, 404, 'API 路由不存在');
}

async function handleArticleContent(res, pathname) {
  const match = pathname.match(/^\/articles\/([a-z0-9-]+)\/content$/);
  if (!match) return false;

  const articles = await readArticles();
  const article = articles.find(item => item.slug === match[1] && item.status === 'published');
  if (!article) {
    sendError(res, 404, '文章不存在');
    return true;
  }

  const contentPath = path.join(UPLOAD_DIR, article.slug, 'content.html');
  const legacyPath = path.join(UPLOAD_DIR, `${article.slug}.html`);
  const filePath = fs.existsSync(contentPath) ? contentPath : legacyPath;

  await serveFile(res, filePath, {
    'Content-Security-Policy': "script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
    'Cache-Control': 'no-store'
  });
  return true;
}

async function handleUploads(res, pathname) {
  if (!pathname.startsWith('/uploads/')) return false;
  const relativePath = pathname.replace(/^\/uploads\//, '');
  const filePath = safeJoin(path.join(__dirname, 'uploads'), relativePath);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }
  await serveFile(res, filePath, { 'Cache-Control': 'public, max-age=31536000, immutable' });
  return true;
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }

    if (await handleArticleContent(res, pathname)) {
      return;
    }

    if (await handleUploads(res, pathname)) {
      return;
    }

    const staticPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = safeJoin(PUBLIC_DIR, staticPath);
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    await serveFile(res, filePath);
  } catch (error) {
    sendError(res, 500, error.message || '服务器错误');
  }
}

ensureStorage()
  .then(() => {
    http.createServer(handleRequest).listen(PORT, () => {
      console.log(`Conscient blog server: http://127.0.0.1:${PORT}`);
    });
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
