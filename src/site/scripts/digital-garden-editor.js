(function () {
  const query = new URLSearchParams(location.search);
  const initialPath = query.get("path") || "";
  const $ = id => document.getElementById(id);
  let oldPath = "";
  let user = null;

  function status(message) { $("dg-editor-status").textContent = message; }
  function metadata(source, key) {
    const match = source.match(new RegExp("^" + key + ":\\s*[\"']?([^\"'\\n]*)", "m"));
    return match ? match[1].trim() : "";
  }
  function updateMetadata(source, values) {
    const frontmatter = source.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?/);
    const body = frontmatter ? source.slice(frontmatter[0].length) : source;
    let yaml = frontmatter ? frontmatter[1] : "";
    Object.entries(values).forEach(([key, value]) => {
      const line = key + ": " + JSON.stringify(value || "");
      const expression = new RegExp("^" + key + ":.*$", "m");
      yaml = expression.test(yaml) ? yaml.replace(expression, line) : yaml + (yaml && !yaml.endsWith("\n") ? "\n" : "") + line + "\n";
    });
    return "---\n" + yaml.trim() + "\n---\n\n" + body.replace(/^\n+/, "");
  }
  async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  }
  async function uploadImage() {
    const file = $("dg-image").files[0];
    if (!file) return status("请先选择图片");
    if (file.size > 5000000) return status("图片不能超过 5 MB");
    status("正在上传图片…");
    const reader = new FileReader();
    reader.onload = async () => {
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
      const path = "src/site/img/uploads/" + Date.now() + "-" + safe;
      try {
        const data = await request("/__api/asset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, content: reader.result, mime: file.type, message: "Upload image from Digital Garden" }) });
        $("dg-content").value += "\n\n![" + file.name.replace(/\]/g, "") + "](/img/uploads/" + path.split("/").pop() + ")\n";
        $("dg-image").value = "";
        status("图片已上传并插入正文；保存笔记后正式发布");
      } catch (error) { status(error.message); }
    };
    reader.readAsDataURL(file);
  }
  async function deleteCurrentNote() {
    const path = $("dg-path").value.trim();
    if (!path || !oldPath) return status("新笔记尚未保存");
    if (!window.confirm("确定删除这篇笔记吗？此操作会从 GitHub 删除文件。")) return;
    status("正在删除笔记…");
    try {
      await request("/__api/note", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, message: "Delete note from Digital Garden" }) });
      status("已删除");
      await listNotes();
    } catch (error) { status(error.message); }
  }
  async function openNote(path) {
    oldPath = path;
    $("dg-files").value = encodeURIComponent(path);
    const data = await request("/__api/note?path=" + encodeURIComponent(path));
    $("dg-path").value = data.path;
    $("dg-content").value = data.content;
    $("dg-title").value = metadata(data.content, "title");
    $("dg-category").value = metadata(data.content, "category");
    $("dg-directory").value = metadata(data.content, "main_directory");
    $("dg-message").value = "Edit " + data.path;
  }
  async function listNotes() {
    const data = await request("/__api/notes");
    $("dg-files").innerHTML = data.notes.map(note => "<option value=\"" + encodeURIComponent(note.path) + "\">" + note.path.replace("src/site/notes/", "") + "</option>").join("");
    const selected = initialPath && data.notes.find(note => note.path === initialPath);
    if (selected) await openNote(selected.path);
    else if (data.notes[0]) await openNote(data.notes[0].path);
  }
  async function init() {
    const auth = await request("/api/session");
    user = auth.user;
    $("dg-editor-auth").innerHTML = "<span>GitHub：" + user.login + "</span> · <a href=\"/logout\">退出</a>";
    await listNotes();
    status("可以编辑");
  }
  $("dg-upload").addEventListener("click", () => uploadImage());\n  $("dg-delete").addEventListener("click", () => deleteCurrentNote());\n  $("dg-files").addEventListener("change", () => openNote(decodeURIComponent($("dg-files").value)).catch(error => status(error.message)));
  $("dg-new").addEventListener("click", () => {
    oldPath = "";
    $("dg-path").value = "src/site/notes/新笔记.md";
    $("dg-title").value = "新笔记";
    $("dg-category").value = "";
    $("dg-directory").value = "";
    $("dg-content").value = "---\ntitle: 新笔记\ndg-publish: true\ntags:\n  - learning-tree\n---\n\n# 新笔记\n\n";
    status("已准备新笔记");
  });
  $("dg-save").addEventListener("click", async () => {
    if (!user) return status("请先使用 GitHub 登录");
    const path = $("dg-path").value.trim();
    if (!path || !$("dg-content").value) return status("路径和内容不能为空");
    status("正在写回 GitHub…");
    const content = updateMetadata($("dg-content").value, { title: $("dg-title").value, category: $("dg-category").value, main_directory: $("dg-directory").value });
    const data = await request("/__api/note", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, oldPath, content, message: $("dg-message").value }) });
    oldPath = data.path;
    $("dg-content").value = content;
    status("已写回 GitHub；Cloudflare 将在构建后更新页面");
    await listNotes();
  });
  $("dg-editor-auth").innerHTML = "<a class=\"primary\" href=\"/login\">使用 GitHub 登录后编辑</a>";
  request("/api/session").then(init).catch(() => status("请先使用 GitHub 登录后编辑"));
})();
