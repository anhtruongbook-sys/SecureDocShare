# -*- coding: utf-8 -*-
"""
unified_locker.py: BỘ ĐIỀU PHỐI MÃ HÓA VÀ BẢO VỆ TÀI LIỆU TOÀN DIỆN (UNIFIED SECURE LOCKER)
Dự án: SecureDocShare

Hỗ trợ 2 CẤP ĐỘ PHÂN QUYỀN (Protection Levels):
1. OPEN_PASSWORD_REQUIRED: Chỉ nhập đúng mật khẩu mới mở được file.
2. VIEW_ONLY_RESTRICTED: Có thể mở tự do xem, nhưng CẤM SỬA, CẤM IN, CẤM COPY.

Hỗ trợ 3 CHẾ ĐỘ MÃ HÓA (Protection Modes):
1. NATIVE: Mở trực tiếp bằng Microsoft Office / Adobe Photoshop & Acrobat Reader.
2. HTML_SELF_DECRYPT: Đóng gói thành tệp HTML Tự Giải Mã Zero-Knowledge.
3. SECVAULT: Gói tin nhị phân bảo mật AES-256-GCM cấp quân sự.
"""

import os
import mimetypes
from enum import Enum
from typing import Dict, Any, List, Optional, Tuple

from .crypto_engine import CryptoEngine, MAGIC_HEADER
from .pdf_locker import PDFLocker
from .office_locker import OfficeLocker


class ProtectionLevel(Enum):
    """2 Cấp độ phân quyền bảo mật."""
    OPEN_PASSWORD_REQUIRED = "open_password"      # Bắt buộc nhập mật khẩu mới mở được file
    VIEW_ONLY_RESTRICTED = "view_only_restricted"  # Mở tự do xem, nhưng CẤM SỬA, CẤM IN, CẤM COPY


class ProtectionMode(Enum):
    """3 Chế độ bảo vệ tệp tin."""
    NATIVE = "native"                  # Mở trực tiếp bằng Microsoft Office & Adobe Reader/Photoshop
    HTML_SELF_DECRYPT = "html_vault"   # Tự giải mã bằng trình duyệt trên mọi thiết bị
    SECVAULT = "secvault"              # Gói nhị phân bảo mật AES-256-GCM (.secvault)


