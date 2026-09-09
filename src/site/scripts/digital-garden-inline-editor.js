(function () {
  const buttons = document.querySelectorAll("[data-editor-path]");
  if (!buttons.length) return;

  const esc = value => String(value || "").replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));
  const frontmatter = source => source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const metadata = (source, key) => {
    const match = source.match(new RegExp("^" + key + ":\\s*[\\\"']?([^\\\"'\\n]*)", "m"));
    return match ? match[1].trim() : "";
  };
  const updateMetadata = (source, values) => {
    const match = frontmatter(source);
    const body = match ? source.slice(match[0].length) : source;
    let yaml = match ? match[1] : "";
    Object.entries(values).forEach(([key, value]) => {
      const line = key + ": " + JSON.stringify(value || "");
      const expression = new RegExp("^" + key + ":.*$", "m");
      yaml = expression.test(yaml) ? yaml.replace(expression, line) : yaml + (yaml && !yaml.endsWith("\n") ? "\n" : "") + line + "\n";
    });
    return "---\n" + yaml.trim() + "\n---\n\n" + body.replace(/^\n+/, "");
  };
  const request = async (url, options) => {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  };
  const close = overlay => overlay.remove();

  async function open(path) {
    let session;
    try { session = await request("/api/session"); } catch (error) { window.location.href = "/oauth/start?return=" + encodeURIComponent(location.pathname + location.search); return; }
    if (!session.authenticated) {
      window.location.href = "/oauth/start?return=" + encodeURIComponent(location.pathname + location.search);
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "dg-inline-editor-overlay";
    overlay.innerHTML = `<section class="dg-inline-editor" role="dialog" aria-modal="true" aria-label="网页内编辑">
      <header><div><span class="dg-inline-editor-kicker">LEARNING TREE / EDIT</span><h2>编辑笔记</h2></div><button type="button" class="dg-inline-editor-close" aria-label="关闭">×</button></header>
      <p class="dg-inline-editor-status">正在读取 GitHub…</p>
      <div class="dg-inline-editor-fields"><label>标题<input data-field="title"></label><label>分类<input data-field="category"></label><label>主目录<input data-field="directory"></label><label>笔记路径<input data-field="path"></label></div>
      <label class="dg-inline-editor-body">Markdown 正文<textarea data-field="content" spellcheck="false"></textarea></label>
      <footer><button type="button" class="dg-inline-editor-cancel">取消</button><button type="button" class="dg-inline-editor-save">保存并发布</button></footer>
    </section>`;
    document.body.appendChild(overlay);
    const field = name => overlay.querySelector(`[data-field="${name}"]`);
    const status = message => { overlay.querySelector(".dg-inline-editor-status").textContent = message; };
    overlay.querySelector(".dg-inline-editor-close").onclick = () => close(overlay);
    overlay.querySelector(".dg-inline-editor-cancel").onclick = () => close(overlay);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(overlay); });
    try {
      const data = await request("/__api/note?path=" + encodeURIComponent(path));
      field("path").value = data.path;
      field("title").value = metadata(data.content, "title");
      field("category").value = metadata(data.content, "category");
      field("directory").value = metadata(data.content, "main_directory");
      field("content").value = data.content;
      status("已读取 GitHub 文件");
    } catch (error) { status(error.message); return; }
    overlay.querySelector(".dg-inline-editor-save").onclick = async () => {
      const content = updateMetadata(field("content").value, { title: field("title").value, category: field("category").value, main_directory: field("directory").value });
      if (!field("path").value.trim() || !content.trim()) return status("路径和内容不能为空");
      status("正在写回 GitHub…");
      try {
        await request("/__api/note", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: field("path").value.trim(), oldPath: path, content, message: "Edit note from Learning Tree" }) });
        field("content").value = content;
        status("已提交到 GitHub；Cloudflare 将在构建后更新页面");
      } catch (error) { status(error.message); }
    };
    field("content").focus();
  }

  buttons.forEach(button => button.addEventListener("click", event => { event.preventDefault(); open(button.dataset.editorPath); }));
})();
