# -*- coding: utf-8 -*-
"""
test_crypto.py: KIỂM ĐỊNH BẢO MẬT VÀ NĂNG LỰC MÃ HÓA CỦA SECUREDOCSHARE
Kiểm thử 100% các tính năng:
1. AES-256-GCM & PBKDF2-HMAC-SHA512
2. Chống bẻ khóa & Chống can thiệp dữ liệu (Tamper-Proof Verification)
3. Sinh tệp HTML Tự Giải Mã Zero-Knowledge
4. Mã hóa PDF ISO 32000-2 AES-256 R6 (pikepdf)
5. Điều phối UnifiedLocker đa chế độ
"""

import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.crypto_engine import CryptoEngine
from core.pdf_locker import PDFLocker, HAS_PIKEPDF, HAS_PYPDF
from core.unified_locker import UnifiedLocker, ProtectionMode, ProtectionLevel


class TestSecureDocShare(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.password = "P@ssw0rd_Sieukho_2026!#$@%"

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_01_aes_gcm_encryption_and_decryption(self):
        """Kiểm tra mã hóa và giải mã dữ liệu nhị phân với AES-256-GCM."""
        plaintext = b"Day la tai lieu mat tuyet mat ve kinh te - phong thuy quy hoach do thi."
        meta = {"doc_title": "Bao cao Tai chinh", "author": "IBST"}

        encrypted = CryptoEngine.encrypt_bytes(plaintext, self.password, meta)
        self.assertTrue(encrypted.startswith(b"SECDOC_V1"))

        # Giải mã đúng mật khẩu
        decrypted, out_meta = CryptoEngine.decrypt_bytes(encrypted, self.password)
        self.assertEqual(plaintext, decrypted)
        self.assertEqual(out_meta["doc_title"], "Bao cao Tai chinh")

    def test_02_tamper_proof_verification(self):
        """Kiểm tra tính năng chống bẻ khóa và chống can thiệp dữ liệu (Tamper-proof)."""
        plaintext = b"Du lieu hop dong khong the thay doi."
        encrypted = bytearray(CryptoEngine.encrypt_bytes(plaintext, self.password))

        # Thử giải mã sai mật khẩu -> Phải báo lỗi
        with self.assertRaises(ValueError):
            CryptoEngine.decrypt_bytes(bytes(encrypted), "SaiMatKhau123")

        # Thử sửa đổi trái phép 1 byte ở cuối gói tin (Tamper attack)
        encrypted[-1] ^= 0xFF
        with self.assertRaises(ValueError):
            CryptoEngine.decrypt_bytes(bytes(encrypted), self.password)

    def test_03_self_decrypting_html_generation(self):
        """Kiểm tra khả năng sinh tệp HTML tự giải mã Zero-Knowledge."""
        test_file = os.path.join(self.temp_dir, "hop_dong_kinh_te.pdf")
        content = b"%PDF-1.7 Test PDF binary content here..."
        with open(test_file, "wb") as f:
            f.write(content)

        res = UnifiedLocker.lock_file(
            input_path=test_file,
            output_dir=self.temp_dir,
            password=self.password,
            mode=ProtectionMode.HTML_SELF_DECRYPT,
            hint_message="Mat khau la ngay sinh CTHDQT"
        )
        self.assertEqual(res["status"], "SUCCESS")
        html_path = res["output_path"]
        self.assertTrue(os.path.exists(html_path))

        with open(html_path, "r", encoding="utf-8") as f:
            html_text = f.read()

        # Xác nhận có Web Crypto API và PBKDF2 600.000 vòng lặp
        self.assertIn("crypto.subtle.deriveKey", html_text)
        self.assertIn("AES-GCM", html_text)
        self.assertIn("iterations: 600000", html_text)

    def test_04_pdf_aes256_r6_encryption(self):
        """Kiểm tra mã hóa và giải mã PDF chuẩn ISO 32000-2 AES-256 R6."""
        if not HAS_PIKEPDF and not HAS_PYPDF:
            self.skipTest("Không có thư viện PDF khả dụng")

        # Tạo file PDF mẫu đơn giản
        sample_pdf = os.path.join(self.temp_dir, "sample.pdf")
        try:
            import pikepdf
            pdf = pikepdf.new()
            pdf.add_blank_page(page_size=(595, 842))
            pdf.save(sample_pdf)
        except Exception:
            self.skipTest("Không thể tạo file PDF thử nghiệm")

        enc_pdf = os.path.join(self.temp_dir, "sample_protected.pdf")
        res_enc = PDFLocker.encrypt_pdf(
            input_pdf_path=sample_pdf,
            output_pdf_path=enc_pdf,
            user_password=self.password,
            allow_printing=True,
            allow_copying=False
        )
        self.assertEqual(res_enc["status"], "SUCCESS")
        self.assertTrue(os.path.exists(enc_pdf))

        # Kiểm tra giải mã
        dec_pdf = os.path.join(self.temp_dir, "sample_unlocked.pdf")
        res_dec = PDFLocker.decrypt_pdf(enc_pdf, dec_pdf, self.password)
        self.assertEqual(res_dec["status"], "SUCCESS")
        self.assertTrue(os.path.exists(dec_pdf))

    def test_05_secvault_container_workflow(self):
        """Kiểm tra toàn bộ chu trình mã hóa và giải mã tệp .secvault."""
        test_file = os.path.join(self.temp_dir, "du_lieu_bang_tinh.xlsx")
        with open(test_file, "wb") as f:
            f.write(b"Du lieu bang tinh Excel bi mat...")

        res_lock = UnifiedLocker.lock_file(
            input_path=test_file,
            output_dir=self.temp_dir,
            password=self.password,
            mode=ProtectionMode.SECVAULT
        )
        self.assertEqual(res_lock["status"], "SUCCESS")
        vault_path = res_lock["output_path"]
        self.assertTrue(vault_path.endswith(".secvault"))

        # Mở khóa file
        unlock_dir = os.path.join(self.temp_dir, "unlocked")
        res_unlock = UnifiedLocker.unlock_file(vault_path, unlock_dir, self.password)
        self.assertEqual(res_unlock["status"], "SUCCESS")
        self.assertTrue(os.path.exists(res_unlock["output_path"]))

    def test_06_pdf_view_only_no_copy_print(self):
        """Kiểm tra Loại 2: Mở xem tự do, nhưng CẤM IN, CẤM COPY, CẤM SỬA."""
        if not HAS_PIKEPDF:
            self.skipTest("Không có pikepdf")

        import pikepdf
        sample_pdf = os.path.join(self.temp_dir, "sample_viewonly.pdf")
        pdf = pikepdf.new()
        pdf.add_blank_page()
        pdf.save(sample_pdf)

        res = UnifiedLocker.lock_file(
            input_path=sample_pdf,
            output_dir=self.temp_dir,
            password="AdminOwnerPass123",
            protection_level=ProtectionLevel.VIEW_ONLY_RESTRICTED,
            mode=ProtectionMode.NATIVE
        )
        self.assertEqual(res["status"], "SUCCESS")
        self.assertIn("ReadOnly_NoCopyPrint", res["output_filename"])

        # Mở thử KHÔNG CẦN PASSWORD
        with pikepdf.open(res["output_path"]) as opened_pdf:
            self.assertEqual(len(opened_pdf.pages), 1)
            # Khóa cấm in và cấm copy
            self.assertFalse(opened_pdf.allow.extract)
            self.assertFalse(opened_pdf.allow.print_highres)
            self.assertFalse(opened_pdf.allow.modify_annotation)

    def test_07_pdf_strict_open_password_required(self):
        """Kiểm tra Loại 1: Chỉ nhập đúng password mới mở được file."""
        if not HAS_PIKEPDF:
            self.skipTest("Không có pikepdf")

        import pikepdf
        sample_pdf = os.path.join(self.temp_dir, "sample_strict.pdf")
        pdf = pikepdf.new()
        pdf.add_blank_page()
        pdf.save(sample_pdf)

        res = UnifiedLocker.lock_file(
            input_path=sample_pdf,
            output_dir=self.temp_dir,
            password="Vip88",
            protection_level=ProtectionLevel.OPEN_PASSWORD_REQUIRED,
            mode=ProtectionMode.NATIVE
        )
        self.assertEqual(res["status"], "SUCCESS")
        self.assertIn("Locked", res["output_filename"])

        # Mở không pass -> Phải ném lỗi PasswordError
        with self.assertRaises(pikepdf.PasswordError):
            pikepdf.open(res["output_path"])

        # Mở đúng pass 'Vip88' -> Thành công
        with pikepdf.open(res["output_path"], password="Vip88") as opened_pdf:
            self.assertEqual(len(opened_pdf.pages), 1)


if __name__ == "__main__":
    unittest.main()
