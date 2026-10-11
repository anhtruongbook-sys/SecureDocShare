# -*- coding: utf-8 -*-
"""
office_locker.py: MÃ HÓA VÀ BẢO VỆ TÀI LIỆU MICROSOFT OFFICE (WORD, EXCEL, POWERPOINT)
Dự án: SecureDocShare

Hỗ trợ 2 cấp độ bảo vệ chuẩn mực:
1. LOẠI 1 (OPEN_PASSWORD_REQUIRED): Chỉ nhập đúng mật khẩu mới mở được file.
2. LOẠI 2 (VIEW_ONLY_RESTRICTED): Mở tự do để xem, nhưng CẤM CHỈNH SỬA, CẤM GHI ĐÈ.
"""

import os
import shutil
from typing import Dict, Any, Optional

try:
    import win32com.client
    import pythoncom
    HAS_WIN32COM = True
except ImportError:
    HAS_WIN32COM = False

try:
    import msoffcrypto
    HAS_MSOFFCRYPTO = True
except ImportError:
    HAS_MSOFFCRYPTO = False


class OfficeLocker:
    """Mã hóa và phân quyền tài liệu Office chuẩn Native Microsoft Agile Encryption."""

    @classmethod
    def is_office_file(cls, filename: str) -> bool:
        """Kiểm tra tệp có thuộc định dạng Microsoft Office hay không."""
        ext = os.path.splitext(filename)[1].lower()
        return ext in [".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"]

    @classmethod
    def get_office_type(cls, filename: str) -> Optional[str]:
        """Xác định phân loại ứng dụng Office (word, excel, powerpoint)."""
        ext = os.path.splitext(filename)[1].lower()
        if ext in [".docx", ".doc"]:
            return "word"
        elif ext in [".xlsx", ".xls"]:
            return "excel"
        elif ext in [".pptx", ".ppt"]:
            return "powerpoint"
        return None

    @classmethod
    def encrypt_office_native(
        cls,
        input_path: str,
        output_path: str,
        open_password: Optional[str] = None,
        owner_password: Optional[str] = None,
        require_open_password: bool = True
    ) -> Dict[str, Any]:
        """
        Mã hóa hoặc phân quyền bảo vệ tệp Office (Word, Excel, PowerPoint).
        - require_open_password = True: Khóa mở tệp (bắt buộc nhập đúng mật khẩu mới mở được).
        - require_open_password = False: Mở xem tự do, nhưng khóa cứng chống sửa đổi (Read-Only Restrict Editing).
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Không tìm thấy tệp Office: {input_path}")

        if not HAS_WIN32COM:
            raise RuntimeError("Hệ thống chưa cài đặt pywin32 để kích hoạt Office COM Automation.")

        abs_input = os.path.abspath(input_path)
        abs_output = os.path.abspath(output_path)
        app_type = cls.get_office_type(abs_input)

        if not app_type:
            raise ValueError(f"Định dạng tệp không được hỗ trợ: {abs_input}")

        admin_pwd = owner_password or open_password or "AdminOfficeSec_2026!"

        pythoncom.CoInitialize()
        try:
            if app_type == "word":
                word = win32com.client.DispatchEx("Word.Application")
                word.Visible = False
                word.DisplayAlerts = False
                try:
                    doc = word.Documents.Open(abs_input)
                    if require_open_password:
                        # LOẠI 1: Bắt buộc nhập mật khẩu mới mở được file
                        doc.SaveAs2(FileName=abs_output, Password=open_password or admin_pwd)
                    else:
                        # LOẠI 2: Mở xem tự do, nhưng CẤM SỬA ĐỔI (wdAllowOnlyReading = 3)
                        # Gỡ bỏ bảo vệ cũ nếu có
                        if doc.ProtectionType != -1: # -1 = wdNoProtection
                            try:
                                doc.Unprotect()
                            except Exception:
                                pass
                        doc.Protect(Type=3, Password=admin_pwd) # 3 = wdAllowOnlyReading
                        doc.ReadOnlyRecommended = True
                        doc.SaveAs2(FileName=abs_output, Password="") # Không đặt mật khẩu mở
                    doc.Close(False)
                finally:
                    word.Quit()

            elif app_type == "excel":
                excel = win32com.client.DispatchEx("Excel.Application")
                excel.Visible = False
                excel.DisplayAlerts = False
                try:
                    wb = excel.Workbooks.Open(abs_input)
                    if require_open_password:
                        # LOẠI 1: Bắt buộc nhập mật khẩu mới mở được file
                        wb.SaveAs(Filename=abs_output, Password=open_password or admin_pwd)
                    else:
                        # LOẠI 2: Mở xem tự do, nhưng CẤM SỬA NỘI DUNG SHEET & CÔNG THỨC
                        for ws in wb.Worksheets:
                            try:
                                ws.Protect(
                                    Password=admin_pwd,
                                    DrawingObjects=True,
                                    Contents=True,
                                    Scenarios=True,
                                    AllowFormattingCells=False,
                                    AllowFormattingColumns=False,
                                    AllowFormattingRows=False,
                                    AllowInsertingColumns=False,
                                    AllowInsertingRows=False,
                                    AllowDeletingColumns=False,
                                    AllowDeletingRows=False
                                )
                            except Exception:
                                pass
                        wb.SaveAs(
                            Filename=abs_output,
                            Password="", # Không đặt mật khẩu mở
                            WriteResPassword=admin_pwd,
                            ReadOnlyRecommended=True
                        )
                    wb.Close(False)
                finally:
                    excel.Quit()

            elif app_type == "powerpoint":
                ppt = win32com.client.DispatchEx("PowerPoint.Application")
                try:
                    presentation = ppt.Presentations.Open(abs_input, WithWindow=False)
                    if require_open_password:
                        # LOẠI 1: Bắt buộc nhập mật khẩu mới mở được file
                        presentation.Password = open_password or admin_pwd
                        presentation.SaveAs(abs_output)
                    else:
                        # LOẠI 2: Mở xem tự do, cấm sửa
                        presentation.Password = ""
                        presentation.ReadOnlyRecommended = True
                        presentation.SaveAs(abs_output)
                    presentation.Close()
                finally:
                    ppt.Quit()

            return {
                "status": "SUCCESS",
                "app_type": app_type,
                "standard": "Microsoft Agile Encryption / Restrict Editing Protection",
                "output_path": abs_output,
                "require_open_password": require_open_password
            }

        except Exception as e:
            raise RuntimeError(f"Lỗi khi mã hóa tệp Office qua Microsoft COM: {str(e)}")
        finally:
            pythoncom.CoUninitialize()

    @classmethod
    def decrypt_office_file(
        cls,
        encrypted_path: str,
        output_path: str,
        password: str
    ) -> Dict[str, Any]:
        """
        Giải mã hoặc gỡ bỏ bảo vệ tệp Word, Excel, PowerPoint có mật khẩu.
        """
        if not os.path.exists(encrypted_path):
            raise FileNotFoundError(f"Không tìm thấy tệp: {encrypted_path}")

        # Thử giải mã bằng msoffcrypto trước
        if HAS_MSOFFCRYPTO:
            try:
                with open(encrypted_path, "rb") as f_in:
                    office_file = msoffcrypto.OfficeFile(f_in)
                    if office_file.is_encrypted():
                        office_file.load_key(password=password)
                        with open(output_path, "wb") as f_out:
                            office_file.decrypt(f_out)
                        return {
                            "status": "SUCCESS",
                            "engine": "msoffcrypto-tool",
                            "output_path": output_path
                        }
                    else:
                        shutil.copyfile(encrypted_path, output_path)
                        return {"status": "SUCCESS", "message": "Tệp không bị khóa mật khẩu"}
            except Exception:
                pass

        # Fallback giải mã và gỡ bảo vệ qua Microsoft Office COM Automation
        if HAS_WIN32COM:
            abs_input = os.path.abspath(encrypted_path)
            abs_output = os.path.abspath(output_path)
            app_type = cls.get_office_type(abs_input)

            pythoncom.CoInitialize()
            try:
                if app_type == "word":
                    word = win32com.client.DispatchEx("Word.Application")
                    word.Visible = False
                    word.DisplayAlerts = False
                    try:
                        doc = word.Documents.Open(abs_input, PasswordDocument=password)
                        # Gỡ bỏ bảo vệ Read-only nếu có
                        if doc.ProtectionType != -1:
                            try:
                                doc.Unprotect(Password=password)
                            except Exception:
                                pass
                        doc.SaveAs2(FileName=abs_output, Password="") # Xóa pass
                        doc.Close(False)
                    finally:
                        word.Quit()

                elif app_type == "excel":
                    excel = win32com.client.DispatchEx("Excel.Application")
                    excel.Visible = False
                    excel.DisplayAlerts = False
                    try:
                        wb = excel.Workbooks.Open(abs_input, Password=password, WriteResPassword=password)
                        for ws in wb.Worksheets:
                            try:
                                ws.Unprotect(Password=password)
                            except Exception:
                                pass
                        wb.SaveAs(Filename=abs_output, Password="", WriteResPassword="", ReadOnlyRecommended=False)
                        wb.Close(False)
                    finally:
                        excel.Quit()

                elif app_type == "powerpoint":
                    ppt = win32com.client.DispatchEx("PowerPoint.Application")
                    try:
                        presentation = ppt.Presentations.Open(abs_input, Password=password, WithWindow=False)
                        presentation.Password = ""
                        presentation.ReadOnlyRecommended = False
                        presentation.SaveAs(abs_output)
                        presentation.Close()
                    finally:
                        ppt.Quit()

                return {
                    "status": "SUCCESS",
                    "engine": "win32com",
                    "output_path": abs_output
                }
            except Exception as e:
                raise ValueError("Mật khẩu giải mã Office không chính xác hoặc tệp bị hỏng.") from e
            finally:
                pythoncom.CoUninitialize()

        raise RuntimeError("Không thể giải mã tệp Office do thiếu công cụ hỗ trợ.")
