const SESSION_COOKIE = "dg_editor_session";
const STATE_COOKIE = "dg_oauth_state";
const SESSION_TTL = 60 * 60 * 8;

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "content-type": "application/json; charset=UTF-8", ...(headers || {}) } });
}
function text(body, status) {
  return new Response(body, { status: status || 200, headers: { "content-type": "text/plain; charset=UTF-8" } });
}
function cookie(request, name) {
  const header = request.headers.get("cookie") || "";
  return header.split(";").map(value => value.trim()).find(value => value.startsWith(name + "="))?.slice(name.length + 1) || "";
}
function setCookie(name, value, age) {
  return name + "=" + value + "; Max-Age=" + age + "; Path=/; HttpOnly; Secure; SameSite=Lax";
}
function b64url(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
async function aesKey(secret) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(JSON.stringify(value)));
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv); result.set(new Uint8Array(encrypted), iv.length);
  return b64url(result);
}
async function unseal(value, secret) {
  if (!value || !secret) return null;
  try {
    const bytes = unb64url(value);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await aesKey(secret), bytes.slice(12));
    const session = JSON.parse(new TextDecoder().decode(plain));
    return session.exp > Math.floor(Date.now() / 1000) ? session : null;
  } catch { return null; }
}
function settings(env) {
  const repo = env.GITHUB_REPOSITORY || "nkwlmq1/learning-tree";
  const parts = repo.split("/");
  return { owner: parts[0], repo: parts[1], branch: env.GITHUB_BRANCH || "main", clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, redirect: env.GITHUB_OAUTH_REDIRECT_URI, sessionSecret: env.SESSION_SECRET };
}
function notePath(value) {
  if (typeof value !== "string") return null;
  const path = value.replace(/^\/+/, "");
  return /^src\/site\/notes\/[A-Za-z0-9._\-\/\u0080-\uffff]+\.md$/.test(path) && !path.includes("..") ? path : null;
}
function ghPath(path) { return path.split("/").map(encodeURIComponent).join("/"); }
async function gh(path, token, options) {
  if (!token) return null;
  return fetch("https://api.github.com" + path, { ...(options || {}), headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28", ...((options && options.headers) || {}) } });
}
function fromB64(value) { return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\n/g, "")), char => char.charCodeAt(0))); }
function toB64(value) {
  const bytes = new TextEncoder().encode(value); let text = "";
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
async function currentSession(request, env) { return unseal(cookie(request, SESSION_COOKIE), settings(env).sessionSecret); }
async function assets(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/") url.pathname = "/index.html";
  else if (url.pathname.endsWith("/")) url.pathname += "index.html";
  return env.ASSETS.fetch(new Request(url, request));
}
async function api(request, env, url, user) {
  const cfg = settings(env), token = user.token;
  if (url.pathname === "/__api/notes" && request.method === "GET") {
    const result = await gh("/repos/" + cfg.owner + "/" + cfg.repo + "/git/trees/" + encodeURIComponent(cfg.branch) + "?recursive=1", token);
    if (!result?.ok) return json({ error: "无法读取 GitHub 笔记" }, 502);
    const tree = await result.json();
    return json({ notes: (tree.tree || []).filter(item => item.type === "blob" && notePath(item.path)).map(item => ({ path: item.path, sha: item.sha })) });
  }
  if (url.pathname === "/__api/note" && request.method === "GET") {
    const path = notePath(url.searchParams.get("path"));
    if (!path) return json({ error: "笔记路径无效" }, 400);
    const result = await gh("/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + ghPath(path) + "?ref=" + encodeURIComponent(cfg.branch), token);
    if (!result?.ok) return json({ error: "无法读取笔记" }, 404);
    const data = await result.json();
    return json({ path, sha: data.sha, content: fromB64(data.content || "") });
  }
  if (url.pathname === "/__api/note" && request.method === "PUT") {
    const body = await request.json().catch(() => null);
    const path = notePath(body?.path), oldPath = body?.oldPath ? notePath(body.oldPath) : "";
    if (!path || (body?.oldPath && !oldPath) || typeof body.content !== "string") return json({ error: "笔记路径或内容无效" }, 400);
    const payload = { message: String(body.message || "Edit note from Digital Garden"), content: toB64(body.content), branch: cfg.branch };
    if (oldPath === path) {
      const current = await gh("/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + ghPath(path) + "?ref=" + encodeURIComponent(cfg.branch), token);
      if (!current?.ok) return json({ error: "无法读取当前文件版本" }, 409);
      payload.sha = (await current.json()).sha;
    }
    const saved = await gh("/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + ghPath(path), token, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!saved?.ok) return json({ error: "GitHub 保存失败", detail: await saved.text() }, 502);
    if (oldPath && oldPath !== path) {
      const old = await gh("/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + ghPath(oldPath) + "?ref=" + encodeURIComponent(cfg.branch), token);
      if (old?.ok) {
        const oldData = await old.json();
        await gh("/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + ghPath(oldPath), token, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Move " + oldPath + " to " + path, sha: oldData.sha, branch: cfg.branch }) });
      }
    }
    return json({ ok: true, path });
  }
  return json({ error: "Not found" }, 404);
}

function redirectWithCookies(location, cookies) {
  const headers = new Headers({ Location: location });
  cookies.forEach(value => headers.append("Set-Cookie", value));
  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), cfg = settings(env);
    if (url.pathname === "/__oauth/start") {
      if (!cfg.clientId || !cfg.redirect || !cfg.sessionSecret) return text("GitHub OAuth 尚未配置。", 503);
      const state = crypto.randomUUID(), nonce = crypto.randomUUID(), target = new URL("https://github.com/login/oauth/authorize");
      const returnTo = url.searchParams.get("return") || "/__editor";
      const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/__editor";
      target.searchParams.set("client_id", cfg.clientId); target.searchParams.set("redirect_uri", cfg.redirect); target.searchParams.set("scope", "repo"); target.searchParams.set("state", state);
      const stateCookie = await seal({ state, nonce, returnTo: safeReturn, exp: Math.floor(Date.now() / 1000) + 600 }, cfg.sessionSecret);
      return redirectWithCookies(target.toString(), [setCookie(STATE_COOKIE, stateCookie, 600)]);
    }
    if (url.pathname === "/__oauth/callback") {
      if (!cfg.clientId || !cfg.clientSecret || !cfg.redirect || !cfg.sessionSecret) return text("GitHub OAuth 尚未完整配置。", 503);
      const stateData = await unseal(cookie(request, STATE_COOKIE), cfg.sessionSecret);
      if (!url.searchParams.get("code") || !stateData || stateData.exp < Math.floor(Date.now() / 1000) || url.searchParams.get("state") !== stateData.state || !stateData.nonce) return text("OAuth state/nonce 校验失败。", 400);
      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code: url.searchParams.get("code"), redirect_uri: cfg.redirect }) });
      if (!tokenResponse.ok) return text("GitHub OAuth 授权失败。", 502);
      const token = (await tokenResponse.json()).access_token;
      if (!token) return text("GitHub OAuth 授权失败。", 502);
      const profileResponse = await gh("/user", token);
      if (!profileResponse?.ok) return text("无法确认 GitHub 用户。", 502);
      const profile = await profileResponse.json(), value = await seal({ token, login: profile.login, nonce: stateData.nonce, exp: Math.floor(Date.now() / 1000) + SESSION_TTL }, cfg.sessionSecret);
      return redirectWithCookies(stateData.returnTo || "/__editor", [setCookie(SESSION_COOKIE, value, SESSION_TTL), setCookie(STATE_COOKIE, "", 0)]);
    }
    if (url.pathname === "/__oauth/logout") return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": setCookie(SESSION_COOKIE, "", 0) } });
    const user = await currentSession(request, env);
    if (url.pathname === "/__editor") return Response.redirect(new URL("/editor.html" + (url.search || ""), request.url), 302);
    if (url.pathname === "/editor.html") return assets(request, env);
    if (url.pathname === "/__api/session" && request.method === "GET") return json({ authenticated: Boolean(user), user: user ? { login: user.login } : null });
    if (url.pathname.startsWith("/__api/")) return user ? api(request, env, url, user) : json({ error: "GitHub 登录后才能编辑" }, 401);
    return assets(request, env);
  }
};
