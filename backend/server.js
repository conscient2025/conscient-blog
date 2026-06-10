const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const Database = require('better-sqlite3');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(path.resolve(__dirname, '..'), '.env'));

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'frontend', 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads', 'articles');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const DATABASE_FILE = path.join(DATA_DIR, 'blog.sqlite');
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_COMMENT_CHARS = 1000;
const IMAGE_HOSTS = new Set(['mmbiz.qpic.cn', 'mmbiz.qlogo.cn']);
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
function normalizeGithubLogin(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^@+/, '')
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

const ADMIN_GITHUB_LOGIN = normalizeGithubLogin(process.env.ADMIN_GITHUB_LOGIN || 'conscient2025');
const SESSION_COOKIE = 'conscient_session';
const OAUTH_STATE_COOKIE = 'conscient_oauth_state';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set; generated sessions will be invalid after server restart.');
}

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

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DATABASE_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    article_slug TEXT NOT NULL,
    github_id INTEGER NOT NULL,
    github_login TEXT NOT NULL,
    github_avatar_url TEXT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_comments_article_created
    ON comments (article_slug, created_at DESC);

  CREATE TABLE IF NOT EXISTS article_likes (
    article_slug TEXT NOT NULL,
    github_id INTEGER NOT NULL,
    github_login TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (article_slug, github_id)
  );

  CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id TEXT NOT NULL,
    github_id INTEGER NOT NULL,
    github_login TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (comment_id, github_id),
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );
`);

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

function compareArticles(a, b) {
  const aOrder = Number(a.sortOrder);
  const bOrder = Number(b.sortOrder);
  const hasAOrder = Number.isFinite(aOrder);
  const hasBOrder = Number.isFinite(bOrder);

  if (hasAOrder && hasBOrder && aOrder !== bOrder) return aOrder - bOrder;
  if (hasAOrder !== hasBOrder) return hasAOrder ? -1 : 1;
  return String(b.createdAt).localeCompare(String(a.createdAt));
}

function normalizePublishDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
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

function sendRedirect(res, location, headers = {}) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end();
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64url');
}

function sign(value) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(value)
    .digest('base64url');
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function packSignedJson(payload) {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function unpackSignedJson(value) {
  if (!value || !value.includes('.')) return null;
  const [encoded, signature] = value.split('.', 2);
  if (!timingSafeEqualString(signature, sign(encoded))) return null;

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function getOrigin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/+$/, '');
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  return `${protocol}://${req.headers.host || `127.0.0.1:${PORT}`}`;
}

function cookieHeader(req, name, value, options = {}) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (options.maxAge !== undefined) attributes.push(`Max-Age=${options.maxAge}`);
  if (getOrigin(req).startsWith('https://')) attributes.push('Secure');
  return attributes.join('; ');
}

function clearCookieHeader(req, name) {
  return cookieHeader(req, name, '', { maxAge: 0 });
}

function publicUser(session) {
  if (!session || !session.user) return null;
  const login = String(session.user.login || '');
  return {
    id: session.user.id,
    login,
    name: session.user.name || '',
    avatarUrl: session.user.avatarUrl || '',
    htmlUrl: session.user.htmlUrl || '',
    role: normalizeGithubLogin(login) === ADMIN_GITHUB_LOGIN ? 'admin' : 'user'
  };
}

function getSession(req) {
  const cookies = parseCookies(req);
  const session = unpackSignedJson(cookies[SESSION_COOKIE]);
  if (!session || !session.user || Number(session.expiresAt || 0) < Date.now()) {
    return null;
  }
  return session;
}

function getCurrentUser(req) {
  return publicUser(getSession(req));
}

function requireAdmin(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    sendError(res, 401, 'Please sign in with GitHub first.');
    return null;
  }
  if (user.role !== 'admin') {
    sendError(res, 403, 'Only the site administrator can change articles.');
    return null;
  }
  return user;
}

function requireUser(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    sendError(res, 401, 'Please sign in with GitHub first.');
    return null;
  }
  return user;
}

async function findPublishedArticle(slug) {
  const articles = await readArticles();
  return articles.find(item => item.slug === slug && item.status === 'published') || null;
}

function serializeComment(row) {
  return {
    id: row.id,
    articleSlug: row.article_slug,
    body: row.body,
    createdAt: row.created_at,
    author: {
      githubId: row.github_id,
      login: row.github_login,
      avatarUrl: row.github_avatar_url || ''
    },
    likeCount: Number(row.like_count || 0),
    likedByMe: Boolean(row.liked_by_me)
  };
}

function getArticleReaction(slug, user) {
  const likeCount = db.prepare('SELECT COUNT(*) AS count FROM article_likes WHERE article_slug = ?').get(slug).count;
  const likedByMe = user
    ? Boolean(db.prepare('SELECT 1 FROM article_likes WHERE article_slug = ? AND github_id = ?').get(slug, user.id))
    : false;
  return {
    likeCount: Number(likeCount || 0),
    likedByMe
  };
}

