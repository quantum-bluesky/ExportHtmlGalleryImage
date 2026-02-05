function doGet() {
  var pageSize = 120; // 80-150 ok cho 1Mbps
  var items = getItems_(); // lấy danh sách ảnh
  var html = buildGalleryHtml_(items, pageSize, ScriptApp.getService().getUrl());
  return HtmlService.createHtmlOutput(html).setTitle("5A3 - Thumbnails");
}

function getItems_() {
  var sourceFolderId = "1FmU00bWs_jHCpt8WZOAkb5XoTfcMmqII"; // folder ảnh nguồn
  var sourceFolder = DriveApp.getFolderById(sourceFolderId);
  var files = sourceFolder.getFiles();

  var items = [];
  while (files.hasNext()) {
    var f = files.next();
    var mt = (f.getMimeType() || "").toLowerCase();
    if (!mt.startsWith("image/")) continue;

    var id = f.getId();
    items.push({
      id: id,
      name: f.getName(),
      thumb: "https://drive.google.com/thumbnail?id=" + id + "&sz=w200-h190",
      download: "https://drive.usercontent.google.com/download?id=" + id + "&export=download"
    });
  }
  items.sort((a,b)=>a.name.localeCompare(b.name));
  return items;
}

function makeZip(fileIds) {
  if (!fileIds || !fileIds.length) throw new Error("No files selected");

  // tránh timeout: zip nhiều quá sẽ lâu (tuỳ kích thước ảnh)
  if (fileIds.length > 250) {
    throw new Error("Chọn tối đa 250 ảnh/lần để ZIP (tránh timeout).");
  }

  var blobs = [];
  for (var i = 0; i < fileIds.length; i++) {
    var f = DriveApp.getFileById(fileIds[i]);
    blobs.push(f.getBlob().setName(f.getName()));
  }

  var zipName = "5A3_selected_" +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss") +
    ".zip";

  var zipBlob = Utilities.zip(blobs, zipName);

  return {
    filename: zipName,
    contentType: "application/zip",
    base64: Utilities.base64Encode(zipBlob.getBytes())
  };
}

