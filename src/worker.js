const SESSION_COOKIE = "dg_session";
const SESSION_TEXT = "digital-garden-editor-session-v1";

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function signSession(secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(SESSION_TEXT)
  );
  return [...new Uint8Array(signature)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function loginPage(message = "") {
  return new Response(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Digital Garden</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#282f3e;color:#eff1f5;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
main{width:min(420px,calc(100% - 40px));padding:32px;box-sizing:border-box;background:#202634;border:1px solid #3d4658;border-radius:14px;box-shadow:0 18px 50px #1118}
h1{margin:0 0 10px;font-size:24px;font-weight:600}
p{color:#aeb5c2;line-height:1.6}
input,button{width:100%;box-sizing:border-box;padding:13px 14px;border-radius:8px;font-size:16px}
input{margin:14px 0;background:#171c27;color:#fff;border:1px solid #4b566b}
button{background:#8b7cff;color:#fff;border:0;cursor:pointer}
.error{color:#ff9c9c;margin-top:14px}
</style>
</head>
<body><main>
<h1>Digital Garden</h1>
<p>这是私人学习空间，请输入访问密码。</p>
<form method="post" action="/__login">
<input name="password" type="password" autocomplete="current-password" placeholder="访问密码" required>
<button type="submit">进入</button>
</form>
${message ? `<div class="error">${message}</div>` : ""}
</main></body></html>`, {
    status: 401,
    headers: { "content-type": "text/html; charset=UTF-8" }
  });
}

function setupPage() {
  return new Response("SITE_PASSWORD 尚未设置。请在 Cloudflare Worker Secrets 中添加后再访问。", {
    status: 503,
    headers: { "content-type": "text/plain; charset=UTF-8" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.SITE_PASSWORD) {
      return setupPage();
    }

    if (url.pathname === "/__login" && request.method === "POST") {
      const form = await request.formData();
      const password = String(form.get("password") || "");
      if (password !== env.SITE_PASSWORD) {
        return loginPage("密码不正确。");
      }
      const token = await signSession(env.SITE_PASSWORD);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `${SESSION_COOKIE}=${token}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`
        }
      });
    }

    if (url.pathname === "/__logout") {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/__login",
          "Set-Cookie": `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`
        }
      });
    }

    const expected = await signSession(env.SITE_PASSWORD);
    if (readCookie(request, SESSION_COOKIE) !== expected) {
      return loginPage();
    }

    return env.ASSETS.fetch(request);
  }
};
