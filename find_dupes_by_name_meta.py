import os
import re
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

try:
    from PIL import Image, ExifTags
except ImportError:
    print("Thiếu Pillow. Cài bằng: pip install pillow")
    sys.exit(1)

# Nhận dạng suffix trùng: (1) hoặc _1 ở cuối tên (trước extension)
DUP_SUFFIX_RE = re.compile(r"^(?P<base>.*?)(?:\((?P<n1>\d+)\)|_(?P<n2>\d+))$")

# Một số EXIF tags thường ổn định để phân biệt/so sánh nhanh
PREFERRED_EXIF_KEYS = {
    "DateTimeOriginal",
    "CreateDate",
    "DateTime",
    "Make",
    "Model",
    "LensModel",
    "FNumber",
    "ExposureTime",
    "ISOSpeedRatings",
    "FocalLength",
    "ImageWidth",
    "ImageLength",
}

def norm_base_stem(stem: str) -> str:
    """
    Trả về base id để gom nhóm:
      A49I4322(1) -> A49I4322
      A49I4322_2  -> A49I4322
      A49I4322    -> A49I4322
    """
    m = DUP_SUFFIX_RE.match(stem)
    return m.group("base") if m else stem

def safe_stat(p: Path):
    st = p.stat()
    return {
        "size": st.st_size,
        "mtime": st.st_mtime,
        "mtime_iso": datetime.fromtimestamp(st.st_mtime).isoformat(sep=" ", timespec="seconds"),
    }

def read_exif_signature(p: Path):
    """
    Đọc EXIF và tạo signature (dict) từ những keys ưu tiên.
    Nếu không có/không đọc được -> return None.
    """
    try:
        with Image.open(p) as img:
            exif = img.getexif()
            if not exif or len(exif) == 0:
                return None

            # map tag id -> tên tag
            tag_map = {}
            for k, v in ExifTags.TAGS.items():
                tag_map[k] = v

            sig = {}
            for tag_id, value in exif.items():
                name = tag_map.get(tag_id, str(tag_id))
                if name in PREFERRED_EXIF_KEYS:
                    # chuẩn hoá value để json-serializable
                    if isinstance(value, bytes):
                        value = value.decode(errors="ignore")
                    sig[name] = str(value)

            return sig if sig else None
    except Exception:
        return None

def compute_quick_key(p: Path):
    """
    Quick-key để so sánh:
      - size + exif_signature (nếu có)
      - nếu không có exif_signature: size + mtime (iso)
    """
    st = safe_stat(p)
    exif_sig = read_exif_signature(p)
    if exif_sig:
        # sort keys để ổn định
        exif_norm = json.dumps(exif_sig, ensure_ascii=False, sort_keys=True)
        return ("SIZE+EXIF", st["size"], exif_norm), exif_sig, st
    else:
        return ("SIZE+DATE", st["size"], st["mtime_iso"]), None, st

def pick_original(files: list[Path], base: str):
    """
    Chọn ảnh gốc ưu tiên:
      1) file có stem đúng bằng base (A49I4322.*)
      2) nếu không có: chọn file có mtime sớm nhất (thường là file gốc cũ hơn)
    """
    exact = [p for p in files if p.stem == base]
    if exact:
        # nếu có nhiều extension, chọn cái mtime sớm nhất trong exact
        exact.sort(key=lambda p: p.stat().st_mtime)
        return exact[0]
    files_sorted = sorted(files, key=lambda p: p.stat().st_mtime)
    return files_sorted[0]

def is_image_file(p: Path):
    return p.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".webp"}

def build_delete_command(paths: list[Path], os_mode: str):
    cmds = []
    for p in paths:
        # quote path
        s = str(p)
        if os_mode == "windows":
            cmds.append(f'del /f /q "{s}"')
        else:
            cmds.append(f'rm -f "{s}"')
    return cmds

