# -*- coding: utf-8 -*-
"""
app.py: ỨNG DỤNG WEB MÃ HÓA VÀ BẢO MẬT TÀI LIỆU CẤP QUÂN SỰ (SECUREDOCSHARE)
Dự án: SecureDocShare

Đặc điểm kỹ thuật:
- Framework: FastAPI + Uvicorn (Hiệu năng cực cao, phi trạng thái).
- Giao diện: HTML5 / CSS3 Cyber-Security hiện đại, kéo thả mượt mà, phản hồi tức thì.
- Bảo mật: AES-256-GCM, PBKDF2-HMAC-SHA512 (600.000 vòng lặp), ISO 32000-2 R6.
"""

import os
import uuid
import shutil
import zipfile
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from core.unified_locker import UnifiedLocker, ProtectionMode, ProtectionLevel

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
TEMP_STORAGE_DIR = os.path.join(BASE_DIR, "temp_downloads")

os.makedirs(TEMP_STORAGE_DIR, exist_ok=True)

app = FastAPI(
    title="SecureDocShare - Military-Grade Document Protection",
    version="2.0.0",
    description="Ứng dụng mã hóa và bảo vệ tài liệu PDF, Word, Excel, PPT truyền qua mạng không thể bẻ khóa"
)

# Phục vụ static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Từ điển lưu vết tệp tải xuống tạm thời: {download_id: {"filepath": ..., "filename": ...}}
DOWNLOAD_CACHE = {}


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    """Phục vụ trang chủ giao diện người dùng."""
    index_file = os.path.join(TEMPLATES_DIR, "index.html")
    with open(index_file, "r", encoding="utf-8") as f:
        return f.read()


@app.post("/api/lock")
async def api_lock_files(
    files: List[UploadFile] = File(...),
    password: str = Form(...),
    protection_level: str = Form("open_password"),
    mode: str = Form("native"),
    hint: Optional[str] = Form(""),
    allow_print: Optional[bool] = Form(False),
    allow_copy: Optional[bool] = Form(False)
):
    """
    API Mã Hóa và Phân Quyền Hàng Loạt Tệp Tin.
    """
    if not files or len(files) == 0:
        raise HTTPException(status_code=400, detail="Vui lòng chọn ít nhất 1 tệp tin.")

    if not password or not password.strip():
        raise HTTPException(status_code=400, detail="Mật khẩu không được để trống.")

    try:
        prot_mode = ProtectionMode(mode)
    except ValueError:
        prot_mode = ProtectionMode.NATIVE

    try:
        prot_level = ProtectionLevel(protection_level)
    except ValueError:
        prot_level = ProtectionLevel.OPEN_PASSWORD_REQUIRED

    session_id = str(uuid.uuid4())
    session_dir = os.path.join(TEMP_STORAGE_DIR, session_id)
    input_dir = os.path.join(session_dir, "input")
    output_dir = os.path.join(session_dir, "output")
    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    results = []
    output_paths = []

    try:
        # Lưu các file tải lên
        for upload_file in files:
            safe_filename = upload_file.filename
            file_path = os.path.join(input_dir, safe_filename)
            with open(file_path, "wb") as f_dst:
                shutil.copyfileobj(upload_file.file, f_dst)

            # Thực hiện mã hóa và phân quyền
            res = UnifiedLocker.lock_file(
                input_path=file_path,
                output_dir=output_dir,
                password=password,
                protection_level=prot_level,
                mode=prot_mode,
                hint_message=hint or "",
                allow_printing=allow_print if allow_print is not None else False,
                allow_copying=allow_copy if allow_copy is not None else False
            )

            dl_id = str(uuid.uuid4())
            DOWNLOAD_CACHE[dl_id] = {
                "filepath": res["output_path"],
                "filename": res["output_filename"]
            }

            res["download_id"] = dl_id
            results.append(res)
            output_paths.append(res["output_path"])

        # Nếu có từ 2 tệp trở lên, đóng gói thêm tệp ZIP trọn gói
        zip_dl_id = None
        if len(output_paths) > 1:
            zip_filename = f"SecureDocs_{session_id[:8]}.zip"
            zip_path = os.path.join(output_dir, zip_filename)
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
                for p in output_paths:
                    zipf.write(p, arcname=os.path.basename(p))

            zip_dl_id = str(uuid.uuid4())
            DOWNLOAD_CACHE[zip_dl_id] = {
                "filepath": zip_path,
                "filename": zip_filename
            }

        return {
            "status": "SUCCESS",
            "files": results,
            "zip_download_id": zip_dl_id
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi trong quá trình mã hóa: {str(e)}")


@app.post("/api/unlock")
async def api_unlock_file(
    file: UploadFile = File(...),
    password: str = Form(...)
):
    """
    API Mở Khóa và Giải Mã Tệp Tin.
    """
    if not file:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp tệp tin cần mở khóa.")
    if not password:
        raise HTTPException(status_code=400, detail="Vui lòng nhập mật khẩu giải mã.")

    session_id = str(uuid.uuid4())
    session_dir = os.path.join(TEMP_STORAGE_DIR, session_id)
    input_dir = os.path.join(session_dir, "input")
    output_dir = os.path.join(session_dir, "output")
    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    try:
        input_path = os.path.join(input_dir, file.filename)
        with open(input_path, "wb") as f_dst:
            shutil.copyfileobj(file.file, f_dst)

        # Mở khóa tệp
        res = UnifiedLocker.unlock_file(
            encrypted_path=input_path,
            output_dir=output_dir,
            password=password
        )

        dl_id = str(uuid.uuid4())
        DOWNLOAD_CACHE[dl_id] = {
            "filepath": res["output_path"],
            "filename": res["unlocked_filename"]
        }
        res["download_id"] = dl_id
        return res

    except ValueError as ve:
        raise HTTPException(status_code=401, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi giải mã: {str(e)}")


@app.get("/api/download")
async def api_download_file(file_id: str):
    """Tải tệp tin kết quả về máy người dùng."""
    item = DOWNLOAD_CACHE.get(file_id)
    if not item or not os.path.exists(item["filepath"]):
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp hoặc tệp đã hết hạn.")

    return FileResponse(
        path=item["filepath"],
        filename=item["filename"],
        media_type="application/octet-stream"
    )
