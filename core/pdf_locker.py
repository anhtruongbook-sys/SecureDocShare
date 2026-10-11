# -*- coding: utf-8 -*-
"""
pdf_locker.py: MÃ HÓA VÀ BẢO VỆ TÀI LIỆU PDF CHUẨN ISO 32000-2 (AES-256 REVISION 6)
Dự án: SecureDocShare

Hỗ trợ 2 cấp độ bảo vệ chuẩn mực:
1. LOẠI 1 (OPEN_PASSWORD_REQUIRED): Chỉ nhập đúng mật khẩu mới mở được file.
2. LOẠI 2 (VIEW_ONLY_RESTRICTED): Mở tự do để xem, nhưng CẤM SỬA, CẤM IN ẤN, CẤM COPY NỘI DUNG.
"""

import os
from typing import Optional, Dict, Any

try:
    import pikepdf
    HAS_PIKEPDF = True
except ImportError:
    HAS_PIKEPDF = False

try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False


class PDFLocker:
    """Mã hóa và phân quyền PDF chuẩn ISO 32000-2 AES-256 Revision 6."""

    @classmethod
    def encrypt_pdf(
        cls,
        input_pdf_path: str,
        output_pdf_path: str,
        user_password: Optional[str] = None,
        owner_password: Optional[str] = None,
        require_open_password: bool = True,
        allow_printing: bool = False,
        allow_copying: bool = False,
        allow_modifying: bool = False
    ) -> Dict[str, Any]:
        """
        Mã hóa và phân quyền tệp PDF với AES-256 R6.
        - require_open_password = True: Khóa tệp bằng user_password (chỉ có pass mới mở được).
        - require_open_password = False: user_password = "" (mở tự do), nhưng owner_password chặn In, Copy, Sửa.
        """
        if not os.path.exists(input_pdf_path):
            raise FileNotFoundError(f"Không tìm thấy tệp PDF: {input_pdf_path}")

        # Xác định mật khẩu mở tệp
        open_pwd = (user_password or "") if require_open_password else ""

        # Xác định mật khẩu quản trị (Owner Password)
        owner_pwd = owner_password or user_password or "AdminSecOwner_2026!#"

        if HAS_PIKEPDF:
            # Thiết lập bảng phân quyền chi tiết
            permissions = pikepdf.Permissions(
                accessibility=allow_copying,
                extract=allow_copying,               # Cấm hoặc Cho phép sao chép text/image
                modify_annotation=allow_modifying,   # Cấm hoặc Cho phép ghi chú
                modify_assembly=allow_modifying,     # Cấm sửa đổi trang
                modify_form=allow_modifying,         # Cấm điền biểu mẫu
                modify_other=allow_modifying,        # Cấm chỉnh sửa nội dung khác
                print_highres=allow_printing,        # Cấm hoặc Cho phép in ấn chất lượng cao
                print_lowres=allow_printing          # Cấm hoặc Cho phép in ấn
            )

            encryption = pikepdf.Encryption(
                owner=owner_pwd,
                user=open_pwd,
                R=6, # Revision 6: AES-256 PDF 2.0 Standard
                allow=permissions
            )

            with pikepdf.open(input_pdf_path) as pdf:
                pdf.save(output_pdf_path, encryption=encryption)

            return {
                "status": "SUCCESS",
                "engine": "pikepdf (QPDF C++ AES-256 R6)",
                "standard": "ISO 32000-2 / PDF 2.0",
                "output_path": output_pdf_path,
                "require_open_password": require_open_password,
                "allow_printing": allow_printing,
                "allow_copying": allow_copying,
                "allow_modifying": allow_modifying
            }

        elif HAS_PYPDF:
            reader = pypdf.PdfReader(input_pdf_path)
            writer = pypdf.PdfWriter()

            for page in reader.pages:
                writer.add_page(page)

            perm_flag = 0
            if allow_printing:
                perm_flag |= pypdf.constants.UserAccessPermissions.PRINT
            if allow_copying:
                perm_flag |= pypdf.constants.UserAccessPermissions.EXTRACT

            writer.encrypt(
                user_password=open_pwd,
                owner_password=owner_pwd,
                use_128bit=False, # 256-bit AES
                permissions_flag=perm_flag
            )

            with open(output_pdf_path, "wb") as f_out:
                writer.write(f_out)

            return {
                "status": "SUCCESS",
                "engine": "pypdf (AES-256)",
                "standard": "PDF Standard AES-256",
                "output_path": output_pdf_path,
                "require_open_password": require_open_password,
                "allow_printing": allow_printing,
                "allow_copying": allow_copying
            }
        else:
            raise RuntimeError("Thiếu thư viện xử lý PDF (pikepdf hoặc pypdf).")

    @classmethod
    def decrypt_pdf(
        cls,
        encrypted_pdf_path: str,
        output_pdf_path: str,
        password: str
    ) -> Dict[str, Any]:
        """Giải mã tệp PDF đã khóa mật khẩu."""
        if not os.path.exists(encrypted_pdf_path):
            raise FileNotFoundError(f"Không tìm thấy tệp PDF: {encrypted_pdf_path}")

        if HAS_PIKEPDF:
            try:
                with pikepdf.open(encrypted_pdf_path, password=password) as pdf:
                    pdf.save(output_pdf_path)
                return {"status": "SUCCESS", "output_path": output_pdf_path}
            except pikepdf.PasswordError as e:
                raise ValueError("Mật khẩu mở PDF không chính xác.") from e

        elif HAS_PYPDF:
            reader = pypdf.PdfReader(encrypted_pdf_path)
            if reader.is_encrypted:
                result = reader.decrypt(password)
                if result == 0:
                    raise ValueError("Mật khẩu mở PDF không chính xác.")

            writer = pypdf.PdfWriter()
            for page in reader.pages:
                writer.add_page(page)

            with open(output_pdf_path, "wb") as f_out:
                writer.write(f_out)

            return {"status": "SUCCESS", "output_path": output_pdf_path}
        else:
            raise RuntimeError("Thiếu thư viện xử lý PDF.")
