# 📸 Google Apps Script – Web HTML Gallery & ZIP Downloader (Complete Guide)

Tài liệu này tổng hợp **toàn bộ hướng dẫn từ đầu đến cuối** để:
- Tạo **web gallery** hiển thị **thumbnail** từ một folder Google Drive (2000+ ảnh)
- **Phân trang + lazy-load** (tối ưu mạng chậm ~1 Mbps)
- Chọn nhiều ảnh và **Download dưới dạng ZIP** (không bị browser chặn multi-download)
- Deploy thành **Web App public (Everyone access)** bằng **Gmail cá nhân**
- Fix các lỗi thường gặp: truncate, permission, sai folderId, Workspace chặn anonymous, cache, crash khi tải ZIP

---

## 0) Tóm tắt cực nhanh

**Kết quả cuối**: bạn có 1 link Web App `/exec` mở ra gallery, search, chọn ảnh, bấm **Download ZIP** để tải về 1 file `.zip`.

**Không dùng Workspace** nếu cần public thật sự (anonymous), vì nhiều domain chặn.

---

## 1) Vì sao HTML tĩnh trên Drive không download được nhiều ảnh?

- Browser thường **chặn popup / multi-download**
- Link Drive download là cross-origin → thuộc tính `download` không luôn hoạt động
- Gọi nhiều `a.click()`/`window.open()` liên tục sẽ bị rate-limit

✅ Cách ổn định: **ZIP server-side** (Apps Script) → browser chỉ tải **1 file**.

---

## 2) Điều kiện bắt buộc (để “Everyone” truy cập được)

### ✅ Nên dùng
- **Gmail cá nhân** (không Workspace)

### ⚠️ Nếu ảnh nằm trong Drive Workspace
- Phải **share folder ảnh** cho Gmail cá nhân (Viewer) **hoặc** copy ảnh sang Drive cá nhân

### ❌ Workspace thường lỗi public web app
Nhiều Workspace admin policy chặn anonymous access → user khác mở link sẽ 404 / Drive error.

---

## 3) Tạo Apps Script project (Gmail cá nhân)

1. Mở **Incognito**
2. Login Gmail cá nhân
3. Vào https://script.google.com
4. **New project**
5. Dán code vào `Code.gs`

---

## 4) Code đầy đủ (khuyến nghị cách ZIP “an toàn” – không base64)

> Lý do: trả base64 ZIP về browser có thể làm **crash JS runtime** nếu ZIP lớn.
> Thay vào đó: **tạo ZIP thành file trên Drive** rồi trả về **download link**.

### 4.1 `doGet()` – entry Web App

```javascript
function doGet() {
  var pageSize = 120; // 80–150 hợp lý cho 1Mbps
  var items = getItems_();
  var html = buildGalleryHtml_(items, pageSize, ScriptApp.getService().getUrl());
  return HtmlService.createHtmlOutput(html).setTitle("5A3 - Gallery");
}
```

### 4.2 `getItems_()` – lấy ảnh từ folder nguồn

🔧 Thay `SOURCE_FOLDER_ID` cho đúng folder ảnh của bạn.

```javascript
function getItems_() {
  var sourceFolderId = "SOURCE_FOLDER_ID";
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
      // thumbnail nét hơn cho hiển thị 320px
      thumb: "https://drive.google.com/thumbnail?id=" + id + "&sz=w400-h380",
      download: "https://drive.usercontent.google.com/download?id=" + id + "&export=download"
    });
  }

  items.sort((a,b)=>a.name.localeCompare(b.name));
  return items;
}
```

### 4.3 ZIP “an toàn”: tạo file ZIP trên Drive và trả link download

🔧 Thay `ZIP_OUTPUT_FOLDER_ID` là folder để lưu file zip tạm (có thể là folder Public/5A3/ của bạn).

```javascript
function makeZip(fileIds) {
  if (!fileIds || !fileIds.length) throw new Error("No files selected");

  // Giới hạn tránh timeout (tuỳ ảnh nặng hay nhẹ)
  if (fileIds.length > 250) throw new Error("Chọn tối đa 250 ảnh/lần để ZIP.");

  var blobs = [];
  for (var i = 0; i < fileIds.length; i++) {
    var f = DriveApp.getFileById(fileIds[i]);
    blobs.push(f.getBlob().setName(f.getName()));
  }

  var zipName = "selected_" +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss") +
    ".zip";

  var zipBlob = Utilities.zip(blobs, zipName);

  // Tạo file zip trong 1 folder chỉ định
  var outFolderId = "ZIP_OUTPUT_FOLDER_ID";
  var outFolder = DriveApp.getFolderById(outFolderId);
  var zipFile = outFolder.createFile(zipBlob);

  // Share public (để Everyone tải được)
  zipFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Link download trực tiếp
  var downloadUrl = "https://drive.usercontent.google.com/download?id=" + zipFile.getId() + "&export=download";

  return {
    filename: zipName,
    url: downloadUrl,
    fileId: zipFile.getId()
  };
}
```

