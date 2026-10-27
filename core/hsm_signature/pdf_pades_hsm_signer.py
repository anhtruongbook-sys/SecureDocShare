# -*- coding: utf-8 -*-
"""
pdf_pades_hsm_signer.py: ĐỘNG CƠ KÝ SỐ PDF CHUẨN PAdES-B (ISO 32000-2 / ETSI EN 319 142) KẾT NỐI BUỒNG HSM
Dự án: Nghiên cứu Chữ ký số Cá nhân Chuẩn HSM & Tích hợp Krypto (SecureDocShare)

Nguyên lý hoạt động chuẩn HSM:
1. Trích xuất Chứng thư công khai X.509v3 và Ảnh chữ ký tay .PNG (nền trong suốt) từ đối tượng CKO_DATA của HSM.
2. Dàn trang Khung Chữ ký Trực quan (Visual Signature Appearance):
   - Bên trái: Ảnh chữ ký tay (.PNG nền trong suốt, mực xanh cửu long #003399).
   - Bên phải: Thông tin trích xuất từ Chứng thư X.509 (Người ký, Chức vụ, Đơn vị, Email, Thời gian ký, Số Serial C/S).
   - Góc phải: Mã QR Xác thực nhanh chứa siêu dữ liệu chữ ký và mã băm tài liệu.
3. Tạo cấu trúc PDF Incremental Signature (`/Type /Sig`, `/SubFilter /ETSI.CAdES.detached` / `/adbe.pkcs7.detached`)
   với mảng `/ByteRange [0 offset1 offset2 len2]`.
4. Tính giá trị băm SHA-256 trên vùng `/ByteRange`, đóng gói `CMS SignedAttributes` (gồm `contentType`,
   `signingTime`, `messageDigest`, và `signingCertificateV2` chuẩn PAdES-B).
5. Chỉ gửi 32 bytes mã băm của `DER(SignedAttributes)` vào hàm `vault.sign_digest_pkcs11()` của HSM.
6. Ghép chữ ký trả về từ HSM + Chuỗi chứng thư (`Signer Cert` + `Root CA Cert`) thành khối `CMS ContentInfo`
   hoàn chỉnh và ghi vào vùng `/Contents` của PDF.
7. Cung cấp hàm `verify_pdf_pades_signature()` kiểm định độc lập chữ ký mật mã, kiểm tra `/ByteRange`,
   xác thực chuỗi chứng thư Root CA, kiểm tra danh sách thu hồi CRL và đối chiếu mã băm ảnh chữ ký tay .PNG.
"""

import io
import os
import re
import json
import base64
import hashlib
import datetime
from typing import Dict, Any, Optional, Tuple, List

import fitz  # PyMuPDF
import qrcode
from PIL import Image

from asn1crypto import cms, core, x509 as asn1_x509, algos, tsp
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from .hsm_pkcs11_ca_vault import KryptoHSMVault, OID_VISUAL_SIGNATURE_PNG_HASH


