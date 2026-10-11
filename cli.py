# -*- coding: utf-8 -*-
"""
cli.py: GIAO DIỆN DÒNG LỆNH MÃ HÓA & GIẢI MÃ TÀI LIỆU HÀNG LOẠT (SECUREDOCSHARE CLI)
Dự án: SecureDocShare

Cách dùng:
1. Mã hóa tệp thành HTML Tự Giải Mã (Khuyên dùng khi gửi qua mạng/Zalo):
   python cli.py lock "hop_dong.pdf" -p "MatKhauSieuKho123" -m html

2. Mã hóa trực tiếp Native Office/PDF (Mở bằng Word/Excel/Acrobat):
   python cli.py lock "bao_cao.docx" -p "MatKhauSieuKho123" -m native

3. Mã hóa sang Container cấp quân sự .secvault:
   python cli.py lock "du_lieu.xlsx" -p "MatKhauSieuKho123" -m secvault

4. Mở khóa và giải mã tệp:
   python cli.py unlock "du_lieu.secvault" -p "MatKhauSieuKho123" -o "./giai_ma"
"""

import os
import sys
import argparse

# Thiết lập UTF-8 cho console Windows
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from core.unified_locker import UnifiedLocker, ProtectionMode, ProtectionLevel


def main():
    parser = argparse.ArgumentParser(
        description="SecureDocShare CLI: Mã hóa và bảo vệ tài liệu PDF, Word, Excel, PPT cấp quân sự."
    )
    subparsers = parser.add_subparsers(dest="command", help="Lệnh thực thi: lock hoặc unlock")

    # Subcommand: lock
    lock_parser = subparsers.add_parser("lock", help="Khóa và mã hóa tệp tin")
    lock_parser.add_argument("input_file", help="Đường dẫn tới tệp cần mã hóa (.pdf, .docx, .xlsx, .pptx,...)")
    lock_parser.add_argument("-p", "--password", required=True, help="Mật khẩu mã hóa bảo vệ tệp")
    lock_parser.add_argument(
        "-l", "--level",
        choices=["open_password", "view_only"],
        default="open_password",
        help="Cấp độ phân quyền: open_password (chỉ đúng pass mới mở được), view_only (mở xem tự do, cấm sửa in copy)"
    )
    lock_parser.add_argument(
        "-m", "--mode",
        choices=["native", "html", "secvault"],
        default="native",
        help="Chế độ bảo vệ: native (Word/Excel/Photoshop/Acrobat), html (tự giải mã), secvault (.secvault)"
    )
    lock_parser.add_argument("-o", "--output-dir", default="./output_encrypted", help="Thư mục lưu tệp mã hóa")
    lock_parser.add_argument("--hint", default="", help="Gợi ý mật khẩu cho người nhận")
    lock_parser.add_argument("--no-print", action="store_true", help="Cấm in ấn (đối với PDF)")
    lock_parser.add_argument("--allow-copy", action="store_true", help="Cho phép sao chép văn bản (đối với PDF)")

    # Subcommand: unlock
    unlock_parser = subparsers.add_parser("unlock", help="Mở khóa và giải mã tệp tin")
    unlock_parser.add_argument("encrypted_file", help="Đường dẫn tới tệp đã mã hóa")
    unlock_parser.add_argument("-p", "--password", required=True, help="Mật khẩu giải mã")
    unlock_parser.add_argument("-o", "--output-dir", default="./output_decrypted", help="Thư mục lưu tệp sau giải mã")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    if args.command == "lock":
        mode_map = {
            "html": ProtectionMode.HTML_SELF_DECRYPT,
            "native": ProtectionMode.NATIVE,
            "secvault": ProtectionMode.SECVAULT
        }
        level_map = {
            "open_password": ProtectionLevel.OPEN_PASSWORD_REQUIRED,
            "view_only": ProtectionLevel.VIEW_ONLY_RESTRICTED
        }
        chosen_mode = mode_map[args.mode]
        chosen_level = level_map[args.level]

        print(f"[*] Đang xử lý tệp: {args.input_file}")
        print(f"[*] Cấp độ phân quyền: {chosen_level.value.upper()}")
        print(f"[*] Chế độ định dạng : {chosen_mode.value.upper()}")

        try:
            res = UnifiedLocker.lock_file(
                input_path=args.input_file,
                output_dir=args.output_dir,
                password=args.password,
                protection_level=chosen_level,
                mode=chosen_mode,
                hint_message=args.hint,
                allow_printing=not args.no_print if args.level == "open_password" else False,
                allow_copying=args.allow_copy if args.level == "open_password" else False
            )
            print("\n[✓] MÃ HÓA THÀNH CÔNG!")
            print(f"    - Tệp xuất ra: {res['output_path']}")
            print(f"    - Dung lượng: {res.get('size_bytes', 0)} bytes")
            print(f"    - Mô tả: {res.get('description', '')}")
        except Exception as e:
            print(f"\n[✕] LỖI MÃ HÓA: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "unlock":
        print(f"[*] Đang mở khóa tệp: {args.encrypted_file}")
        try:
            res = UnifiedLocker.unlock_file(
                encrypted_path=args.encrypted_file,
                output_dir=args.output_dir,
                password=args.password
            )
            print("\n[✓] MỞ KHÓA THÀNH CÔNG!")
            print(f"    - Tệp đã khôi phục: {res['output_path']}")
        except Exception as e:
            print(f"\n[✕] LỖI GIẢI MÃ: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