### 4.4 `buildGalleryHtml_()` – UI gallery + phân trang + nút ZIP

- Thumbnail hiển thị **320px**
- Nút ZIP gọi `google.script.run.makeZip(ids)` và **redirect** sang link download (không base64)

```javascript
function buildGalleryHtml_(items, pageSize, webAppUrl) {
  var dataJson = JSON.stringify(items).replace(/</g, "\u003c");
  pageSize = pageSize || 120;

  var parts = [];
  parts.push(
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Gallery</title>',
    '<style>',
      'body{font-family:Arial,sans-serif;margin:16px}',
      '.top{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #eee;z-index:10}',
      '.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
      'input[type="text"]{padding:8px 10px;min-width:260px}',
      'button{padding:8px 10px;cursor:pointer}',
      '.meta{color:#555;font-size:13px}',
      '.gallery{display:flex;flex-wrap:wrap;gap:20px;margin-top:14px}',
      '.item{width:320px;text-align:center}',
      '.thumb{width:320px;height:auto;border:1px solid #ddd;border-radius:10px;display:block}',
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
        '<strong style="font-size:18px">Gallery</strong>',
        '<span class="meta" id="meta"></span>',
      '</div>',
      '<div class="row" style="margin-top:10px">',
        '<input id="q" type="text" placeholder="Search filename...">',
        '<button onclick="selectAll(true)">Select all (page)</button>',
        '<button onclick="selectAll(false)">Unselect (page)</button>',
        '<button onclick="downloadZip()">Download ZIP (selected)</button>',
      '</div>',
      '<div class="hint" id="hint"></div>',
      '<div class="pager" id="pager"></div>',
    '</div>',
    '<div class="gallery" id="gallery"></div>'
  );

  parts.push(
    '<script>',
    'const ITEMS = ', dataJson, ';',
    'const PAGE_SIZE = ', String(pageSize), ';',
    'let filtered = ITEMS;',
    'let page = 1;',
    'const selected = new Set();',

    'function applyFilter(){',
      'const q = document.getElementById("q").value.trim().toLowerCase();',
      'filtered = q ? ITEMS.filter(x => x.name.toLowerCase().includes(q)) : ITEMS;',
      'page = 1;',
      'render();',
    '}',

    'function setPage(p){ page = p; render(); }',
    'function toggleSelect(id, checked){ if(checked) selected.add(id); else selected.delete(id); updateMeta(); }',

    'function selectAll(v){',
      'const start = (page-1)*PAGE_SIZE;',
      'const end = Math.min(start + PAGE_SIZE, filtered.length);',
      'for(let i=start;i<end;i++){ const id = filtered[i].id; if(v) selected.add(id); else selected.delete(id); }',
      'render(false); updateMeta();',
    '}',

    'function downloadZip(){',
      'const ids = Array.from(selected);',
      'if(!ids.length){ alert("Chưa chọn ảnh nào"); return; }',

      'const hint = document.getElementById("hint");',
      'hint.textContent = "Đang tạo ZIP... (tuỳ ảnh nặng/nhẹ sẽ mất vài giây)";',

      'if(!(window.google && google.script && google.script.run)){',
        'alert("Trang phải chạy dưới dạng Apps Script Web App để tạo ZIP.");',
        'hint.textContent = "";',
        'return;',
      '}',

      'google.script.run',
        '.withFailureHandler(err => {',
          'hint.textContent = "";',
          'alert(err && (err.message || err) ? (err.message || err) : "ZIP failed");',
        '})',
        '.withSuccessHandler(res => {',
          'hint.textContent = "ZIP xong! Đang tải...";',
          'window.location.href = res.url;',
          'setTimeout(()=>{ hint.textContent = ""; }, 4000);',
        '})',
        '.makeZip(ids);',
    '}',

    'function render(updatePager=true){',
      'const g = document.getElementById("gallery"); g.innerHTML="";',
      'const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));',
      'page = Math.min(page, totalPages);',
      'const start = (page-1)*PAGE_SIZE;',
      'const end = Math.min(start + PAGE_SIZE, filtered.length);',

      'for(let i=start;i<end;i++){',
        'const it = filtered[i];',
        'const div = document.createElement("div"); div.className="item";',
        'const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=selected.has(it.id); cb.onchange=()=>toggleSelect(it.id, cb.checked);',
        'const label=document.createElement("label"); label.appendChild(cb); label.appendChild(document.createTextNode(" Select"));',
        'const br=document.createElement("br");',
        'const a=document.createElement("a"); a.href=it.download; a.target="_blank"; a.rel="noopener";',
        'const img=document.createElement("img"); img.className="thumb"; img.loading="lazy"; img.src=it.thumb; img.alt=it.name; a.appendChild(img);',
        'const name=document.createElement("div"); name.className="name"; name.textContent=it.name;',
        'div.appendChild(label); div.appendChild(br); div.appendChild(a); div.appendChild(name);',
        'g.appendChild(div);',
      '}',

      'if(updatePager) renderPager(totalPages);',
      'updateMeta(totalPages);',
    '}',

    'function renderPager(totalPages){',
      'const p=document.getElementById("pager"); p.innerHTML="";',
      'const make=(label,to,active=false)=>{const s=document.createElement("span"); s.className="pill"+(active?" active":""); s.textContent=label; s.onclick=()=>setPage(to); return s;};',
      'p.appendChild(make("« Prev", Math.max(1,page-1)));',
      'const windowSize=7;',
      'let a=Math.max(1,page-Math.floor(windowSize/2));',
      'let b=Math.min(totalPages,a+windowSize-1);',
      'a=Math.max(1,b-windowSize+1);',
      'for(let i=a;i<=b;i++) p.appendChild(make(String(i), i, i===page));',
      'p.appendChild(make("Next »", Math.min(totalPages,page+1)));',
    '}',

    'function updateMeta(totalPages){',
      'const m=document.getElementById("meta");',
      'const tp = totalPages ?? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));',
      'm.textContent = `Total: ${ITEMS.length} | Showing: ${filtered.length} | Page: ${page}/${tp} | Selected: ${selected.size}`;',
    '}',

    'document.getElementById("q").addEventListener("input", ()=>{ clearTimeout(window.__t); window.__t=setTimeout(applyFilter,150); });',
    'render();',
    '</script>'
  );

  parts.push('</body></html>');
  return parts.join("");
}
```

