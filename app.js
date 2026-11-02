(() => {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "docupilot-ai-documents-v1";
  let documents = loadDocuments();
  let activeView = "all";
  let toastTimer;

  function loadDocuments() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  }
  function saveDocuments() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(documents)); }
    catch { showToast("Browser storage is full. Some changes may not be saved."); }
  }
  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }
  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  }
  function categoryFor(fileName) {
    const name = fileName.toLowerCase();
    if (/invoice|bill|tax-invoice/.test(name)) return "invoices";
    if (/receipt|payment|transaction/.test(name)) return "receipts";
    return "other";
  }
  function categoryLabel(category) {
    return category === "invoices" ? "Invoice" : category === "receipts" ? "Receipt" : "Other";
  }
  function fileKind(name) {
    const ext = name.split(".").pop().toLowerCase();
    if (ext === "pdf") return { label: "PDF", icon: "▤", cls: "pdf" };
    if (["png", "jpg", "jpeg", "webp"].includes(ext)) return { label: "Image", icon: "▧", cls: "image" };
    if (["xls", "xlsx", "csv"].includes(ext)) return { label: "Spreadsheet", icon: "▦", cls: "" };
    if (["doc", "docx"].includes(ext)) return { label: "Document", icon: "▤", cls: "" };
    return { label: ext.toUpperCase() || "File", icon: "▱", cls: "" };
  }
  function updateStats() {
    $("total-stat").textContent = documents.length;
    $("invoice-stat").textContent = documents.filter(d => d.category === "invoices").length;
    $("receipt-stat").textContent = documents.filter(d => d.category === "receipts").length;
    $("other-stat").textContent = documents.filter(d => d.category === "other").length;
    $("storage-count").textContent = documents.length + (documents.length === 1 ? " document added" : " documents added");
  }
  function render() {
    updateStats();
    const query = $("search-input").value.trim().toLowerCase();
    const category = $("category-filter").value;
    const sort = $("sort-filter").value;
    let filtered = documents.filter(doc => {
      const matchesQuery = doc.name.toLowerCase().includes(query);
      const matchesCategory = category === "all" || doc.category === category;
      const matchesView = activeView === "all" || doc.category === activeView;
      return matchesQuery && matchesCategory && matchesView;
    });
    filtered.sort((a,b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "oldest" ? new Date(a.addedAt)-new Date(b.addedAt) : new Date(b.addedAt)-new Date(a.addedAt));

    const list = $("document-list");
    list.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = '<div class="empty-art"><span>⌕</span><i>✦</i></div><h3>' + (documents.length ? "No matching documents" : "Your workspace is ready") + '</h3><p>' + (documents.length ? "Try another search term or category filter." : "Upload an invoice, receipt or document to start building your library.") + '</p>' + (documents.length ? '<button class="text-button" id="reset-empty">Reset search and filters</button>' : '<button class="primary-button small" id="empty-upload">＋ Add your first document</button><small>PDF, images and common document formats</small>');
      list.appendChild(empty);
      const reset = $("reset-empty");
      if (reset) reset.addEventListener("click", resetFilters);
      const upload = $("empty-upload");
      if (upload) upload.addEventListener("click", openPicker);
      return;
    }

    filtered.forEach(doc => {
      const kind = fileKind(doc.name);
      const row = document.createElement("div");
      row.className = "document-row";
      const name = document.createElement("div");
      name.className = "file-name";
      const icon = document.createElement("span");
      icon.className = "file-icon " + kind.cls;
      icon.textContent = kind.icon;
      const details = document.createElement("span");
      const title = document.createElement("b");
      title.textContent = doc.name;
      const sub = document.createElement("small");
      sub.textContent = kind.label;
      details.append(title, sub);
      name.append(icon, details);

      const cat = document.createElement("span");
      cat.className = "category-cell";
      const pill = document.createElement("span");
      pill.className = "category-pill " + doc.category;
      pill.textContent = categoryLabel(doc.category);
      cat.appendChild(pill);

      const size = document.createElement("span");
      size.className = "size-cell row-muted";
      size.textContent = formatSize(doc.size);
      const date = document.createElement("span");
      date.className = "date-cell row-muted";
      date.textContent = formatDate(doc.addedAt);
      const remove = document.createElement("button");
      remove.className = "row-menu";
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove " + doc.name);
      remove.title = "Remove from this browser workspace";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        if (!confirm('Remove "' + doc.name + '" from this browser workspace?')) return;
        documents = documents.filter(item => item.id !== doc.id);
        saveDocuments();
        render();
        showToast("Document entry removed.");
      });
      row.append(name, cat, size, date, remove);
      list.appendChild(row);
    });
  }
  function openPicker() { $("file-input").click(); }
  function resetFilters() {
    $("search-input").value = "";
    $("category-filter").value = "all";
    $("sort-filter").value = "newest";
    activeView = "all";
    document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === "all" && item.textContent.includes("Overview")));
    $("page-label").textContent = "Overview";
    render();
  }

  $("upload-trigger").addEventListener("click", openPicker);
  $("empty-upload").addEventListener("click", openPicker);
  $("file-input").addEventListener("change", event => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const known = new Set(documents.map(d => d.name + "|" + d.size));
    let added = 0;
    files.forEach(file => {
      const key = file.name + "|" + file.size;
      if (known.has(key)) return;
      known.add(key);
      documents.push({
        id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2)),
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        category: categoryFor(file.name),
        addedAt: new Date().toISOString()
      });
      added++;
    });
    saveDocuments();
    render();
    showToast(added ? added + (added === 1 ? " document added to this browser." : " documents added to this browser.") : "These files are already listed.");
    event.target.value = "";
  });
  $("search-input").addEventListener("input", render);
  $("category-filter").addEventListener("change", render);
  $("sort-filter").addEventListener("change", render);
  $("clear-search").addEventListener("click", resetFilters);
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      activeView = item.dataset.view;
      $("page-label").textContent = item.textContent.trim();
      document.querySelectorAll(".nav-item").forEach(nav => nav.classList.toggle("active", nav === item));
      $("category-filter").value = "all";
      render();
      $("sidebar").classList.remove("open");
    });
  });
  $("mobile-menu").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  render();
})();