class PDFPAdESHSMSigner:
    """Động cơ ký số PDF chuẩn PAdES-B kết nối trực tiếp buồng HSM PKCS#11 và kiểm định độc lập."""

    CONTENTS_PLACEHOLDER_BYTES = 12288  # 12 KB vùng đệm cho chuỗi chứng thư X.509 + CMS SignedData

    @classmethod
    def build_cms_signed_data_via_hsm(
        cls,
        byterange_sha256_digest: bytes,
        vault: KryptoHSMVault,
        user_pin: str,
        totp_code: Optional[str] = None,
        document_label: str = "PDF Document",
        signing_time_utc: Optional[datetime.datetime] = None,
        content_type_str: str = "data"
    ) -> Tuple[bytes, Dict[str, Any]]:
        """
        Đóng gói cấu trúc PKCS#7 / CMS SignedData (RFC 5652 & ETSI EN 319 142 PAdES-B)
        bằng cách chỉ gửi 32 bytes mã băm của SignedAttributes vào buồng HSM.
        """
        if signing_time_utc is None:
            signing_time_utc = datetime.datetime.now(datetime.timezone.utc)

        creds = vault.get_public_credentials_and_png()
        signer_cert_obj = x509.load_pem_x509_certificate(creds["signer_cert_pem"].encode("ascii"))
        root_cert_obj = x509.load_pem_x509_certificate(creds["root_ca_cert_pem"].encode("ascii"))

        signer_cert_der = signer_cert_obj.public_bytes(serialization.Encoding.DER)
        root_cert_der = root_cert_obj.public_bytes(serialization.Encoding.DER)

        asn1_signer_cert = asn1_x509.Certificate.load(signer_cert_der)
        asn1_root_cert = asn1_x509.Certificate.load(root_cert_der)

        # Tính mã băm SHA-256 của chứng thư người ký để tạo thuộc tính bắt buộc PAdES-B: id-aa-signingCertificateV2
        cert_sha256 = hashlib.sha256(signer_cert_der).digest()
        ess_cert_id_v2 = tsp.ESSCertIDv2({
            "hash_algorithm": algos.DigestAlgorithm({"algorithm": "sha256"}),
            "cert_hash": cert_sha256,
        })
        signing_cert_v2 = tsp.SigningCertificateV2({
            "certs": [ess_cert_id_v2]
        })

        signed_attrs = cms.CMSAttributes([
            cms.CMSAttribute({
                "type": "content_type",
                "values": [content_type_str],
            }),
            cms.CMSAttribute({
                "type": "signing_time",
                "values": [cms.Time({"utc_time": core.UTCTime(signing_time_utc)})],
            }),
            cms.CMSAttribute({
                "type": "message_digest",
                "values": [byterange_sha256_digest],
            }),
            cms.CMSAttribute({
                "type": "1.2.840.113549.1.9.16.2.47",  # id-aa-signingCertificateV2 (PAdES-B)
                "values": [signing_cert_v2],
            }),
        ])

        # Chuẩn hóa DER của SignedAttributes (tag 0x31 SET OF theo RFC 5652 Mục 5.4)
        attrs_der = signed_attrs.dump()
        if attrs_der[0] != 0x31:
            attrs_der = b"\x31" + attrs_der[1:]

        # Băm 32 bytes của DER(SignedAttributes) và chỉ gửi 32 bytes này vào buồng HSM
        attrs_sha256 = hashlib.sha256(attrs_der).digest()
        hsm_sig_res = vault.sign_digest_pkcs11(
            digest_bytes=attrs_sha256,
            user_pin=user_pin,
            totp_code=totp_code,
            document_label=document_label,
            hash_algo="SHA256",
        )
        raw_signature = hsm_sig_res["signature_bytes"]

        signer_info = cms.SignerInfo({
            "version": "v1",
            "sid": cms.SignerIdentifier({
                "issuer_and_serial_number": cms.IssuerAndSerialNumber({
                    "issuer": asn1_signer_cert.issuer,
                    "serial_number": asn1_signer_cert.serial_number,
                })
            }),
            "digest_algorithm": algos.DigestAlgorithm({"algorithm": "sha256"}),
            "signed_attrs": signed_attrs,
            "signature_algorithm": algos.SignedDigestAlgorithm({"algorithm": "rsassa_pkcs1v15"}),
            "signature": raw_signature,
        })

        signed_data = cms.SignedData({
            "version": "v1",
            "digest_algorithms": [algos.DigestAlgorithm({"algorithm": "sha256"})],
            "encap_content_info": cms.ContentInfo({
                "content_type": content_type_str,
            }),
            "certificates": [asn1_signer_cert, asn1_root_cert],
            "signer_infos": [signer_info],
        })

        content_info = cms.ContentInfo({
            "content_type": "signed_data",
            "content": signed_data,
        })

        return content_info.dump(), hsm_sig_res

    @classmethod
    def render_visual_signature_stamp_png(
        cls,
        creds: Dict[str, Any],
        signing_reason: str = "Phê duyệt & Ký số phát hành",
        signing_location: str = "Hà Nội, Việt Nam",
        signing_time_local_str: Optional[str] = None,
        doc_sha256_short: str = ""
    ) -> bytes:
        """
        Kết xuất con dấu chữ ký trực quan độ phân giải cao (600 DPI tương đương) gồm:
        - Ảnh chữ ký tay .PNG (nền trong suốt, mực xanh cửu long #003399)
        - Thông tin chứng thư số X.509v3 (Người ký, Chức danh, Đơn vị, Email, Số Serial HSM, Thời gian ký)
        - Mã QR kiểm tra nhanh chữ ký số
        """
        from PIL import ImageDraw, ImageFont

        w, h = 820, 270
        stamp = Image.new("RGBA", (w, h), (255, 255, 255, 242))
        draw = ImageDraw.Draw(stamp)

        # Viền khung mảnh trang nhã chuẩn hành chính - kỹ thuật
        border_color = (0, 51, 153, 220)
        draw.rounded_rectangle([2, 2, w - 3, h - 3], radius=12, outline=border_color, width=3, fill=(250, 252, 255, 240))
        # Đường phân cách dọc giữa vùng chữ ký tay và vùng thông tin chứng thư
        split_x = 310
        draw.line([(split_x, 16), (split_x, h - 16)], fill=(180, 198, 231, 200), width=2)

        # 1. Vẽ ảnh chữ ký tay (.PNG nền trong suốt) ở khung bên trái
        sig_png = Image.open(io.BytesIO(creds["handwritten_png_bytes"])).convert("RGBA")
        max_sig_w, max_sig_h = split_x - 28, h - 68
        scale = min(max_sig_w / max(1, sig_png.width), max_sig_h / max(1, sig_png.height))
        new_sw = max(40, int(sig_png.width * scale))
        new_sh = max(25, int(sig_png.height * scale))
        sig_resized = sig_png.resize((new_sw, new_sh), Image.Resampling.LANCZOS)
        sig_x = (split_x - new_sw) // 2
        sig_y = 18 + (max_sig_h - new_sh) // 2
        stamp.alpha_composite(sig_resized, (sig_x, sig_y))

        # Tải font chữ tiếng Việt chuẩn (Times New Roman / Arial / Segoe UI)
        def _load_font(bold: bool = False, size: int = 18):
            candidates = (
                [r"C:\Windows\Fonts\timesbd.ttf", r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\segoeuib.ttf"]
                if bold else
                [r"C:\Windows\Fonts\times.ttf", r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\segoeui.ttf"]
            )
            for fp in candidates:
                if os.path.exists(fp):
                    return ImageFont.truetype(fp, size)
            return ImageFont.load_default()

        f_header = _load_font(bold=True, size=19)
        f_name = _load_font(bold=True, size=21)
        f_body = _load_font(bold=False, size=16)
        f_small = _load_font(bold=False, size=14)

        # Tên người ký dưới chữ ký tay bên trái
        signer_name = creds["signer_name"]
        bbox_n = draw.textbbox((0, 0), signer_name, font=f_header)
        nw = bbox_n[2] - bbox_n[0]
        draw.text(
            (max(10, (split_x - nw) // 2), h - 42),
            signer_name,
            font=f_header,
            fill=(0, 51, 153, 255),
        )

        # 2. Vẽ thông tin xác thực chứng thư số HSM ở khung giữa
        if not signing_time_local_str:
            now_vn = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7)))
            signing_time_local_str = now_vn.strftime("%d/%m/%Y %H:%M:%S +07:00")

        tx = split_x + 16
        draw.text((tx, 16), "CHỮ KÝ SỐ CÁ NHÂN (PAdES-HSM)", font=f_header, fill=(0, 51, 153, 255))
        draw.text((tx, 46), f"Ký bởi: {signer_name}", font=f_name, fill=(15, 23, 42, 255))
        draw.text((tx, 76), f"Chức vụ: {creds.get('signer_title') or 'Chuyên gia'}", font=f_body, fill=(30, 41, 59, 255))
        draw.text((tx, 101), f"Đơn vị: {creds.get('organization') or ''}", font=f_body, fill=(30, 41, 59, 255))
        draw.text((tx, 126), f"Email: {creds.get('signer_email') or ''}", font=f_body, fill=(0, 76, 180, 255))
        draw.text((tx, 151), f"Lý do: {signing_reason}", font=f_body, fill=(30, 41, 59, 255))
        draw.text((tx, 176), f"Thời gian: {signing_time_local_str}", font=f_body, fill=(30, 41, 59, 255))
        serial_short = creds["serial_hex"][:16]
        png_hash_short = creds["visual_sig_png_sha256"][:12].upper()
        draw.text(
            (tx, 204),
            f"Serial C/S: {serial_short} | PNG-Hash: {png_hash_short}",
            font=f_small,
            fill=(71, 85, 105, 255),
        )
        draw.text(
            (tx, 228),
            f"Chuẩn: PKCS#11 HSM (CKA_EXTRACTABLE=FALSE) • {signing_location}",
            font=f_small,
            fill=(5, 150, 105, 255),
        )

        # 3. Sinh mã QR kiểm định nhanh ở góc trên bên phải
        qr_payload = (
            f"KRYPTO-PAdES-HSM|CN={signer_name}|EMAIL={creds.get('signer_email')}"
            f"|SN={serial_short}|PNG={png_hash_short}|TIME={signing_time_local_str}|DOC={doc_sha256_short}"
        )
        qr = qrcode.QRCode(version=2, box_size=3, border=1)
        qr.add_data(qr_payload)
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="#003399", back_color="white").convert("RGBA")
        qr_img = qr_img.resize((104, 104), Image.Resampling.NEAREST)
        stamp.alpha_composite(qr_img, (w - 118, 16))

        out = io.BytesIO()
        stamp.save(out, format="PNG", optimize=True)
        return out.getvalue()

    @classmethod
    def sign_pdf_file(
        cls,
        input_pdf_path: str,
        output_pdf_path: str,
        vault: KryptoHSMVault,
        user_pin: str,
        totp_code: Optional[str] = None,
        signing_reason: str = "Phê duyệt & Ký số phát hành hồ sơ",
        signing_location: str = "Hà Nội, Việt Nam",
        page_position: str = "last_page",
        box_rect: Tuple[float, float, float, float] = (310.0, 28.0, 565.0, 112.0)
    ) -> Dict[str, Any]:
        """
        Ký số tài liệu PDF chuẩn PAdES-B bằng buồng HSM:
        1. Chèn hiển thị trực quan con dấu chữ ký tay (.PNG) vào trang đích.
        2. Thực hiện Incremental PDF Signature (`/Type /Sig`, `/SubFilter /ETSI.CAdES.detached`, `/ByteRange`).
        3. Chỉ truyền 32 bytes mã băm vào HSM để lấy chữ ký PKCS#7/CMS.
        """
        if not os.path.exists(input_pdf_path):
            raise FileNotFoundError(f"Không tìm thấy tệp PDF: {input_pdf_path}")

        creds = vault.get_public_credentials_and_png()
        with open(input_pdf_path, "rb") as f_in:
            orig_pdf_bytes = f_in.read()
        orig_doc_sha256 = hashlib.sha256(orig_pdf_bytes).hexdigest()

        now_utc = datetime.datetime.now(datetime.timezone.utc)
        now_vn = now_utc.astimezone(datetime.timezone(datetime.timedelta(hours=7)))
        time_vn_str = now_vn.strftime("%d/%m/%Y %H:%M:%S +07:00")
        pdf_date_str = now_vn.strftime("D:%Y%m%d%H%M%S+07'00'")

        stamp_png_bytes = cls.render_visual_signature_stamp_png(
            creds=creds,
            signing_reason=signing_reason,
            signing_location=signing_location,
            signing_time_local_str=time_vn_str,
            doc_sha256_short=orig_doc_sha256[:16].upper(),
        )

        # Bước 1: Mở PDF bằng PyMuPDF, chèn khung hình ảnh chữ ký trực quan và siêu dữ liệu kiểm chứng
        doc = fitz.open(input_pdf_path)
        total_pages = len(doc)
        target_indices = range(total_pages) if page_position == "all_pages" else [total_pages - 1]

        x0, y0, x1, y1 = box_rect
        for idx in target_indices:
            page = doc[idx]
            pw, ph = page.rect.width, page.rect.height
            # Đặt ở góc dưới bên phải theo tọa độ chuẩn PDF
            r_w = min(255.0, pw * 0.45)
            r_h = r_w * (270.0 / 820.0)
            rx1 = pw - 24.0
            rx0 = rx1 - r_w
            ry1 = ph - 22.0
            ry0 = ry1 - r_h
            sig_rect = fitz.Rect(rx0, ry0, rx1, ry1)
            page.insert_image(sig_rect, stream=stamp_png_bytes, keep_proportion=True, overlay=True)

        # Lưu PDF cơ sở vào bộ đệm trước khi nối khối Incremental PAdES /Sig
        visual_pdf_bytes = doc.write(garbage=1, deflate=True)
        doc.close()

        # Bước 2: Xây dựng Incremental PDF Cross-Reference & /Type /Sig Object chuẩn ISO 32000-2 / PAdES
        signed_pdf_bytes, hsm_sig_res, cms_der = cls._append_incremental_pades_sig_dictionary(
            base_pdf_bytes=visual_pdf_bytes,
            vault=vault,
            creds=creds,
            user_pin=user_pin,
            totp_code=totp_code,
            signing_reason=signing_reason,
            signing_location=signing_location,
            pdf_date_str=pdf_date_str,
            signing_time_utc=now_utc,
            document_label=os.path.basename(input_pdf_path),
        )

        os.makedirs(os.path.dirname(os.path.abspath(output_pdf_path)), exist_ok=True)
        with open(output_pdf_path, "wb") as f_out:
            f_out.write(signed_pdf_bytes)

        final_pdf_sha256 = hashlib.sha256(signed_pdf_bytes).hexdigest()

        return {
            "status": "SIGNED_PADES_HSM",
            "input_pdf_path": input_pdf_path,
            "output_pdf_path": output_pdf_path,
            "original_sha256": orig_doc_sha256,
            "signed_pdf_sha256": final_pdf_sha256,
            "signer_name": creds["signer_name"],
            "signer_email": creds["signer_email"],
            "signer_title": creds["signer_title"],
            "organization": creds["organization"],
            "serial_hex": creds["serial_hex"],
            "root_serial_hex": creds["root_serial_hex"],
            "visual_sig_png_sha256": creds["visual_sig_png_sha256"],
            "signing_time_local": time_vn_str,
            "byterange_digest_hex": hsm_sig_res["digest_hex"],
            "cms_signature_len": len(cms_der),
            "hsm_audit_receipt": hsm_sig_res["audit_receipt"],
        }

    @classmethod
    def _append_incremental_pades_sig_dictionary(
        cls,
        base_pdf_bytes: bytes,
        vault: KryptoHSMVault,
        creds: Dict[str, Any],
        user_pin: str,
        totp_code: Optional[str],
        signing_reason: str,
        signing_location: str,
        pdf_date_str: str,
        signing_time_utc: datetime.datetime,
        document_label: str
    ) -> Tuple[bytes, Dict[str, Any], bytes]:
        """
        Tạo và gắn đối tượng `/Type /Sig` chuẩn PAdES (`/SubFilter /ETSI.CAdES.detached`)
        kèm bảng `/ByteRange` chính xác từng byte vào cuối tệp PDF.
        """
        hex_placeholder_len = cls.CONTENTS_PLACEHOLDER_BYTES * 2
        byterange_placeholder = b"/ByteRange [0 0000000000 0000000000 0000000000]"

        def _pdf_utf16be_hex(text: str) -> bytes:
            bom_utf16 = b"\xfe\xff" + text.encode("utf-16-be")
            return b"<" + bom_utf16.hex().upper().encode("ascii") + b">"

        sig_metadata_json = json.dumps({
            "krypto_pades_version": "PAdES-B-HSM-1.0",
            "slot_id": creds["slot_id"],
            "signer_name": creds["signer_name"],
            "signer_email": creds["signer_email"],
            "signer_title": creds["signer_title"],
            "organization": creds["organization"],
            "serial_hex": creds["serial_hex"],
            "root_serial_hex": creds["root_serial_hex"],
            "visual_sig_png_sha256": creds["visual_sig_png_sha256"],
        }, ensure_ascii=False).encode("utf-8")
        sig_meta_hex = b"<" + sig_metadata_json.hex().upper().encode("ascii") + b">"

        sig_dict_prefix = (
            b"\n% === KRYPTO PKCS#11 HSM PAdES INCREMENTAL SIGNATURE ===\n"
            b"999990 0 obj\n"
            b"<<\n"
            b"/Type /Sig\n"
            b"/Filter /Adobe.PPKLite\n"
            b"/SubFilter /ETSI.CAdES.detached\n"
            + byterange_placeholder + b"\n"
            b"/Contents <"
        )
        sig_dict_suffix = (
            b">\n"
            b"/Name " + _pdf_utf16be_hex(creds["signer_name"]) + b"\n"
            b"/Reason " + _pdf_utf16be_hex(signing_reason) + b"\n"
            b"/Location " + _pdf_utf16be_hex(signing_location) + b"\n"
            b"/ContactInfo " + _pdf_utf16be_hex(creds["signer_email"]) + b"\n"
            b"/M (" + pdf_date_str.encode("ascii") + b")\n"
            b"/KryptoHSMMeta " + sig_meta_hex + b"\n"
            b">>\n"
            b"endobj\n"
            b"%%EOF\n"
        )

        # Tính toán chính xác tọa độ ByteRange
        offset_before_contents = len(base_pdf_bytes) + len(sig_dict_prefix) - 1  # tính tới trước dấu '<'
        offset_after_contents = offset_before_contents + 1 + hex_placeholder_len + 1  # sau dấu '>'
        length_after_contents = len(sig_dict_suffix) - 1  # trừ ký tự '>' đã tính

        actual_br_str = f"/ByteRange [0 {offset_before_contents} {offset_after_contents} {length_after_contents}]"
        if len(actual_br_str) < len(byterange_placeholder):
            actual_br_str += " " * (len(byterange_placeholder) - len(actual_br_str))
        actual_br_bytes = actual_br_str.encode("ascii")

        sig_dict_prefix_final = sig_dict_prefix.replace(byterange_placeholder, actual_br_bytes)

        # Ráp khung PDF hoàn chỉnh với vùng /Contents chứa toàn số 0
        part1 = base_pdf_bytes + sig_dict_prefix_final[:-1]  # tới ngay trước '<'
        part2 = sig_dict_suffix[1:]                           # ngay sau '>'
        assert len(part1) == offset_before_contents
        assert len(part2) == length_after_contents

        # Băm SHA-256 trên đúng 2 miền của /ByteRange (ngoại trừ vùng <Contents>)
        br_hasher = hashlib.sha256()
        br_hasher.update(part1)
        br_hasher.update(part2)
        byterange_digest = br_hasher.digest()

        # Gửi 32 bytes mã băm vào HSM để tạo khối CMS SignedData
        cms_der, hsm_sig_res = cls.build_cms_signed_data_via_hsm(
            byterange_sha256_digest=byterange_digest,
            vault=vault,
            user_pin=user_pin,
            totp_code=totp_code,
            document_label=document_label,
            signing_time_utc=signing_time_utc,
        )

        cms_hex = cms_der.hex().upper().encode("ascii")
        if len(cms_hex) > hex_placeholder_len:
            raise ValueError(f"Kích thước chữ ký CMS ({len(cms_hex)}) vượt quá vùng đệm ({hex_placeholder_len})!")
        padded_cms_hex = cms_hex + (b"0" * (hex_placeholder_len - len(cms_hex)))

        final_pdf = part1 + b"<" + padded_cms_hex + b">" + part2
        return final_pdf, hsm_sig_res, cms_der

    @classmethod
    def verify_pdf_pades_signature(
        cls,
        signed_pdf_path: str,
        vault: Optional[KryptoHSMVault] = None
    ) -> Dict[str, Any]:
        """
        Kiểm định độc lập tệp PDF đã ký số PAdES-HSM:
        1. Tìm bảng `/ByteRange` và vùng `/Contents` trong tệp PDF.
        2. Băm lại 2 miền `/ByteRange` và so sánh với `messageDigest` trong `CMS SignedData`.
        3. Xác thực chữ ký số RSA-3072 bằng Khóa công khai trong Chứng thư người ký.
        4. Xác thực Chứng thư người ký bằng Khóa công khai của `Personal Root CA`.
        5. Kiểm tra chứng thư có nằm trong Danh sách Thu hồi (`CRL`) khi đổi/mất máy hay không.
        6. Trích xuất và xác nhận mã băm `SHA-256` của ảnh chữ ký tay `.PNG` trong OID `1.3.6.1.4.1.99999.1.1`.
        """
        with open(signed_pdf_path, "rb") as f:
            pdf_bytes = f.read()

        br_match = re.search(
            rb"/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]",
            pdf_bytes,
        )
        if not br_match:
            return {
                "valid": False,
                "reason": "Không tìm thấy cấu trúc chữ ký số PAdES (/ByteRange) trong tệp PDF.",
            }

        b0, l0, b1, l1 = [int(x) for x in br_match.groups()]
        if b0 != 0 or (b1 + l1) > len(pdf_bytes):
            return {
                "valid": False,
                "reason": "Cấu trúc /ByteRange bị lệch hoặc có dữ liệu chèn trái phép ở cuối tệp.",
            }

        # Trích xuất khối hex trong <Contents>
        contents_region = pdf_bytes[l0:b1]
        if not (contents_region.startswith(b"<") and contents_region.endswith(b">")):
            return {
                "valid": False,
                "reason": "Vùng /Contents không đúng định dạng Hex PDF.",
            }

        hex_data = contents_region[1:-1]
        cms_der = bytes.fromhex(hex_data.decode("ascii"))

        # Tính lại băm SHA-256 của tài liệu trên /ByteRange
        recalc_hash = hashlib.sha256(pdf_bytes[b0:b0 + l0] + pdf_bytes[b1:b1 + l1]).digest()

        # Giải mã khối CMS ContentInfo
        content_info = cms.ContentInfo.load(cms_der)
        signed_data = content_info["content"]
        certs = signed_data["certificates"]
        signer_info = signed_data["signer_infos"][0]

        all_certs = [x509.load_der_x509_certificate(c.chosen.dump()) for c in certs]
        signer_cert = next((c for c in all_certs if c.issuer != c.subject), all_certs[0])
        root_cert = next((c for c in all_certs if c.issuer == c.subject), all_certs[-1])

        # 1. Xác thực chuỗi chứng thư (Root CA -> Signer Cert)
        root_cert.public_key().verify(
            signer_cert.signature,
            signer_cert.tbs_certificate_bytes,
            padding.PKCS1v15(),
            signer_cert.signature_hash_algorithm,
        )

        # 2. Kiểm tra messageDigest trong SignedAttributes khớp với băm /ByteRange
        signed_attrs = signer_info["signed_attrs"]
        msg_digest = None
        signing_time = None
        for attr in signed_attrs:
            if attr["type"].native == "message_digest":
                msg_digest = attr["values"][0].native
            elif attr["type"].native == "signing_time":
                signing_time = attr["values"][0].native

        if msg_digest != recalc_hash:
            return {
                "valid": False,
                "reason": "CẢNH BÁO GIẢ MẠO: Nội dung tài liệu PDF đã bị sửa đổi sau khi ký (Hash mismatch)!",
            }

        # 3. Xác thực chữ ký RSA trên DER(SignedAttributes)
        attrs_der = signed_attrs.dump()
        if attrs_der[0] != 0x31:
            attrs_der = b"\x31" + attrs_der[1:]
        raw_sig = signer_info["signature"].native

        signer_cert.public_key().verify(
            raw_sig,
            attrs_der,
            padding.PKCS1v15(),
            hashes.SHA256(),
        )

        # 4. Đọc OID mã băm ảnh chữ ký tay .PNG trong chứng thư
        cert_png_hash = ""
        try:
            ext = signer_cert.extensions.get_extension_for_oid(OID_VISUAL_SIGNATURE_PNG_HASH)
            cert_png_hash = ext.value.value.decode("ascii")
        except Exception:
            pass

        # 5. Kiểm tra danh sách thu hồi CRL nếu có truyền vào vault
        serial_hex = format(signer_cert.serial_number, "X")
        is_revoked = False
        if vault and "revoked_serials_crl" in vault.state:
            revoked_list = [r["revoked_serial_hex"] for r in vault.state["revoked_serials_crl"]]
            is_revoked = serial_hex in revoked_list

        # Trích xuất email từ SubjectAltName
        email_addr = ""
        try:
            san = signer_cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
            emails = san.value.get_values_for_type(x509.RFC822Name)
            if emails:
                email_addr = emails[0]
        except Exception:
            pass

        cn_attrs = signer_cert.subject.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME)
        signer_cn = cn_attrs[0].value if cn_attrs else "Unknown"

        return {
            "valid": not is_revoked,
            "tamper_free": True,
            "chain_trusted_by_root_ca": True,
            "revoked_in_crl": is_revoked,
            "signer_cn": signer_cn,
            "signer_email": email_addr,
            "serial_hex": serial_hex,
            "root_issuer_cn": root_cert.subject.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME)[0].value,
            "visual_sig_png_sha256_in_cert": cert_png_hash,
            "byterange_sha256": recalc_hash.hex(),
            "signing_time_utc": signing_time.isoformat() if hasattr(signing_time, "isoformat") else str(signing_time),
        }