---

## 5) Cấp quyền lần đầu

Tạo hàm test:

```javascript
function authTest() {
  getItems_();
}
```

Run `authTest()` trong editor → Accept permissions.

---

## 6) Deploy Web App (Everyone)

Deploy → New deployment → **Web app**
- Execute as: **Me**
- Who has access: **Anyone**
Deploy → copy URL `/exec`

Test: mở Incognito (không login) vẫn vào được.

---

## 7) Sửa lỗi “The JavaScript runtime exited unexpectedly”

Thông báo này thường do:
- ZIP lớn → trả base64 → **atob/Blob** làm crash iframe runtime
- hoặc message giữa iframe và server quá lớn

✅ Fix dứt điểm:
- **KHÔNG trả base64** nữa
- Tạo ZIP file trên Drive và trả về **URL download** (mục 4.3 & 4.4)

---

## 8) Cache khi đổi thumbnail size

Nếu bạn đổi `sz=w200-h190` → `w400-h380` mà vẫn như cũ:
- Deploy **New version**
- Mở lại URL với `?v=2` hoặc hard refresh (Ctrl+F5)

---

## 9) Tuning khuyến nghị cho 2000 ảnh / 1Mbps

- `pageSize`: 80–150
- thumb: `w400` hiển thị 320px
- giữ `loading="lazy"`
- hạn chế ZIP/lần: 100–250 (tuỳ ảnh nặng)

---

## 10) Checklist nhanh trước khi share

- [ ] Web App chạy bằng Gmail cá nhân
- [ ] Folder ảnh share cho Gmail cá nhân
- [ ] `Who has access: Anyone`
- [ ] Nút ZIP dùng **redirect URL** (không base64)
- [ ] Thumbnails hiển thị 320px (CSS `.thumb{width:320px}`)

---

Chúc bạn deploy gallery thành công 🎉