async function exchangeGithubCode(code, redirectUri) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'ConscientBlog/0.1'
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri
    })
  });
  const data = await response.json();
  if (!response.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || 'GitHub token exchange failed');
  }
  return data.access_token;
}

async function fetchGithubUser(accessToken) {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'ConscientBlog/0.1',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  const user = await response.json();
  if (!response.ok || !user.login) {
    throw new Error(user.message || 'GitHub user fetch failed');
  }
  return {
    id: user.id,
    login: user.login,
    name: user.name || '',
    avatarUrl: user.avatar_url || '',
    htmlUrl: user.html_url || ''
  };
}

function createSessionCookie(req, githubUser) {
  const session = {
    user: githubUser,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000
  };
  return cookieHeader(req, SESSION_COOKIE, packSignedJson(session), { maxAge: SESSION_TTL_SECONDS });
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

function imageDownloadCandidates(url) {
  const candidates = [];
  const addCandidate = value => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };

  addCandidate(url);

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      const httpUrl = new URL(parsed);
      httpUrl.protocol = 'http:';
      addCandidate(httpUrl.toString());
    }

    for (const value of [...candidates]) {
      const cleaned = new URL(value);
      ['tp', 'wxfrom', 'wx_lazy', 'wx_co', 'retryload', 'scene'].forEach(param => {
        cleaned.searchParams.delete(param);
      });
      addCandidate(cleaned.toString());

      if (cleaned.protocol === 'https:') {
        const httpCleaned = new URL(cleaned);
        httpCleaned.protocol = 'http:';
        addCandidate(httpCleaned.toString());
      }
    }
  } catch {
    return candidates;
  }

  return candidates;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        Referer: 'https://mp.weixin.qq.com/'
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadImage(url, fileBasePath) {
  let lastError = null;

  for (const candidate of imageDownloadCandidates(url)) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetchImage(candidate);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) {
          throw new Error('empty image response');
        }

        const contentType = response.headers.get('content-type') || '';
        const ext = extensionFromImage(candidate, contentType);
        const filePath = `${fileBasePath}${ext}`;
        await fsp.writeFile(filePath, buffer);
        return { filePath, ext };
      } catch (error) {
        lastError = error;
        if (attempt === 1) await wait(250);
      }
    }
  }

  throw new Error(`图片下载失败：${url}（${lastError ? lastError.message : 'unknown error'}）`);
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

async function handleAuth(req, res, pathname, searchParams) {
  if (req.method === 'GET' && pathname === '/auth/github') {
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      return sendError(res, 500, 'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
    }

    const state = crypto.randomBytes(24).toString('base64url');
    const redirectUri = `${getOrigin(req)}/auth/github/callback`;
    const authUrl = new URL(GITHUB_AUTH_URL);
    authUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'read:user');
    authUrl.searchParams.set('state', state);

    return sendRedirect(res, authUrl.toString(), {
      'Set-Cookie': cookieHeader(req, OAUTH_STATE_COOKIE, packSignedJson({
        state,
        expiresAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000
      }), { maxAge: OAUTH_STATE_TTL_SECONDS })
    });
  }

  if (req.method === 'GET' && pathname === '/auth/github/callback') {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const cookies = parseCookies(req);
    const storedState = unpackSignedJson(cookies[OAUTH_STATE_COOKIE]);
    const clearState = clearCookieHeader(req, OAUTH_STATE_COOKIE);

    if (!code || !state || !storedState || storedState.expiresAt < Date.now() || storedState.state !== state) {
      return sendRedirect(res, '/wechat/?login=failed', { 'Set-Cookie': clearState });
    }

    try {
      const redirectUri = `${getOrigin(req)}/auth/github/callback`;
      const accessToken = await exchangeGithubCode(code, redirectUri);
      const githubUser = await fetchGithubUser(accessToken);
      return sendRedirect(res, '/wechat/?login=success', {
        'Set-Cookie': [
          clearState,
          createSessionCookie(req, githubUser)
        ]
      });
    } catch (error) {
      console.error(error);
      return sendRedirect(res, '/wechat/?login=failed', { 'Set-Cookie': clearState });
    }
  }

  if (req.method === 'POST' && pathname === '/auth/logout') {
    return sendJsonWithHeaders(res, 200, { ok: true }, {
      'Set-Cookie': clearCookieHeader(req, SESSION_COOKIE)
    });
  }

  return false;
}

