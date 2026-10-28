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
from core.hsm_signature import (
    HandwrittenSignatureProcessor,
    KryptoHSMVault,
    TOTPAuthenticator,
    PDFPAdESHSMSigner,
    SMIMEEmailWorkflowEngine,
)
from core.authenticator import (
    AuthenticatorAccount,
    Base32Codec,
    EncryptedAuthenticatorVault,
    GoogleAuthMigrationCodec,
    HOTPEngine,
    OCRAEngine,
    TOTPEngine,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
TEMP_STORAGE_DIR = os.path.join(BASE_DIR, "temp_downloads")
HSM_VAULT_STORAGE_PATH = os.path.join(BASE_DIR, "temp_downloads", "krypto_personal_hsm_vault.json")

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


# =========================================================================
# CÁC API CHỮ KÝ SỐ CÁ NHÂN CHUẨN HSM (PKCS#11 + PNG + PAdES + S/MIME + DI TRÚ)
# =========================================================================

@app.post("/api/hsm/process-signature-png")
async def api_hsm_process_signature_png(
    file: Optional[UploadFile] = File(None),
    signer_name: str = Form("TS. Nguyễn Hoàng Anh"),
    ink_preset: str = Form("administrative_blue")
):
    """Tách nền trong suốt 100%, khử bóng giấy và chuẩn hóa màu mực (#003399) cho ảnh chữ ký tay."""
    try:
        if file and file.filename:
            raw_bytes = await file.read()
            res = HandwrittenSignatureProcessor.process_raw_signature_image(
                image_input=raw_bytes,
                ink_preset=ink_preset,
            )
        else:
            res = HandwrittenSignatureProcessor.generate_stylized_handwritten_signature(
                signer_name=signer_name,
                ink_preset=ink_preset,
            )
        return {
            "status": "SUCCESS",
            "base64_data_url": res["base64_data_url"],
            "sha256_hash": res["sha256_hash"],
            "width": res["width"],
            "height": res["height"],
            "ink_hex": res["ink_hex"],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Lỗi xử lý ảnh chữ ký tay: {str(e)}")


@app.post("/api/hsm/provision")
async def api_hsm_provision_slot(
    signer_name: str = Form(...),
    signer_email: str = Form(...),
    signer_title: str = Form("Chuyên gia"),
    organization: str = Form("Krypto Security"),
    org_unit: str = Form("Phòng Kỹ thuật"),
    personal_id_cccd: str = Form("VN-HSM-001"),
    user_pin: str = Form(...),
    so_pin: str = Form("AdminPUK@2026"),
    ink_preset: str = Form("administrative_blue"),
    require_totp: bool = Form(False),
    signature_png: Optional[UploadFile] = File(None)
):
    """Khởi tạo Buồng HSM Cá nhân chuẩn PKCS#11 + Cấp phát Chứng thư X.509v3 gắn Ảnh chữ ký tay .PNG & Email S/MIME."""
    try:
        if signature_png and signature_png.filename:
            raw_png = await signature_png.read()
            sig_info = HandwrittenSignatureProcessor.process_raw_signature_image(raw_png, ink_preset=ink_preset)
        else:
            sig_info = HandwrittenSignatureProcessor.generate_stylized_handwritten_signature(
                signer_name=signer_name, ink_preset=ink_preset
            )

        vault = KryptoHSMVault(HSM_VAULT_STORAGE_PATH)
        prov = vault.provision_personal_hsm_slot(
            signer_name=signer_name,
            signer_email=signer_email,
            signer_title=signer_title,
            organization=organization,
            org_unit=org_unit,
            personal_id_cccd=personal_id_cccd,
            user_pin=user_pin,
            so_pin=so_pin,
            handwritten_png_bytes=sig_info["png_bytes"],
            require_totp_for_signing=require_totp,
        )
        creds = vault.get_public_credentials_and_png()
        return {
            "status": "SUCCESS",
            "slot_id": prov["slot_id"],
            "serial_hex": prov["serial_hex"],
            "root_serial_hex": prov["root_serial_hex"],
            "signer_name": prov["signer_name"],
            "signer_email": prov["signer_email"],
            "visual_sig_png_sha256": prov["visual_sig_png_sha256"],
            "handwritten_png_data_url": "data:image/png;base64," + creds["handwritten_png_b64"],
            "totp_secret": prov["totp_secret"],
            "totp_uri": prov["totp_uri"],
            "current_totp_code": prov["current_totp_code"],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Lỗi khởi tạo Buồng HSM: {str(e)}")


@app.post("/api/hsm/sign-pdf")
async def api_hsm_sign_pdf(
    file: UploadFile = File(...),
    user_pin: str = Form(...),
    totp_code: Optional[str] = Form(None),
    signing_reason: str = Form("Phê duyệt & Ký số phát hành hồ sơ"),
    signing_location: str = Form("Hà Nội, Việt Nam"),
    page_position: str = Form("last_page"),
    send_email_receipt: bool = Form(True)
):
    """Ký số PDF chuẩn PAdES-HSM (chỉ truyền 32 bytes mã băm vào HSM) và xuất kèm gói Email S/MIME (.eml)."""
    if not os.path.exists(HSM_VAULT_STORAGE_PATH):
        raise HTTPException(status_code=400, detail="Chưa khởi tạo Buồng HSM Cá nhân! Vui lòng khởi tạo trong Tab Két sắt.")

    session_id = str(uuid.uuid4())
    session_dir = os.path.join(TEMP_STORAGE_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)

    in_path = os.path.join(session_dir, file.filename)
    base_name = os.path.splitext(file.filename)[0]
    out_pdf_name = f"{base_name}_Signed_PAdES_HSM.pdf"
    out_pdf_path = os.path.join(session_dir, out_pdf_name)

    with open(in_path, "wb") as f_dst:
        shutil.copyfileobj(file.file, f_dst)

    try:
        vault = KryptoHSMVault(HSM_VAULT_STORAGE_PATH)
        sign_res = PDFPAdESHSMSigner.sign_pdf_file(
            input_pdf_path=in_path,
            output_pdf_path=out_pdf_path,
            vault=vault,
            user_pin=user_pin,
            totp_code=totp_code,
            signing_reason=signing_reason,
            signing_location=signing_location,
            page_position=page_position,
        )

        pdf_dl_id = str(uuid.uuid4())
        DOWNLOAD_CACHE[pdf_dl_id] = {"filepath": out_pdf_path, "filename": out_pdf_name}

        eml_dl_id = None
        if send_email_receipt:
            eml_name = f"{base_name}_Ket_Qua_Ky_So_SMIME.eml"
            eml_path = os.path.join(session_dir, eml_name)
            SMIMEEmailWorkflowEngine.create_signed_result_delivery_email(
                signing_result=sign_res,
                vault=vault,
                user_pin=user_pin,
                totp_code=totp_code,
                output_eml_path=eml_path,
            )
            eml_dl_id = str(uuid.uuid4())
            DOWNLOAD_CACHE[eml_dl_id] = {"filepath": eml_path, "filename": eml_name}

        return {
            "status": "SUCCESS",
            "signed_pdf_download_id": pdf_dl_id,
            "smime_eml_download_id": eml_dl_id,
            "signing_details": sign_res,
        }
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi ký số PAdES-HSM: {str(e)}")


@app.post("/api/hsm/export-migration")
async def api_hsm_export_migration(
    user_pin: str = Form(...),
    master_recovery_passphrase: str = Form(...),
    totp_code: Optional[str] = Form(None)
):
    """Xuất tệp Két sắt Di trú .kryptohsm (PKCS#11 C_WrapKey) để đổi Điện thoại và đổi PC."""
    if not os.path.exists(HSM_VAULT_STORAGE_PATH):
        raise HTTPException(status_code=400, detail="Chưa có Buồng HSM để xuất!")
    try:
        vault = KryptoHSMVault(HSM_VAULT_STORAGE_PATH)
        out_name = f"Krypto_HSM_Migration_{vault.state['slot_id']}.kryptohsm"
        out_path = os.path.join(TEMP_STORAGE_DIR, out_name)
        res = vault.export_migration_bundle(
            user_pin=user_pin,
            master_recovery_passphrase=master_recovery_passphrase,
            output_bundle_path=out_path,
            totp_code=totp_code,
        )
        dl_id = str(uuid.uuid4())
        DOWNLOAD_CACHE[dl_id] = {"filepath": out_path, "filename": out_name}
        return {
            "status": "SUCCESS",
            "download_id": dl_id,
            "filename": out_name,
            "bundle_sha256": res["bundle_sha256"],
            "serial_hex": res["serial_hex"],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/hsm/import-migration")
async def api_hsm_import_migration(
    bundle_file: UploadFile = File(...),
    master_recovery_passphrase: str = Form(...)
):
    """Khôi phục Buồng HSM + Chứng thư số + Ảnh chữ ký tay .PNG sang PC mới / Điện thoại mới (PKCS#11 C_UnwrapKey)."""
    try:
        raw_bytes = await bundle_file.read()
        vault = KryptoHSMVault.import_migration_bundle_to_new_device(
            bundle_input=raw_bytes,
            master_recovery_passphrase=master_recovery_passphrase,
            new_device_vault_path=HSM_VAULT_STORAGE_PATH,
        )
        creds = vault.get_public_credentials_and_png()
        return {
            "status": "SUCCESS",
            "slot_id": creds["slot_id"],
            "signer_name": creds["signer_name"],
            "signer_email": creds["signer_email"],
            "serial_hex": creds["serial_hex"],
            "visual_sig_png_sha256": creds["visual_sig_png_sha256"],
            "handwritten_png_data_url": "data:image/png;base64," + creds["handwritten_png_b64"],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =========================================================================
# CÁC API BỘ XÁC THỰC KRYPTO AUTHENTICATOR (HOTP / TOTP / OCRA / GOOGLE AUTH)
# =========================================================================

@app.post("/api/authenticator/generate")
async def api_authenticator_generate(
    secret: str = Form(...),
    otp_type: str = Form("totp"),
    algorithm: str = Form("SHA1"),
    digits: int = Form(6),
    period: int = Form(30),
    counter: int = Form(0),
    timestamp: Optional[float] = Form(None),
    ocra_recipient: Optional[str] = Form(None),
    ocra_amount: Optional[str] = Form(None),
    ocra_reference: Optional[str] = Form(None),
):
    """Sinh mã xác thực TOTP (RFC 6238), HOTP (RFC 4226) hoặc OCRA (RFC 6287) kèm vết giải phẫu byte."""
    try:
        kind = otp_type.strip().lower()
        if kind == "ocra":
            res = OCRAEngine.generate_transaction_otp(
                secret_b32_or_bytes=secret,
                recipient=ocra_recipient or "",
                amount=ocra_amount or "",
                reference=ocra_reference or "",
                timestamp=timestamp,
                period=period,
                digits=digits if digits in (6, 7, 8) else 8,
            )
            return {"status": "SUCCESS", "mode": "ocra", "result": res}
        elif kind == "hotp":
            secret_bytes = Base32Codec.decode(secret)
            trace = HOTPEngine.compute_with_trace(
                secret_bytes=secret_bytes,
                counter=counter,
                digits=digits,
                algorithm=algorithm,
            )
            return {"status": "SUCCESS", "mode": "hotp", "otp": trace.otp, "trace": trace.__dict__}
        else:
            res = TOTPEngine.compute_with_trace(
                secret_b32_or_bytes=secret,
                timestamp=timestamp,
                period=period,
                digits=digits,
                algorithm=algorithm,
            )
            return {"status": "SUCCESS", "mode": "totp", **res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/authenticator/verify")
async def api_authenticator_verify(
    secret: str = Form(...),
    candidate_otp: str = Form(...),
    algorithm: str = Form("SHA1"),
    digits: int = Form(6),
    period: int = Form(30),
    window: int = Form(1),
    timestamp: Optional[float] = Form(None),
):
    """Kiểm tra mã TOTP với cửa sổ dung sai lệch đồng hồ [-window, +window]."""
    try:
        is_valid, delta = TOTPEngine.verify(
            secret_b32_or_bytes=secret,
            candidate_otp=candidate_otp,
            timestamp=timestamp,
            period=period,
            digits=digits,
            algorithm=algorithm,
            window=window,
        )
        return {
            "status": "SUCCESS",
            "valid": is_valid,
            "matched_step_delta": delta,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/authenticator/migration/decode")
async def api_authenticator_migration_decode(
    uri: str = Form(...),
):
    """Giải mã chuỗi otpauth:// hoặc chuỗi chuyển vùng Google Authenticator (otpauth-migration://offline?data=...)."""
    try:
        cleaned = uri.strip()
        if cleaned.lower().startswith("otpauth-migration://"):
            accounts = GoogleAuthMigrationCodec.decode_migration_uri(cleaned)
            return {
                "status": "SUCCESS",
                "source": "google_authenticator_migration",
                "count": len(accounts),
                "accounts": [a.__dict__ for a in accounts],
            }
        else:
            acc = AuthenticatorAccount.from_otpauth_uri(cleaned)
            return {
                "status": "SUCCESS",
                "source": "otpauth_uri",
                "count": 1,
                "accounts": [acc.__dict__],
            }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


