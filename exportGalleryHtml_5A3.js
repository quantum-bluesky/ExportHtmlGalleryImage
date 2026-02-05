function exportGalleryHtml_5A3() {
  var sourceFolderId = "1UHKMcLyBd-zaoSycX9gXx11bFut6WwAh";  // folder chứa 2000 ảnh
  var targetFolderId = "1rWZx2fLpUY5mj8CPMAOAXXeKn-fLWzZX";  // Public/5A3/
  var outputFileName = "Anh_ky_yeu_5A3_gallery_N1.html";
  var pageSize = 120;

  var sourceFolder = DriveApp.getFolderById(sourceFolderId);
  var files = sourceFolder.getFiles(); // <-- lấy ảnh từ folder nguồn

  var items = [];
  while (files.hasNext()) {
    var f = files.next();
    var mt = (f.getMimeType() || "").toLowerCase();
    if (!mt.startsWith("image/")) continue;

    var id = f.getId();
    var name = f.getName();
    items.push({
      id: id,
      name: name,
      download: "https://drive.usercontent.google.com/download?id=" + id + "&export=download",
      thumb: "https://drive.google.com/thumbnail?id=" + id + "&sz=w200-h190"
    });
  }

  items.sort((a,b)=>a.name.localeCompare(b.name));
  var html = buildGalleryHtml_(items, pageSize);

  var targetFolder = DriveApp.getFolderById(targetFolderId);

  // Gợi ý: tạo bằng Blob (hay “dễ qua policy” hơn createFile(text, MimeType.HTML) trong một số domain)
  var blob = Utilities.newBlob(html, "text/html", outputFileName);

  var existing = findFileByNameInFolder_(targetFolder, outputFileName);
  if (existing) {
    existing.setContent(html);
    Logger.log("Updated: " + existing.getUrl());
  } else {
    var created = targetFolder.createFile(blob); // <-- dùng blob thay vì createFile(string, MimeType.HTML)
    Logger.log("Created: " + created.getUrl());
  }
}

