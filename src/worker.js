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


function apiJson(data,status){return new Response(JSON.stringify(data),{status:status||200,headers:{"content-type":"application/json; charset=UTF-8"}});}
function safeNotePath(v){if(typeof v!=="string")return null;const p=v.replace(/^\\/+/"");return p.startsWith("src/site/notes/")&&p.endsWith(".md")&&!p.includes("..")?p:null;}
function ghPath(p){return p.split("/").map(encodeURIComponent).join("/");}
async function gh(path,env,opt){if(!env.GITHUB_TOKEN)return null;return fetch("https://api.github.com"+path,{...(opt||{}),headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+env.GITHUB_TOKEN,"X-GitHub-Api-Version":"2022-11-28",...((opt&&opt.headers)||{})}});}
function fromB64(v){const b=Uint8Array.from(atob(v.replace(/\\n/g,"")),c=>c.charCodeAt(0));return new TextDecoder().decode(b);}
function toB64(v){const b=new TextEncoder().encode(v);let s="";for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);}
function editorPage(){return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>编辑 Digital Garden</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#202634;color:#edf0f5;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}header{position:sticky;top:0;padding:16px;background:#282f3e;border-bottom:1px solid #414b5d}h1{margin:0 0 12px;font-size:20px}.toolbar{display:flex;gap:8px;flex-wrap:wrap}button,select,input,textarea{font:inherit;border-radius:8px;border:1px solid #4b566b;background:#171c27;color:#fff}button{padding:10px 14px;background:#8b7cff;border:0}button.secondary{background:#3a4456}input,select{padding:10px;width:100%}main{max-width:1000px;margin:auto;padding:16px}.grid{display:grid;grid-template-columns:280px 1fr;gap:16px}.panel{background:#282f3e;border:1px solid #414b5d;border-radius:12px;padding:14px}textarea{width:100%;min-height:65vh;padding:14px;line-height:1.6;resize:vertical}label{display:block;margin:10px 0 6px;color:#aeb5c2}#status{margin-top:10px;color:#aeb5c2}@media(max-width:700px){.grid{grid-template-columns:1fr}textarea{min-height:55vh}}</style></head><body><header><h1>编辑 Digital Garden</h1><div class="toolbar"><button id="new">新建笔记</button><button id="save">保存并发布</button><button class="secondary" onclick="location.href='/'">返回网页</button></div><div id="status">正在读取…</div></header><main><div class="grid"><section class="panel"><select id="files"></select></section><section class="panel"><label>文件路径（可改，用于分类/目录）</label><input id="path"><label>Markdown 内容</label><textarea id="content"></textarea><label>提交说明</label><input id="message" value="Edit note from Digital Garden"></section></div></main><script>
var oldPath="",$=function(id){return document.getElementById(id)},say=function(t){$("status").textContent=t};
async function list(){var r=await fetch("/__api/notes"),d=await r.json();if(!r.ok)throw Error(d.error||"读取失败");$("files").innerHTML=d.notes.map(function(n){return "<option value='"+encodeURIComponent(n.path)+"'>"+n.path.replace("src/site/notes/","")+"</option>"}).join("");if(d.notes[0])await openNote(d.notes[0].path)}
async function openNote(p){oldPath=p;$("files").value=encodeURIComponent(p);var r=await fetch("/__api/note?path="+encodeURIComponent(p)),d=await r.json();if(!r.ok)throw Error(d.error||"读取失败");$("path").value=d.path;$("content").value=d.content;$("message").value="Edit "+d.path}
$("files").onchange=function(){openNote(decodeURIComponent($("files").value)).catch(function(e){say(e.message)})};
$("new").onclick=function(){oldPath="";$("path").value="src/site/notes/04-新笔记.md";$("content").value="---\ntitle: 新笔记\ndg-publish: true\ntags:\n  - learning-tree\n---\n\n# 新笔记\n\n";$("message").value="Create note from Digital Garden";say("已准备新笔记")};
$("save").onclick=async function(){var p=$("path").value.trim(),c=$("content").value;if(!p||!c)return say("路径和内容不能为空");say("正在保存…");var r=await fetch("/__api/note",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({path:p,oldPath:oldPath,content:c,message:$("message").value})}),d=await r.json();if(!r.ok)return say(d.error||"保存失败");oldPath=p;say("已保存到 GitHub，Cloudflare 将自动重新构建");await list();await openNote(p)};
list().then(function(){say("可以编辑")}).catch(function(e){say(e.message)});
</script></body></html>`,{headers:{"content-type":"text/html; charset=UTF-8"}});}
async function editorApi(req,env,url){if(!env.GITHUB_TOKEN)return apiJson({error:"GITHUB_TOKEN 尚未设置"},503);const repo="nkwlmq1/learning-tree";if(url.pathname==="/__api/notes"){const r=await gh("/repos/"+repo+"/git/trees/main?recursive=1",env);if(!r||!r.ok)return apiJson({error:"无法读取 GitHub 笔记"},502);const t=await r.json();return apiJson({notes:(t.tree||[]).filter(function(x){return x.type==="blob"&&safeNotePath(x.path)}).map(function(x){return {path:x.path,sha:x.sha}})})}if(url.pathname==="/__api/note"&&req.method==="GET"){const p=safeNotePath(url.searchParams.get("path"));if(!p)return apiJson({error:"笔记路径无效"},400);const r=await gh("/repos/"+repo+"/contents/"+ghPath(p)+"?ref=main",env);if(!r||!r.ok)return apiJson({error:"无法读取笔记"},404);const d=await r.json();return apiJson({path:p,sha:d.sha,content:fromB64(d.content||"")})}if(url.pathname==="/__api/note"&&req.method==="PUT"){const b=await req.json(),p=safeNotePath(b.path),old=safeNotePath(b.oldPath||"");if(!p||(b.oldPath&&!old))return apiJson({error:"笔记路径无效"},400);const data={message:String(b.message||"Edit note from Digital Garden"),content:toB64(String(b.content||"")),branch:"main"};if(old===p){const r=await gh("/repos/"+repo+"/contents/"+ghPath(p)+"?ref=main",env);if(r&&r.ok)data.sha=(await r.json()).sha}const r=await gh("/repos/"+repo+"/contents/"+ghPath(p),env,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(data)});if(!r||!r.ok)return apiJson({error:"GitHub 保存失败"},502);if(old&&old!==p){const q=await gh("/repos/"+repo+"/contents/"+ghPath(old)+"?ref=main",env);if(q&&q.ok){const d=await q.json();await gh("/repos/"+repo+"/contents/"+ghPath(old),env,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({message:"Move note from Digital Garden",sha:d.sha,branch:"main"})})}}return apiJson({ok:true,path:p})}return apiJson({error:"Not found"},404)}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__editor") {
      const expected = env.SITE_PASSWORD ? await signSession(env.SITE_PASSWORD) : null;
      if (!env.SITE_PASSWORD || readCookie(request, SESSION_COOKIE) !== expected) return loginPage();
      return editorPage();
    }
    if (url.pathname.startsWith("/__api/")) {
      const expected = env.SITE_PASSWORD ? await signSession(env.SITE_PASSWORD) : null;
      if (!env.SITE_PASSWORD || readCookie(request, SESSION_COOKIE) !== expected) return apiJson({error:"未登录"},401);
      return editorApi(request, env, url);
    }

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

// Gate deployment trigger.