function buildGalleryHtml_(items, pageSize, webAppUrl) {
  // Nhúng data vào HTML (tránh lỗi khi tên file có ký tự đặc biệt + tránh </script>)
  var dataJson = JSON.stringify(items).replace(/</g, "\\u003c");
  pageSize = pageSize || 120;
  webAppUrl = webAppUrl || ""; // có thể bỏ trống nếu không chạy Web App

  var parts = [];
  parts.push(
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>5A3 - Thumbnails</title>',
    '<style>',
      'body{font-family:Arial,sans-serif;margin:16px}',
      '.top{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #eee;z-index:10}',
      '.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
      'input[type="text"]{padding:8px 10px;min-width:260px}',
      'button{padding:8px 10px;cursor:pointer}',
      '.meta{color:#555;font-size:13px}',
      '.gallery{display:flex;flex-wrap:wrap;gap:14px;margin-top:14px}',
      '.item{width:160px;text-align:center}',
      '.thumb{width:160px;height:auto;border:1px solid #ddd;border-radius:8px;display:block}',
      '.name{font-size:12px;margin:6px 0 0;word-break:break-word}',
      '.pager{margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.pill{padding:6px 10px;border:1px solid #ddd;border-radius:999px;cursor:pointer;user-select:none}',
      '.pill.active{border-color:#333;font-weight:700}',
      '.hint{font-size:12px;color:#777;margin-top:6px}',
    '</style></head><body>'
  );

  parts.push(
    '<div class="top">',
      '<div class="row">',
        '<strong style="font-size:18px">Public / 5A3</strong>',
        '<span class="meta" id="meta"></span>',
      '</div>',

      '<div class="row" style="margin-top:10px">',
        '<input id="q" type="text" placeholder="Search filename...">',
        '<button onclick="selectAll(true)">Select all (page)</button>',
        '<button onclick="selectAll(false)">Unselect (page)</button>',
        '<button onclick="openSelected()">Open selected</button>',
        '<button onclick="downloadZip()">Download ZIP (selected)</button>',
      '</div>',

      '<div class="hint">Gợi ý: nút ZIP chỉ hoạt động khi trang được mở qua Web App (google.script.run). Nếu mở file .html trực tiếp trên Drive, browser thường chặn download nhiều file.</div>',

      '<div class="pager" id="pager"></div>',
    '</div>',
    '<div class="gallery" id="gallery"></div>'
  );

  parts.push(
    '<script>',
    'const ITEMS = ', dataJson, ';',
    'const PAGE_SIZE = ', String(pageSize), ';',
    'const WEBAPP_URL = ', JSON.stringify(webAppUrl), ';',
    'let filtered = ITEMS;',
    'let page = 1;',
    'const selected = new Set();',

    'function esc(s){return String(s)',
      '.replace(/&/g,"&amp;")',
      '.replace(/</g,"&lt;")',
      '.replace(/>/g,"&gt;")',
      '.replace(/"/g,"&quot;")',
      '.replace(/\\x27/g,"&#39;");}',
    'function applyFilter(){',
      'const q = document.getElementById("q").value.trim().toLowerCase();',
      'filtered = q ? ITEMS.filter(x => x.name.toLowerCase().includes(q)) : ITEMS;',
      'page = 1;',
      'render();',
    '}',
    'function setPage(p){ page = p; render(); }',
    'function toggleSelect(id, checked){',
      'if(checked) selected.add(id); else selected.delete(id);',
      'updateMeta();',
    '}',

    // Select all/unselect all chỉ trong trang hiện tại
    'function selectAll(v){',
      'const start = (page-1)*PAGE_SIZE;',
      'const end = Math.min(start + PAGE_SIZE, filtered.length);',
      'for(let i=start;i<end;i++){',
        'const id = filtered[i].id;',
        'if(v) selected.add(id); else selected.delete(id);',
      '}',
      'render(false);',
      'updateMeta();',
    '}',

    // Mở từng ảnh (browser có thể chặn nếu nhiều)
    'function openSelected(){',
      'const arr = Array.from(selected);',
      'if(!arr.length){alert("Chưa chọn ảnh nào");return;}',
      'const map = new Map(ITEMS.map(x=>[x.id,x]));',
      'arr.forEach((id,i)=>{',
        'const it = map.get(id); if(!it) return;',
        'setTimeout(()=>{',
          'window.open(it.download || ("https://drive.usercontent.google.com/download?id="+id+"&export=download"), "_blank", "noopener");',
        '}, i*250);',
      '});',
    '}',

    // Tải ZIP: ưu tiên google.script.run (Web App). Nếu không có thì báo user.
    'function downloadZip(){',
      'const ids = Array.from(selected);',
      'if(!ids.length){ alert("Chưa chọn ảnh nào"); return; }',

      // Nếu chạy trong Web App (HtmlService) => có google.script.run
      'if (window.google && google.script && google.script.run){',
        'google.script.run',
          '.withFailureHandler(err => alert(err && (err.message || err) ? (err.message || err) : "ZIP failed"))',
          '.withSuccessHandler(res => {',
            'try{',
              'const bytes = atob(res.base64);',
              'const arr = new Uint8Array(bytes.length);',
              'for(let i=0;i<bytes.length;i++) arr[i] = bytes.charCodeAt(i);',
              'const blob = new Blob([arr], {type: res.contentType || "application/zip"});',
              'const url = URL.createObjectURL(blob);',
              'const a = document.createElement("a");',
              'a.href = url;',
              'a.download = res.filename || "selected.zip";',
              'document.body.appendChild(a);',
              'a.click();',
              'a.remove();',
              'URL.revokeObjectURL(url);',
            '}catch(e){',
              'alert("Không thể tải ZIP: " + e);',
            '}',
          '})',
          '.makeZip(ids);',
        'return;',
      '}',

      // Nếu không phải Web App nhưng bạn có endpoint WEBAPP_URL => gọi fetch (tùy bạn triển khai endpoint)
      'if (WEBAPP_URL){',
        'alert("Trang này không chạy trong Web App context. Nếu bạn muốn ZIP từ file .html tĩnh, cần triển khai endpoint Web App nhận POST và trả về base64 ZIP. Hiện tại nút ZIP đang bật nhưng không có google.script.run.");',
        'return;',
      '}',

      'alert("Nút ZIP chỉ hoạt động khi bạn mở gallery qua Web App (HtmlService). Mở file .html trực tiếp trong Drive sẽ không gọi được server để tạo ZIP.");',
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
      'const p = document.getElementById("pager");',
      'p.innerHTML = "";',
      'const make = (label, to, active=false) => {',
        'const s=document.createElement("span");',
        's.className="pill"+(active?" active":"");',
        's.textContent=label;',
        's.onclick=()=>setPage(to);',
        'return s;',
      '};',
      'p.appendChild(make("« Prev", Math.max(1,page-1)));',
      'const windowSize = 7;',
      'let a = Math.max(1, page - Math.floor(windowSize/2));',
      'let b = Math.min(totalPages, a + windowSize - 1);',
      'a = Math.max(1, b - windowSize + 1);',
      'for(let i=a;i<=b;i++) p.appendChild(make(String(i), i, i===page));',
      'p.appendChild(make("Next »", Math.min(totalPages,page+1)));',
    '}',

    'function updateMeta(totalPages){',
      'const m = document.getElementById("meta");',
      'const tp = totalPages ?? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));',
      'm.textContent = `Total: ${ITEMS.length} | Showing: ${filtered.length} | Page: ${page}/${tp} | Selected: ${selected.size}`;',
    '}',

    'document.getElementById("q").addEventListener("input", ()=>{',
      'clearTimeout(window.__t); window.__t=setTimeout(applyFilter, 150);',
    '});',
    'render();',
    '</script>'
  );

  parts.push('</body></html>');
  return parts.join("");
}

function authTest() {
  getItems_();
}