class UnifiedLocker:
    """Động cơ điều phối hợp nhất toàn bộ tác vụ mã hóa và phân quyền."""

    @staticmethod
    def detect_file_type(filename: str) -> str:
        """Nhận diện định dạng tệp tin."""
        ext = os.path.splitext(filename)[1].lower()
        if ext == ".pdf":
            return "pdf"
        elif ext in [".docx", ".doc"]:
            return "word"
        elif ext in [".xlsx", ".xls"]:
            return "excel"
        elif ext in [".pptx", ".ppt"]:
            return "powerpoint"
        elif ext in [".secvault"]:
            return "secvault"
        elif ext in [".html", ".htm"]:
            return "html"
        return "generic"

    @classmethod
    def lock_file(
        cls,
        input_path: str,
        output_dir: str,
        password: str,
        protection_level: ProtectionLevel = ProtectionLevel.OPEN_PASSWORD_REQUIRED,
        mode: ProtectionMode = ProtectionMode.NATIVE,
        hint_message: str = "",
        allow_printing: bool = False,
        allow_copying: bool = False
    ) -> Dict[str, Any]:
        """
        Mã hóa hoặc phân quyền tài liệu theo cấp độ và chế độ được chỉ định.
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Không tìm thấy tệp đầu vào: {input_path}")

        os.makedirs(output_dir, exist_ok=True)
        filename = os.path.basename(input_path)
        base_name, ext = os.path.splitext(filename)
        ftype = cls.detect_file_type(filename)

        is_view_only = (protection_level == ProtectionLevel.VIEW_ONLY_RESTRICTED)

        # ---------------------------------------------------------------------
        # CHẾ ĐỘ 1: NATIVE (Adobe Photoshop, Acrobat & Microsoft Office)
        # ---------------------------------------------------------------------
        if mode == ProtectionMode.NATIVE:
            if ftype == "pdf":
                if is_view_only:
                    out_filename = f"{base_name}_ReadOnly_NoCopyPrint.pdf"
                    desc = "Tệp PDF xem tự do • CẤM IN, CẤM COPY, CẤM CHỈNH SỬA (Chuẩn Adobe R6)"
                else:
                    out_filename = f"{base_name}_Locked.pdf"
                    desc = "Tệp PDF khóa chặt • Chỉ nhập đúng mật khẩu mới mở được (Adobe AES-256 R6)"

                out_path = os.path.join(output_dir, out_filename)
                res = PDFLocker.encrypt_pdf(
                    input_pdf_path=input_path,
                    output_pdf_path=out_path,
                    user_password=password,
                    owner_password=password + "_admin_sec",
                    require_open_password=not is_view_only,
                    allow_printing=allow_printing if not is_view_only else False,
                    allow_copying=allow_copying if not is_view_only else False,
                    allow_modifying=False
                )
                res["output_filename"] = out_filename
                res["mode"] = mode.value
                res["protection_level"] = protection_level.value
                res["description"] = desc
                res["size_bytes"] = os.path.getsize(out_path)
                return res

            elif ftype in ["word", "excel", "powerpoint"]:
                if is_view_only:
                    out_filename = f"{base_name}_ReadOnly_NoEdit{ext}"
                    desc = f"Tệp {ftype.upper()} xem tự do • CẤM CHỈNH SỬA NỘI DUNG (Microsoft Restrict Editing)"
                else:
                    out_filename = f"{base_name}_Locked{ext}"
                    desc = f"Tệp {ftype.upper()} khóa chặt • Chỉ nhập đúng mật khẩu mới mở được (Microsoft Agile AES-256)"

                out_path = os.path.join(output_dir, out_filename)
                try:
                    res = OfficeLocker.encrypt_office_native(
                        input_path=input_path,
                        output_path=out_path,
                        open_password=password if not is_view_only else None,
                        owner_password=password,
                        require_open_password=not is_view_only
                    )
                    res["output_filename"] = out_filename
                    res["mode"] = mode.value
                    res["protection_level"] = protection_level.value
                    res["description"] = desc
                    res["size_bytes"] = os.path.getsize(out_path)
                    return res
                except Exception as e:
                    # Nếu máy chủ không có Office COM, fallback sang HTML Self-Decrypt
                    return cls.lock_file(
                        input_path=input_path,
                        output_dir=output_dir,
                        password=password,
                        protection_level=protection_level,
                        mode=ProtectionMode.HTML_SELF_DECRYPT,
                        hint_message=f"{hint_message} (Tự động chuyển đổi sang HTML Vault do thiếu Office COM)"
                    )
            else:
                # Định dạng khác tự động dùng HTML Vault
                return cls.lock_file(
                    input_path=input_path,
                    output_dir=output_dir,
                    password=password,
                    protection_level=protection_level,
                    mode=ProtectionMode.HTML_SELF_DECRYPT,
                    hint_message=hint_message
                )

        # ---------------------------------------------------------------------
        # CHẾ ĐỘ 2: HTML_SELF_DECRYPT (Zero-Knowledge HTML cho mọi thiết bị)
        # ---------------------------------------------------------------------
        elif mode == ProtectionMode.HTML_SELF_DECRYPT:
            out_filename = f"{base_name}_SecureVault.html"
            out_path = os.path.join(output_dir, out_filename)

            mime_type, _ = mimetypes.guess_type(input_path)
            mime_type = mime_type or "application/octet-stream"

            with open(input_path, "rb") as f_in:
                file_bytes = f_in.read()

            html_content = CryptoEngine.generate_self_decrypting_html(
                file_bytes=file_bytes,
                filename=filename,
                password=password,
                mime_type=mime_type,
                hint_message=hint_message
            )

            with open(out_path, "w", encoding="utf-8") as f_out:
                f_out.write(html_content)

            return {
                "status": "SUCCESS",
                "mode": mode.value,
                "protection_level": protection_level.value,
                "original_file": filename,
                "output_filename": out_filename,
                "output_path": out_path,
                "size_bytes": os.path.getsize(out_path),
                "description": "Tệp HTML Tự Giải Mã Zero-Knowledge (Mở trực tiếp trên mọi trình duyệt điện thoại/PC)"
            }

        # ---------------------------------------------------------------------
        # CHẾ ĐỘ 3: SECVAULT (Binary Container AES-256-GCM)
        # ---------------------------------------------------------------------
        elif mode == ProtectionMode.SECVAULT:
            out_filename = f"{base_name}.secvault"
            out_path = os.path.join(output_dir, out_filename)

            with open(input_path, "rb") as f_in:
                file_bytes = f_in.read()

            metadata = {
                "original_filename": filename,
                "file_type": ftype,
                "protection_level": protection_level.value,
                "hint": hint_message
            }
            encrypted_payload = CryptoEngine.encrypt_bytes(file_bytes, password, metadata)

            with open(out_path, "wb") as f_out:
                f_out.write(encrypted_payload)

            return {
                "status": "SUCCESS",
                "mode": mode.value,
                "protection_level": protection_level.value,
                "original_file": filename,
                "output_filename": out_filename,
                "output_path": out_path,
                "size_bytes": len(encrypted_payload),
                "description": "Gói tin nhị phân bảo mật AES-256-GCM cấp quân sự"
            }

        raise ValueError(f"Chế độ bảo vệ không hợp lệ: {mode}")

    @classmethod
    def unlock_file(
        cls,
        encrypted_path: str,
        output_dir: str,
        password: str
    ) -> Dict[str, Any]:
        """
        Mở khóa và giải mã tệp tin trở lại bản gốc hoàn toàn không bị khóa.
        """
        if not os.path.exists(encrypted_path):
            raise FileNotFoundError(f"Không tìm thấy tệp: {encrypted_path}")

        os.makedirs(output_dir, exist_ok=True)
        filename = os.path.basename(encrypted_path)
        base_name, ext = os.path.splitext(filename)
        ext_lower = ext.lower()

        # Làm sạch tên tệp đầu ra
        clean_name = base_name.replace("_Locked", "").replace("_ReadOnly_NoCopyPrint", "").replace("_ReadOnly_NoEdit", "")

        # 1. Tệp .secvault
        if ext_lower == ".secvault":
            with open(encrypted_path, "rb") as f_in:
                payload = f_in.read()

            plaintext, metadata = CryptoEngine.decrypt_bytes(payload, password)
            orig_name = metadata.get("original_filename", f"{clean_name}_Unlocked.bin")
            out_path = os.path.join(output_dir, orig_name)

            with open(out_path, "wb") as f_out:
                f_out.write(plaintext)

            return {
                "status": "SUCCESS",
                "unlocked_filename": orig_name,
                "output_path": out_path,
                "metadata": metadata
            }

        # 2. Tệp PDF
        elif ext_lower == ".pdf":
            out_filename = f"{clean_name}_Unlocked.pdf"
            out_path = os.path.join(output_dir, out_filename)
            res = PDFLocker.decrypt_pdf(encrypted_path, out_path, password)
            res["unlocked_filename"] = out_filename
            return res

        # 3. Tệp Office Word, Excel, PowerPoint
        elif ext_lower in [".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"]:
            out_filename = f"{clean_name}_Unlocked{ext}"
            out_path = os.path.join(output_dir, out_filename)
            res = OfficeLocker.decrypt_office_file(encrypted_path, out_path, password)
            res["unlocked_filename"] = out_filename
            return res

        else:
            raise ValueError(f"Định dạng tệp không được hỗ trợ giải mã: {ext}")