function buildGalleryHtml_(items, pageSize) {
  // Chống đóng tag sớm do < trong JSON (hiếm nhưng nên có)
  var dataJson = JSON.stringify(items).replace(/</g, "\\u003c");

  var parts = [];
  parts.push(
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>5A3 - Thumbnails</title>',
    '<style>',
    'body{font-family:Arial,sans-serif;margin:16px}',
    '.top{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #eee;z-index:10}',
    '.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
    'input[type="text"]{padding:8px 10px;min-width:260px;border:1px solid #ddd;border-radius:8px}',
    'button{padding:8px 10px;cursor:pointer;border:1px solid #ddd;border-radius:8px;background:#fafafa}',
    'button:hover{background:#f2f2f2}',
    '.meta{color:#555;font-size:13px}',
    '.gallery{display:flex;flex-wrap:wrap;gap:14px;margin-top:14px}',
    '.item{width:160px;text-align:center}',
    '.thumb{width:160px;height:auto;border:1px solid #ddd;border-radius:10px;display:block}',
    '.name{font-size:12px;margin:6px 0 0;word-break:break-word}',
    '.pager{margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.pill{padding:6px 10px;border:1px solid #ddd;border-radius:999px;cursor:pointer;user-select:none;background:#fff}',
    '.pill.active{border-color:#333;font-weight:700}',
    '</style></head><body>'
  );

  parts.push(
    '<div class="top">',
    '  <div class="row">',
    '    <strong style="font-size:18px">Public / 5A3</strong>',
    '    <span class="meta" id="meta"></span>',
    '  </div>',
    '  <div class="row" style="margin-top:10px">',
    '    <input id="q" type="text" placeholder="Search filename...">',
    '    <button onclick="selectAll(true)">Select all (page)</button>',
    '    <button onclick="selectAll(false)">Unselect (page)</button>',
    '    <button onclick="clearSelected()">Clear selected (all)</button>',
    '    <button onclick="openSelected()">Download selected</button>',
	'	 <p>Cần unblock popup trên browser để download nhiều file</p>',
    '  </div>',
    '  <div class="pager" id="pager"></div>',
    '</div>',
    '<div class="gallery" id="gallery"></div>'
  );

  parts.push(
    '<script>',
    'const ITEMS = ' + dataJson + ';',
    'const PAGE_SIZE = ' + String(pageSize) + ';',
    'let filtered = ITEMS;',
    'let page = 1;',
    'const selected = new Set();',

    'function applyFilter(){',
    '  const q = document.getElementById("q").value.trim().toLowerCase();',
    '  filtered = q ? ITEMS.filter(x => x.name.toLowerCase().includes(q)) : ITEMS;',
    '  page = 1;',
    '  render();',
    '}',

    'function setPage(p){ page = p; render(); }',

    'function toggleSelect(id, checked){',
    '  if(checked) selected.add(id); else selected.delete(id);',
    '  updateMeta();',
    '}',

    'function selectAll(v){',
    '  const start = (page-1)*PAGE_SIZE;',
    '  const end = Math.min(start + PAGE_SIZE, filtered.length);',
    '  for(let i=start;i<end;i++){',
    '    const id = filtered[i].id;',
    '    if(v) selected.add(id); else selected.delete(id);',
    '  }',
    '  render(false);',
    '  updateMeta();',
    '}',

    'function clearSelected(){',
    '  selected.clear();',
    '  render(false);',
    '  updateMeta();',
    '}',

    'function openSelected(){',
    '  const arr = Array.from(selected);',
    '  if(!arr.length){ alert("Chưa chọn ảnh nào"); return; }',
    '  const map = new Map(ITEMS.map(x=>[x.id,x]));',
    '  arr.forEach((id,i)=>{',
    '    const it = map.get(id); if(!it) return;',
    '    setTimeout(()=>{ window.open(it.download, "_blank", "noopener"); }, i*250);',
    '  });',
    '}',

    // === RENDER (ĐÃ FIX, KHÔNG DÙNG ${} TRONG HTML STRING) ===
    'function render(updatePager=true){',
    '  const g = document.getElementById("gallery");',
    '  g.innerHTML = "";',

    '  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));',
    '  page = Math.min(page, totalPages);',

    '  const start = (page-1)*PAGE_SIZE;',
    '  const end = Math.min(start + PAGE_SIZE, filtered.length);',

    '  for(let i=start;i<end;i++){',
    '    const it = filtered[i];',

    '    const div = document.createElement("div");',
    '    div.className = "item";',

    '    const cb = document.createElement("input");',
    '    cb.type = "checkbox";',
    '    cb.checked = selected.has(it.id);',
    '    cb.onchange = () => toggleSelect(it.id, cb.checked);',

    '    const label = document.createElement("label");',
    '    label.appendChild(cb);',
    '    label.appendChild(document.createTextNode(" Select"));',

    '    const br = document.createElement("br");',

    '    const a = document.createElement("a");',
    '    a.href = it.download;',
    '    a.target = "_blank";',
    '    a.rel = "noopener";',

    '    const img = document.createElement("img");',
    '    img.className = "thumb";',
    '    img.loading = "lazy";',
    '    img.src = it.thumb;',
    '    img.alt = it.name;',
    '    a.appendChild(img);',

    '    const name = document.createElement("div");',
    '    name.className = "name";',
    '    name.textContent = it.name;',

    '    div.appendChild(label);',
    '    div.appendChild(br);',
    '    div.appendChild(a);',
    '    div.appendChild(name);',

    '    g.appendChild(div);',
    '  }',

    '  if(updatePager) renderPager(totalPages);',
    '  updateMeta(totalPages);',
    '}',

    'function renderPager(totalPages){',
    '  const p = document.getElementById("pager");',
    '  p.innerHTML = "";',

    '  const make = (label, to, active=false) => {',
    '    const s=document.createElement("span");',
    '    s.className="pill"+(active?" active":"");',
    '    s.textContent=label;',
    '    s.onclick=()=>setPage(to);',
    '    return s;',
    '  };',

    '  p.appendChild(make("« Prev", Math.max(1, page-1)));',

    '  const windowSize = 7;',
    '  let a = Math.max(1, page - Math.floor(windowSize/2));',
    '  let b = Math.min(totalPages, a + windowSize - 1);',
    '  a = Math.max(1, b - windowSize + 1);',

    '  for(let i=a;i<=b;i++){',
    '    p.appendChild(make(String(i), i, i===page));',
    '  }',

    '  p.appendChild(make("Next »", Math.min(totalPages, page+1)));',
    '}',

    'function updateMeta(totalPages){',
    '  const m = document.getElementById("meta");',
    '  const tp = totalPages ?? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));',
    '  m.textContent = `Total: ${ITEMS.length} | Showing: ${filtered.length} | Page: ${page}/${tp} | Selected: ${selected.size}`;',
    '}',

    'document.getElementById("q").addEventListener("input", ()=>{',
    '  clearTimeout(window.__t); window.__t=setTimeout(applyFilter, 150);',
    '});',

    'render();',
    '</script>'
  );

  parts.push('</body></html>');
  return parts.join("");
}

function findFileByNameInFolder_(folder, name) {
  var it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

exportGalleryHtml_5A3()

/* Test Writer file to GG Drive folder
function testWriteTarget() {
  var targetFolderId = "1rWZx2fLpUY5mj8CPMAOAXXeKn-fLWzZX";
  var f = DriveApp.getFolderById(targetFolderId);
  f.createFile("test_write.txt", "ok");
}
testWriteTarget() 
*/