function sendJsonWithHeaders(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/me') {
    return sendJson(res, 200, {
      user: getCurrentUser(req),
      adminLogin: ADMIN_GITHUB_LOGIN
    });
  }

  if (req.method === 'GET' && pathname === '/api/articles') {
    const articles = await readArticles();
    const published = articles
      .filter(article => article.status === 'published')
      .sort(compareArticles);
    return sendJson(res, 200, { articles: published });
  }

  const articleMatch = pathname.match(/^\/api\/articles\/([a-z0-9-]+)$/);
  if (req.method === 'GET' && articleMatch) {
    const articles = await readArticles();
    const article = articles.find(item => item.slug === articleMatch[1] && item.status === 'published');
    if (!article) return sendError(res, 404, '文章不存在');
    return sendJson(res, 200, { article });
  }

  const articleCommentsMatch = pathname.match(/^\/api\/articles\/([a-z0-9-]+)\/comments$/);
  if (req.method === 'GET' && articleCommentsMatch) {
    const slug = articleCommentsMatch[1];
    const article = await findPublishedArticle(slug);
    if (!article) return sendError(res, 404, '文章不存在');

    const user = getCurrentUser(req);
    const rows = db.prepare(`
      SELECT
        comments.*,
        COUNT(comment_likes.github_id) AS like_count,
        EXISTS(
          SELECT 1
          FROM comment_likes mine
          WHERE mine.comment_id = comments.id AND mine.github_id = ?
        ) AS liked_by_me
      FROM comments
      LEFT JOIN comment_likes ON comment_likes.comment_id = comments.id
      WHERE comments.article_slug = ?
      GROUP BY comments.id
      ORDER BY comments.created_at DESC
    `).all(user ? user.id : null, slug);

    return sendJson(res, 200, { comments: rows.map(serializeComment) });
  }

  if (req.method === 'POST' && articleCommentsMatch) {
    const user = requireUser(req, res);
    if (!user) return;

    const slug = articleCommentsMatch[1];
    const article = await findPublishedArticle(slug);
    if (!article) return sendError(res, 404, '文章不存在');

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return sendError(res, 400, error.message || '请求体不是有效 JSON');
    }

    const body = String(payload.body || '').trim();
    if (!body) return sendError(res, 400, '请填写评论内容');
    if (body.length > MAX_COMMENT_CHARS) {
      return sendError(res, 400, `评论不能超过 ${MAX_COMMENT_CHARS} 个字符`);
    }

    const now = new Date().toISOString();
    const comment = {
      id: crypto.randomUUID(),
      article_slug: slug,
      github_id: user.id,
      github_login: user.login,
      github_avatar_url: user.avatarUrl || '',
      body,
      created_at: now
    };
    db.prepare(`
      INSERT INTO comments (id, article_slug, github_id, github_login, github_avatar_url, body, created_at)
      VALUES (@id, @article_slug, @github_id, @github_login, @github_avatar_url, @body, @created_at)
    `).run(comment);

    return sendJson(res, 201, {
      comment: serializeComment({ ...comment, like_count: 0, liked_by_me: 0 })
    });
  }

  const articleReactionsMatch = pathname.match(/^\/api\/articles\/([a-z0-9-]+)\/reactions$/);
  if (req.method === 'GET' && articleReactionsMatch) {
    const slug = articleReactionsMatch[1];
    const article = await findPublishedArticle(slug);
    if (!article) return sendError(res, 404, '文章不存在');

    return sendJson(res, 200, {
      reactions: getArticleReaction(slug, getCurrentUser(req))
    });
  }

  const articleLikeMatch = pathname.match(/^\/api\/articles\/([a-z0-9-]+)\/like$/);
  if ((req.method === 'POST' || req.method === 'DELETE') && articleLikeMatch) {
    const user = requireUser(req, res);
    if (!user) return;

    const slug = articleLikeMatch[1];
    const article = await findPublishedArticle(slug);
    if (!article) return sendError(res, 404, '文章不存在');

    if (req.method === 'POST') {
      db.prepare(`
        INSERT OR IGNORE INTO article_likes (article_slug, github_id, github_login, created_at)
        VALUES (?, ?, ?, ?)
      `).run(slug, user.id, user.login, new Date().toISOString());
    } else {
      db.prepare('DELETE FROM article_likes WHERE article_slug = ? AND github_id = ?').run(slug, user.id);
    }

    return sendJson(res, 200, {
      reactions: getArticleReaction(slug, user)
    });
  }

  const commentLikeMatch = pathname.match(/^\/api\/comments\/([a-f0-9-]+)\/like$/);
  if ((req.method === 'POST' || req.method === 'DELETE') && commentLikeMatch) {
    const user = requireUser(req, res);
    if (!user) return;

    const commentId = commentLikeMatch[1];
    const comment = db.prepare('SELECT id FROM comments WHERE id = ?').get(commentId);
    if (!comment) return sendError(res, 404, '评论不存在');

    if (req.method === 'POST') {
      db.prepare(`
        INSERT OR IGNORE INTO comment_likes (comment_id, github_id, github_login, created_at)
        VALUES (?, ?, ?, ?)
      `).run(commentId, user.id, user.login, new Date().toISOString());
    } else {
      db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND github_id = ?').run(commentId, user.id);
    }

    const stats = db.prepare(`
      SELECT
        COUNT(comment_likes.github_id) AS like_count,
        EXISTS(
          SELECT 1
          FROM comment_likes mine
          WHERE mine.comment_id = ? AND mine.github_id = ?
        ) AS liked_by_me
      FROM comment_likes
      WHERE comment_likes.comment_id = ?
    `).get(commentId, user.id, commentId);

    return sendJson(res, 200, {
      commentId,
      likeCount: Number(stats.like_count || 0),
      likedByMe: Boolean(stats.liked_by_me)
    });
  }

  if (req.method === 'GET' && pathname === '/api/admin/comments') {
    if (!requireAdmin(req, res)) return;

    const rows = db.prepare(`
      SELECT
        comments.*,
        COUNT(comment_likes.github_id) AS like_count,
        0 AS liked_by_me
      FROM comments
      LEFT JOIN comment_likes ON comment_likes.comment_id = comments.id
      GROUP BY comments.id
      ORDER BY comments.created_at DESC
      LIMIT 200
    `).all();
    const articles = await readArticles();
    const articleTitles = new Map(articles.map(article => [article.slug, article.title]));

    return sendJson(res, 200, {
      comments: rows.map(row => ({
        ...serializeComment(row),
        articleTitle: articleTitles.get(row.article_slug) || row.article_slug
      }))
    });
  }

  const adminCommentMatch = pathname.match(/^\/api\/admin\/comments\/([a-f0-9-]+)$/);
  if (req.method === 'DELETE' && adminCommentMatch) {
    if (!requireAdmin(req, res)) return;

    const result = db.prepare('DELETE FROM comments WHERE id = ?').run(adminCommentMatch[1]);
    if (!result.changes) return sendError(res, 404, '评论不存在');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'PATCH' && pathname === '/api/admin/articles/order') {
    if (!requireAdmin(req, res)) return;

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return sendError(res, 400, error.message || '请求体不是有效 JSON');
    }

    const slugs = Array.isArray(payload.slugs) ? payload.slugs.map(slug => String(slug || '').trim()) : [];
    if (!slugs.length) return sendError(res, 400, '请提供文章排序');

    const uniqueSlugs = new Set(slugs);
    if (uniqueSlugs.size !== slugs.length) return sendError(res, 400, '文章排序中有重复项');

    const articles = await readArticles();
    const published = articles.filter(article => article.status === 'published');
    const publishedSlugs = new Set(published.map(article => article.slug));
    if (published.length !== slugs.length || slugs.some(slug => !publishedSlugs.has(slug))) {
      return sendError(res, 400, '排序列表必须包含全部已发表文章');
    }

    const orderBySlug = new Map(slugs.map((slug, index) => [slug, index]));
    articles.forEach(article => {
      if (orderBySlug.has(article.slug)) {
        article.sortOrder = orderBySlug.get(article.slug);
      }
    });
    await writeArticles(articles);

    const sorted = articles
      .filter(article => article.status === 'published')
      .sort(compareArticles);
    return sendJson(res, 200, { articles: sorted });
  }

  if (req.method === 'POST' && pathname === '/api/admin/articles') {
    if (!requireAdmin(req, res)) return;

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return sendError(res, 400, error.message || '请求体不是有效 JSON');
    }

    const title = String(payload.title || '').trim();
    const html = String(payload.html || '').trim();
    const publishDate = normalizePublishDate(payload.publishDate);
    if (!title) return sendError(res, 400, '请填写文章标题');
    if (!html) return sendError(res, 400, '请上传 HTML 文件内容');
    if (!publishDate) return sendError(res, 400, '请填写有效日期，格式为 YYYY-MM-DD');

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
      publishDate,
      localImageCount: localized.imageCount,
      imageFailures: localized.imageFailures,
      sortOrder: existing ? existing.sortOrder : -Date.now(),
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
    if (!requireAdmin(req, res)) return;

    const slug = adminArticleMatch[1];
    const articles = await readArticles();
    const index = articles.findIndex(item => item.slug === slug);
    if (index === -1) return sendError(res, 404, '文章不存在');

    const [removed] = articles.splice(index, 1);
    await writeArticles(articles);
    db.prepare('DELETE FROM comments WHERE article_slug = ?').run(slug);
    db.prepare('DELETE FROM article_likes WHERE article_slug = ?').run(slug);
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

    if (pathname.startsWith('/auth/')) {
      const handled = await handleAuth(req, res, pathname, url.searchParams);
      if (handled !== false) return;
    }

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