def main():
    ap = argparse.ArgumentParser(description="Find duplicate photos by name pattern + size + EXIF (fallback Date). Output delete commands.")
    ap.add_argument("folder", help="Đường dẫn folder cần quét")
    ap.add_argument("--os", choices=["auto", "windows", "unix"], default="auto",
                    help="Xuất lệnh xóa cho Windows (del) hay Unix/macOS (rm). auto = theo hệ điều hành hiện tại")
    ap.add_argument("--out", default="delete_commands.txt", help="File output command list")
    ap.add_argument("--report", default="dupe_report.txt", help="File báo cáo nhóm trùng")
    args = ap.parse_args()

    folder = Path(args.folder).expanduser().resolve()
    if not folder.exists() or not folder.is_dir():
        print(f"Folder không hợp lệ: {folder}")
        sys.exit(1)

    os_mode = args.os
    if os_mode == "auto":
        os_mode = "windows" if os.name == "nt" else "unix"

    # 1) collect
    all_imgs = [p for p in folder.iterdir() if p.is_file() and is_image_file(p)]
    if not all_imgs:
        print("Không tìm thấy ảnh trong folder.")
        sys.exit(0)

    # 2) group by base stem
    groups = {}
    for p in all_imgs:
        base = norm_base_stem(p.stem)
        groups.setdefault(base, []).append(p)

    report_lines = []
    delete_candidates = []

    # 3) analyze each group with >=2 files
    for base, files in sorted(groups.items(), key=lambda x: x[0].lower()):
        if len(files) < 2:
            continue

        original = pick_original(files, base)

        # quick key của original
        orig_key, orig_exif, orig_stat = compute_quick_key(original)

        # so sánh từng file còn lại
        dup_list = []
        diff_list = []

        for p in files:
            if p == original:
                continue
            key, exif_sig, st = compute_quick_key(p)

            if key == orig_key:
                dup_list.append((p, key, exif_sig, st))
            else:
                diff_list.append((p, key, exif_sig, st))

        if not dup_list and not diff_list:
            continue

        report_lines.append("=" * 80)
        report_lines.append(f"GROUP: {base}")
        report_lines.append(f"ORIGINAL: {original.name}")
        report_lines.append(f"  - CompareKeyType: {orig_key[0]}")
        report_lines.append(f"  - Size: {orig_stat['size']}")
        report_lines.append(f"  - Date(mtime): {orig_stat['mtime_iso']}")
        if orig_exif:
            report_lines.append(f"  - EXIF(sig): {json.dumps(orig_exif, ensure_ascii=False, sort_keys=True)}")
        else:
            report_lines.append("  - EXIF(sig): (none) -> fallback Date")

        if dup_list:
            report_lines.append("\n  DUPLICATES (match original by size+meta/date):")
            for p, key, exif_sig, st in sorted(dup_list, key=lambda x: x[0].name.lower()):
                report_lines.append(f"    - {p.name} | size={st['size']} | mtime={st['mtime_iso']}")
            delete_candidates.extend([p for p, *_ in dup_list])

        if diff_list:
            report_lines.append("\n  SIMILAR-NAME BUT DIFFERENT (NOT auto-delete):")
            for p, key, exif_sig, st in sorted(diff_list, key=lambda x: x[0].name.lower()):
                report_lines.append(f"    - {p.name} | keyType={key[0]} | size={st['size']} | mtime={st['mtime_iso']}")
            report_lines.append("  (Các file này cùng base name nhưng khác size/meta/date -> không đưa vào lệnh xóa)")

        report_lines.append("")

    # 4) output files
    if report_lines:
        Path(args.report).write_text("\n".join(report_lines), encoding="utf-8")
    else:
        Path(args.report).write_text("Không phát hiện nhóm trùng theo quy tắc tên + so sánh size/meta/date.\n", encoding="utf-8")

    # 5) delete commands
    cmds = build_delete_command(delete_candidates, os_mode)
    Path(args.out).write_text("\n".join(cmds) + ("\n" if cmds else ""), encoding="utf-8")

    print(f"Đã quét: {folder}")
    print(f"Báo cáo: {Path(args.report).resolve()}")
    print(f"Lệnh xóa: {Path(args.out).resolve()}")
    print(f"Tổng file trùng (đề xuất xóa): {len(delete_candidates)}")
    if len(delete_candidates) == 0:
        print("Không có file nào được đề xuất xóa (match hoàn toàn với ảnh gốc).")

if __name__ == "__main__":
    main()
