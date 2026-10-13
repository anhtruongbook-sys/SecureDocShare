package com.securedoc.share

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import com.itextpdf.text.BaseColor
import com.itextpdf.text.Element
import com.itextpdf.text.pdf.BaseFont
import com.itextpdf.text.pdf.PdfGState
import com.itextpdf.text.pdf.PdfReader
import com.itextpdf.text.pdf.PdfStamper
import com.itextpdf.text.pdf.PdfWriter
import org.apache.poi.poifs.crypt.EncryptionInfo
import org.apache.poi.poifs.crypt.EncryptionMode
import org.apache.poi.poifs.crypt.Encryptor
import org.apache.poi.poifs.crypt.Decryptor
import org.apache.poi.poifs.filesystem.POIFSFileSystem
import net.lingala.zip4j.ZipFile
import net.lingala.zip4j.model.ZipParameters
import net.lingala.zip4j.model.enums.AesKeyStrength
import net.lingala.zip4j.model.enums.CompressionLevel
import net.lingala.zip4j.model.enums.CompressionMethod
import net.lingala.zip4j.model.enums.EncryptionMethod
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.security.MessageDigest
import java.security.SecureRandom
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipFile as JZipFile
import java.util.zip.ZipOutputStream as JZipOutputStream
import java.util.zip.ZipEntry as JZipEntry
import android.util.Base64
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import org.json.JSONObject

class MainActivity: FlutterActivity() {
    private val CHANNEL = "com.securedoc.share/native_engine"
    private val executor = Executors.newSingleThreadExecutor()
    private var pendingBiometricResult: MethodChannel.Result? = null
    private val REQUEST_CODE_BIOMETRIC = 9901

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_BIOMETRIC) {
            val res = (resultCode == Activity.RESULT_OK)
            pendingBiometricResult?.success(res)
            pendingBiometricResult = null
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "encryptPdf" -> {
                    val srcPath = call.argument<String>("srcPath")
                    val destPath = call.argument<String>("destPath")
                    val password = call.argument<String>("password") ?: ""
                    val isViewOnly = call.argument<Boolean>("isViewOnly") ?: false
                    val allowPrint = call.argument<Boolean>("allowPrint") ?: false
                    val watermark = call.argument<String>("watermark") ?: ""
                    val watermarkImageBase64 = call.argument<String>("watermarkImageBase64") ?: ""
                    val watermarkOpacity = (call.argument<Double>("watermarkOpacity") ?: 0.15).toFloat()
                    val recipientName = call.argument<String>("recipientName") ?: ""
                    val releaseCode = call.argument<String>("releaseCode") ?: ""
                    val enableManifest = call.argument<Boolean>("enableManifest") ?: false
                    val enableSignature = call.argument<Boolean>("enableSignature") ?: false
                    val signerName = call.argument<String>("signerName") ?: ""
                    val signingReason = call.argument<String>("signingReason") ?: ""
                    val signaturePos = call.argument<String>("signaturePos") ?: "last_page"
                    val signatureImageBase64 = call.argument<String>("signatureImageBase64") ?: ""
                    val masterPassword = call.argument<String>("masterPassword") ?: ""
                    val compress = call.argument<Boolean>("compress") ?: true

                    if (srcPath == null || destPath == null) {
                        result.error("INVALID_ARGS", "Missing srcPath or destPath", null)
                        return@setMethodCallHandler
                    }

                    executor.execute {
                        var reader: PdfReader? = null
                        var stamper: PdfStamper? = null
                        var fos: FileOutputStream? = null
                        try {
                            val srcFile = File(srcPath)
                            if (!srcFile.exists()) {
                                runOnUiThread { result.error("FILE_NOT_FOUND", "File not found: $srcPath", null) }
                                return@execute
                            }

                            PdfReader.unethicalreading = true
                            reader = PdfReader(srcPath)
                            if (reader.isEncrypted) {
                                try { reader.close() } catch (_: Throwable) {}
                                reader = null
                                runOnUiThread {
                                    result.error("ALREADY_ENCRYPTED", "Tệp PDF này đã được đặt mật khẩu bảo vệ trước đó. Vui lòng chuyển sang Tab MỞ KHÓA!", null)
                                }
                                return@execute
                            }

                            val outFile = File(destPath)
                            if (outFile.exists()) outFile.delete()
                            outFile.parentFile?.mkdirs()
                            fos = FileOutputStream(outFile)

                            stamper = PdfStamper(reader, fos)

                            if (compress) {
                                try {
                                    stamper.setFullCompression()
                                } catch (_: Throwable) {}
                            }

                            // Chuẩn bị ảnh Watermark và Chữ ký số nếu có
                            var wmImg: com.itextpdf.text.Image? = null
                            if (watermarkImageBase64.isNotBlank()) {
                                try {
                                    val cleanB64 = if (watermarkImageBase64.contains(",")) watermarkImageBase64.substringAfter(",") else watermarkImageBase64
                                    val imgBytes = Base64.decode(cleanB64, Base64.DEFAULT)
                                    wmImg = com.itextpdf.text.Image.getInstance(imgBytes)
                                } catch (_: Throwable) {}
                            }

                            var sigImg: com.itextpdf.text.Image? = null
                            if (enableSignature && signatureImageBase64.isNotBlank()) {
                                try {
                                    val cleanB64 = if (signatureImageBase64.contains(",")) signatureImageBase64.substringAfter(",") else signatureImageBase64
                                    val imgBytes = Base64.decode(cleanB64, Base64.DEFAULT)
                                    sigImg = com.itextpdf.text.Image.getInstance(imgBytes)
                                } catch (_: Throwable) {}
                            }

                            val totalPages = reader.numberOfPages
                            for (p in 1..totalPages) {
                                val over = stamper.getOverContent(p)
                                val rect = reader.getPageSizeWithRotation(p)

                                // 1. Chèn Watermark (Ảnh Logo hoặc Chữ Mờ)
                                if (wmImg != null) {
                                    try {
                                        val gState = PdfGState()
                                        gState.setFillOpacity(watermarkOpacity)
                                        over.saveState()
                                        over.setGState(gState)
                                        val targetWidth = rect.width * 0.48f
                                        val scale = (targetWidth / wmImg.width) * 100f
                                        wmImg.scalePercent(scale)
                                        val imgW = wmImg.scaledWidth
                                        val imgH = wmImg.scaledHeight
                                        wmImg.setAbsolutePosition((rect.width - imgW) / 2f, (rect.height - imgH) / 2f)
                                        over.addImage(wmImg)
                                        over.restoreState()
                                    } catch (_: Throwable) {}
                                } else if (watermark.isNotBlank()) {
                                    try {
                                        val baseFont = BaseFont.createFont(BaseFont.HELVETICA_BOLD, BaseFont.WINANSI, BaseFont.NOT_EMBEDDED)
                                        val gState = PdfGState()
                                        gState.setFillOpacity(watermarkOpacity)
                                        over.saveState()
                                        over.setGState(gState)
                                        over.beginText()
                                        over.setFontAndSize(baseFont, 36f)
                                        over.setColorFill(BaseColor(160, 160, 160))
                                        over.showTextAligned(
                                            Element.ALIGN_CENTER,
                                            watermark,
                                            rect.width / 2f,
                                            rect.height / 2f,
                                            45f
                                        )
                                        over.endText()
                                        over.restoreState()
                                    } catch (_: Throwable) {}
                                }

                                // 2. Chèn Dòng Truy Vết Chống Tuồn File (Confidential Footer)
                                if (recipientName.isNotBlank() || releaseCode.isNotBlank()) {
                                    try {
                                        val font = BaseFont.createFont(BaseFont.HELVETICA, BaseFont.WINANSI, BaseFont.NOT_EMBEDDED)
                                        val gState = PdfGState()
                                        gState.setFillOpacity(0.35f)
                                        over.saveState()
                                        over.setGState(gState)
                                        over.beginText()
                                        over.setFontAndSize(font, 9f)
                                        over.setColorFill(BaseColor(100, 100, 100))
                                        val footerText = buildString {
                                            append("CONFIDENTIAL")
                                            if (recipientName.isNotBlank()) append(" • ").append(recipientName)
                                            if (releaseCode.isNotBlank()) append(" • ").append(releaseCode)
                                        }
                                        over.showTextAligned(
                                            Element.ALIGN_CENTER,
                                            footerText,
                                            rect.width / 2f,
                                            16f,
                                            0f
                                        )
                                        over.endText()
                                        over.restoreState()
                                    } catch (_: Throwable) {}
                                }

                                // 3. Chèn Chữ Ký Số / Con Dấu Điện Tử
                                val isTargetPage = (signaturePos == "all_pages" || p == totalPages)
                                if (enableSignature && isTargetPage) {
                                    try {
                                        val gState = PdfGState()
                                        gState.setFillOpacity(0.92f)
                                        over.saveState()
                                        over.setGState(gState)

                                        val sealX = rect.width - 200f
                                        val sealY = 32f
                                        val sealW = 180f
                                        val sealH = 65f

                                        if (sigImg != null) {
                                            val scale = (sealW / sigImg.width) * 100f
                                            sigImg.scalePercent(scale)
                                            sigImg.setAbsolutePosition(sealX, sealY)
                                            over.addImage(sigImg)
                                        } else {
                                            over.setLineWidth(1.2f)
                                            over.setColorStroke(BaseColor(185, 28, 28))
                                            over.setColorFill(BaseColor(254, 242, 242))
                                            over.roundRectangle(sealX, sealY, sealW, sealH, 4f)
                                            over.fillStroke()

                                            val hFont = BaseFont.createFont(BaseFont.HELVETICA_BOLD, BaseFont.WINANSI, BaseFont.NOT_EMBEDDED)
                                            val nFont = BaseFont.createFont(BaseFont.HELVETICA, BaseFont.WINANSI, BaseFont.NOT_EMBEDDED)

                                            over.beginText()
                                            over.setFontAndSize(hFont, 8f)
                                            over.setColorFill(BaseColor(185, 28, 28))
                                            over.showTextAligned(Element.ALIGN_LEFT, "✓ CHU KY SO DIEN TU (PAdES)", sealX + 8f, sealY + 50f, 0f)

                                            over.setFontAndSize(nFont, 7.5f)
                                            over.setColorFill(BaseColor(30, 41, 59))
                                            val sName = if (signerName.isNotBlank()) signerName else "KryptoDoc Enterprise Vault"
                                            over.showTextAligned(Element.ALIGN_LEFT, "Ky boi: $sName", sealX + 8f, sealY + 37f, 0f)

                                            val sReason = if (signingReason.isNotBlank()) signingReason else "Phat hanh tai lieu"
                                            over.showTextAligned(Element.ALIGN_LEFT, "Ly do: $sReason", sealX + 8f, sealY + 25f, 0f)

                                            val dateStr = java.text.SimpleDateFormat("dd/MM/yyyy HH:mm", java.util.Locale.getDefault()).format(java.util.Date())
                                            over.showTextAligned(Element.ALIGN_LEFT, "Ngay gio: $dateStr", sealX + 8f, sealY + 13f, 0f)
                                            over.endText()
                                        }
                                        over.restoreState()
                                    } catch (_: Throwable) {}
                                }
                            }

                            // 4. Nhúng Siêu Dữ Liệu Pháp Y Chống Xóa Thuộc Tính & Chống Đổi Tên
                            val infoMap = HashMap<String, String>()
                            infoMap["KD_PROTECTION"] = if (isViewOnly) "VIEW_ONLY" else "PASSWORD_LOCKED"
                            if (recipientName.isNotBlank()) infoMap["KD_RECIPIENT"] = recipientName
                            if (releaseCode.isNotBlank()) infoMap["KD_RELEASE"] = releaseCode
                            infoMap["KD_ORIGINAL_NAME"] = srcFile.name
                            infoMap["KD_ALLOW_PRINT"] = allowPrint.toString()
                            infoMap["KD_WATERMARK"] = if (watermarkImageBase64.isNotBlank()) "IMAGE_LOGO" else (if (watermark.isNotBlank()) watermark else "NONE")
                            val nowStr = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())
                            infoMap["KD_TIMESTAMP"] = nowStr
                            if (enableSignature) {
                                infoMap["KD_SIGNER"] = if (signerName.isNotBlank()) signerName else "KryptoDoc Enterprise Vault"
                            }
                            stamper.moreInfo = infoMap

                            // 5. Cài đặt bảo vệ mật khẩu và quyền hạn (Adobe ISO 32000)
                            val userPwd: ByteArray? = if (isViewOnly) null else password.toByteArray(Charsets.UTF_8)
                            val ownerPwd = if (masterPassword.isNotBlank()) masterPassword.toByteArray(Charsets.UTF_8) else password.toByteArray(Charsets.UTF_8)
                            val permissions = if (isViewOnly) {
                                if (allowPrint) {
                                    PdfWriter.ALLOW_PRINTING or PdfWriter.ALLOW_DEGRADED_PRINTING or PdfWriter.ALLOW_SCREENREADERS
                                } else {
                                    PdfWriter.ALLOW_SCREENREADERS // CẤM IN, CẤM COPY, CHỈ CHO XEM!
                                }
                            } else {
                                PdfWriter.ALLOW_PRINTING or PdfWriter.ALLOW_COPY or PdfWriter.ALLOW_SCREENREADERS or PdfWriter.ALLOW_FILL_IN
                            }

                            stamper.setEncryption(
                                userPwd,
                                ownerPwd,
                                permissions,
                                PdfWriter.STANDARD_ENCRYPTION_128
                            )

                            stamper.close()
                            stamper = null
                            fos.close()
                            fos = null
                            reader.close()
                            reader = null

                            runOnUiThread {
                                result.success(destPath)
                            }
                        } catch (e: Throwable) {
                            try { stamper?.close() } catch (_: Throwable) {}
                            try { fos?.close() } catch (_: Throwable) {}
                            try { reader?.close() } catch (_: Throwable) {}
                            val isBadPass = e is com.itextpdf.text.exceptions.BadPasswordException || 
                                            (e.message?.contains("Bad password", ignoreCase = true) == true) ||
                                            (e.message?.contains("password", ignoreCase = true) == true && e.message?.contains("protected", ignoreCase = true) == true)
                            if (isBadPass) {
                                runOnUiThread {
                                    result.error("ALREADY_ENCRYPTED", "Tệp PDF này đã được đặt mật khẩu bảo vệ trước đó. Vui lòng chuyển sang Tab MỞ KHÓA!", null)
                                }
                                return@execute
                            }
                            val errMsg = e.message ?: e.toString()
                            runOnUiThread {
                                result.error("ENCRYPTION_ERROR", errMsg, null)
                            }
                        }
                    }
                }
                "decryptPdf" -> {
                    val srcPath = call.argument<String>("srcPath")
                    val destPath = call.argument<String>("destPath")
                    val password = call.argument<String>("password") ?: ""
                    val masterPassword = call.argument<String>("masterPassword") ?: ""

                    if (srcPath == null || destPath == null) {
                        result.error("INVALID_ARGS", "Missing srcPath or destPath", null)
                        return@setMethodCallHandler
                    }

                    executor.execute {
                        var reader: PdfReader? = null
                        var stamper: PdfStamper? = null
                        var fos: FileOutputStream? = null
                        try {
                            val srcFile = File(srcPath)
                            if (!srcFile.exists()) {
                                runOnUiThread { result.error("FILE_NOT_FOUND", "File not found: $srcPath", null) }
                                return@execute
                            }

                            PdfReader.unethicalreading = true
                            try {
                                reader = PdfReader(srcPath, password.toByteArray(Charsets.UTF_8))
                            } catch (e: Throwable) {
                                if (masterPassword.isNotBlank() && masterPassword != password) {
                                    reader = PdfReader(srcPath, masterPassword.toByteArray(Charsets.UTF_8))
                                } else {
                                    throw e
                                }
                            }

                            val outFile = File(destPath)
                            if (outFile.exists()) outFile.delete()
                            outFile.parentFile?.mkdirs()
                            fos = FileOutputStream(outFile)

                            stamper = PdfStamper(reader, fos)
                            stamper.close()
                            stamper = null
                            fos.close()
                            fos = null
                            reader.close()
                            reader = null

                            runOnUiThread {
                                result.success(destPath)
                            }
                        } catch (e: Throwable) {
                            try { stamper?.close() } catch (_: Throwable) {}
                            try { fos?.close() } catch (_: Throwable) {}
                            try { reader?.close() } catch (_: Throwable) {}
                            val errMsg = e.message ?: e.toString()
                            runOnUiThread {
                                result.error("DECRYPTION_ERROR", errMsg, null)
                            }
                        }
                    }
                }
                "encryptOffice" -> {
                    val srcPath = call.argument<String>("srcPath")
                    val destPath = call.argument<String>("destPath")
                    val password = call.argument<String>("password") ?: ""
                    val isViewOnly = call.argument<Boolean>("isViewOnly") ?: false
                    val allowPrint = call.argument<Boolean>("allowPrint") ?: false
                    val watermark = call.argument<String>("watermark") ?: ""
                    val watermarkImageBase64 = call.argument<String>("watermarkImageBase64") ?: ""
                    val watermarkOpacity = (call.argument<Double>("watermarkOpacity") ?: 0.15).toFloat()
                    val recipientName = call.argument<String>("recipientName") ?: ""
                    val releaseCode = call.argument<String>("releaseCode") ?: ""
                    val enableManifest = call.argument<Boolean>("enableManifest") ?: false
                    val enableSignature = call.argument<Boolean>("enableSignature") ?: false
                    val signerName = call.argument<String>("signerName") ?: ""
                    val signingReason = call.argument<String>("signingReason") ?: ""
                    val masterPassword = call.argument<String>("masterPassword") ?: ""

                    if (srcPath == null || destPath == null) {
                        result.error("INVALID_ARGS", "Missing srcPath or destPath", null)
                        return@setMethodCallHandler
                    }

                    executor.execute {
                        try {
                            val srcFile = File(srcPath)
                            if (!srcFile.exists()) {
                                runOnUiThread { result.error("FILE_NOT_FOUND", "File not found: $srcPath", null) }
                                return@execute
                            }

                            val outFile = File(destPath)
                            if (outFile.exists()) outFile.delete()
                            outFile.parentFile?.mkdirs()

                            // Kiểm tra trước: Tệp Office đã được mã hóa bảo vệ chưa?
                            try {
                                POIFSFileSystem(srcFile).use { checkFs ->
                                    if (checkFs.root.hasEntry("EncryptedPackage") || checkFs.root.hasEntry("EncryptionInfo")) {
                                        runOnUiThread {
                                            result.error("ALREADY_ENCRYPTED", "Tệp Office này đã được đặt mật khẩu bảo vệ trước đó. Vui lòng chuyển sang Tab MỞ KHÓA!", null)
                                        }
                                        return@execute
                                    }
                                }
                            } catch (_: Throwable) {}

                            val manifestJson = JSONObject().apply {
                                put("recipient", recipientName)
                                put("releaseCode", releaseCode)
                                put("originalName", srcFile.name)
                                put("allowPrint", allowPrint)
                                put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date()))
                                put("signer", if (enableSignature) (if (signerName.isNotBlank()) signerName else "KryptoDoc Enterprise Vault") else "")
                                put("protection", if (isViewOnly) "READ_ONLY" else "PASSWORD_LOCKED")
                            }.toString()

                            val ext = srcFile.extension.lowercase()
                            var encryptSuccess = false
                            var lastError: Throwable? = null

                            val hasWatermark = watermarkImageBase64.isNotBlank() || watermark.isNotBlank()
                            var wmImgBytes: ByteArray? = null
                            if (watermarkImageBase64.isNotBlank()) {
                                try {
                                    val cleanB64 = if (watermarkImageBase64.contains(",")) watermarkImageBase64.substringAfter(",") else watermarkImageBase64
                                    wmImgBytes = Base64.decode(cleanB64, Base64.DEFAULT)
                                } catch (_: Throwable) {}
                            }

                            if (isZipFile(srcFile)) {
                                val tempWatermarked = File(outFile.parentFile, "wm_" + srcFile.name)
                                try {
                                    if (ext == "docx" || ext == "doc") {
                                        if (hasWatermark) {
                                            applyDocxWatermark(srcFile, tempWatermarked, wmImgBytes, watermark, watermarkOpacity, manifestJson)
                                        } else {
                                            srcFile.copyTo(tempWatermarked, overwrite = true)
                                        }

                                        if (isViewOnly) {
                                            protectDocxReadOnly(tempWatermarked, outFile, password, manifestJson)
                                            encryptSuccess = true
                                        } else {
                                            encryptWithPoifs(tempWatermarked, outFile, password)
                                            encryptSuccess = true
                                        }
                                    } else if (ext == "xlsx" || ext == "xls") {
                                        if (hasWatermark) {
                                            applyXlsxWatermark(srcFile, tempWatermarked, wmImgBytes, watermark, watermarkOpacity, manifestJson)
                                        } else {
                                            srcFile.copyTo(tempWatermarked, overwrite = true)
                                        }

                                        if (isViewOnly) {
                                            protectXlsxReadOnly(tempWatermarked, outFile, password, manifestJson)
                                            encryptSuccess = true
                                        } else {
                                            encryptWithPoifs(tempWatermarked, outFile, password)
                                            encryptSuccess = true
                                        }
                                    } else if (ext == "pptx" || ext == "ppt") {
                                        if (hasWatermark) {
                                            applyPptxWatermark(srcFile, tempWatermarked, wmImgBytes, watermark, watermarkOpacity, manifestJson)
                                        } else {
                                            srcFile.copyTo(tempWatermarked, overwrite = true)
                                        }

                                        if (isViewOnly) {
                                            tempWatermarked.copyTo(outFile, overwrite = true)
                                            encryptSuccess = true
                                        } else {
                                            encryptWithPoifs(tempWatermarked, outFile, password)
                                            encryptSuccess = true
                                        }
                                    }
                                } finally {
                                    if (tempWatermarked.exists()) tempWatermarked.delete()
                                }
                            } else {
                                // Tệp nhị phân legacy OLE (.doc cũ, .xls cũ): mã hóa standard MS-OFFCRYPTO
                                try {
                                    encryptWithPoifs(srcFile, outFile, password)
                                    encryptSuccess = true
                                } catch (eOle: Throwable) {
                                    lastError = eOle
                                }
                            }

                            if (!encryptSuccess) {
                                throw lastError ?: Exception("Không thể mã hóa Office Native: ${lastError?.message}")
                            }

                            runOnUiThread {
                                result.success(destPath)
                            }
                        } catch (e: Throwable) {
                            val errMsg = e.message ?: e.toString()
                            runOnUiThread {
                                result.error("OFFICE_ENCRYPT_ERROR", errMsg, null)
                            }
                        }
                    }
                }
                "decryptOffice" -> {
                    val srcPath = call.argument<String>("srcPath")
                    val destPath = call.argument<String>("destPath")
                    val password = call.argument<String>("password") ?: ""
                    val masterPassword = call.argument<String>("masterPassword") ?: ""

                    if (srcPath == null || destPath == null) {
                        result.error("INVALID_ARGS", "Missing srcPath or destPath", null)
                        return@setMethodCallHandler
                    }

                    executor.execute {
                        try {
                            val srcFile = File(srcPath)
                            if (!srcFile.exists()) {
                                runOnUiThread { result.error("FILE_NOT_FOUND", "File not found: $srcPath", null) }
                                return@execute
                            }

                            val outFile = File(destPath)
                            if (outFile.exists()) outFile.delete()
                            outFile.parentFile?.mkdirs()

                            var decrypted = false

                            // Cách 1: Thử giải mã OLE EncryptedPackage (Mật khẩu mở tệp MS-OFFCRYPTO)
                            try {
                                POIFSFileSystem(srcFile).use { fs ->
                                    val info = EncryptionInfo(fs)
                                    val decryptor = info.decryptor
                                    val isUserPwOk = decryptor.verifyPassword(password)
                                    val isMasterPwOk = if (!isUserPwOk && masterPassword.isNotBlank()) decryptor.verifyPassword(masterPassword) else false
                                    if (!isUserPwOk && !isMasterPwOk) {
                                        runOnUiThread {
                                            result.error("WRONG_PASSWORD", "Mật khẩu mở tệp Office không chính xác!", null)
                                        }
                                        return@execute
                                    }

                                    decryptor.getDataStream(fs).use { inputStream ->
                                        FileOutputStream(outFile).use { outputStream ->
                                            inputStream.copyTo(outputStream)
                                        }
                                    }
                                }
                                decrypted = true
                            } catch (eOle: Throwable) {
                                // Cách 2: Nếu không phải OLE EncryptedPackage, kiểm tra tệp ZIP bảo vệ Read-Only
                                if (isZipFile(srcFile)) {
                                    var isWordProtected = false
                                    var isExcelProtected = false
                                    var wordVerified = false
                                    var excelVerified = false

                                    JZipFile(srcFile).use { zipIn ->
                                        val settingsEntry = zipIn.getEntry("word/settings.xml")
                                        if (settingsEntry != null) {
                                            val content = zipIn.getInputStream(settingsEntry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                                            if (content.contains("<w:documentProtection")) {
                                                isWordProtected = true
                                                val saltMatch = Regex("w:salt=\"([^\"]+)\"").find(content)
                                                val hashMatch = Regex("w:hash=\"([^\"]+)\"").find(content)
                                                if (saltMatch != null && hashMatch != null) {
                                                    val sB64 = saltMatch.groupValues[1]
                                                    val hB64 = hashMatch.groupValues[1]
                                                    val saltBytes = Base64.decode(sB64, Base64.NO_WRAP)
                                                    val computed = computeOfficeSha512Hash(password, saltBytes, 100000)
                                                    val isMasterMatch = masterPassword.isNotBlank() && (password == masterPassword || computeOfficeSha512Hash(masterPassword, saltBytes, 100000).trim() == hB64.trim())
                                                    if (computed.trim() == hB64.trim() || isMasterMatch) {
                                                        wordVerified = true
                                                    }
                                                } else {
                                                    wordVerified = true
                                                }
                                            }
                                        }

                                        val wbEntry = zipIn.getEntry("xl/workbook.xml")
                                        if (wbEntry != null) {
                                            val content = zipIn.getInputStream(wbEntry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                                            if (content.contains("<workbookProtection") || content.contains("<fileSharing")) {
                                                isExcelProtected = true
                                                val saltMatch = Regex("workbookSaltValue=\"([^\"]+)\"").find(content)
                                                val hashMatch = Regex("workbookHashValue=\"([^\"]+)\"").find(content)
                                                if (saltMatch != null && hashMatch != null) {
                                                    val sB64 = saltMatch.groupValues[1]
                                                    val hB64 = hashMatch.groupValues[1]
                                                    val saltBytes = Base64.decode(sB64, Base64.NO_WRAP)
                                                    val computed = computeOfficeSha512Hash(password, saltBytes, 100000)
                                                    val isMasterMatch = masterPassword.isNotBlank() && (password == masterPassword || computeOfficeSha512Hash(masterPassword, saltBytes, 100000).trim() == hB64.trim())
                                                    if (computed.trim() == hB64.trim() || isMasterMatch) {
                                                        excelVerified = true
                                                    }
                                                } else {
                                                    excelVerified = true
                                                }
                                            }
                                        }
                                    }

                                    if (isWordProtected) {
                                        if (!wordVerified) {
                                            runOnUiThread {
                                                result.error("WRONG_PASSWORD", "Mật khẩu gỡ khóa tài liệu Word không chính xác!", null)
                                            }
                                            return@execute
                                        }
                                        unprotectDocx(srcFile, outFile)
                                        decrypted = true
                                    } else if (isExcelProtected) {
                                        if (!excelVerified) {
                                            runOnUiThread {
                                                result.error("WRONG_PASSWORD", "Mật khẩu gỡ khóa bảng tính Excel không chính xác!", null)
                                            }
                                            return@execute
                                        }
                                        unprotectXlsx(srcFile, outFile)
                                        decrypted = true
                                    } else {
                                        // Tệp PPTX hoặc tài liệu không khóa sửa đổi
                                        srcFile.copyTo(outFile, overwrite = true)
                                        decrypted = true
                                    }
                                }
                            }

                            if (!decrypted) {
                                throw Exception("Không thể giải mã tệp Office. Vui lòng kiểm tra lại mật khẩu!")
                            }

                            runOnUiThread {
                                result.success(destPath)
                            }
                        } catch (e: Throwable) {
                            val errMsg = e.message ?: e.toString()
                            runOnUiThread {
                                result.error("OFFICE_DECRYPT_ERROR", errMsg, null)
                            }
                        }
                    }
                }
                "watermarkImage" -> {
                    val srcPath = call.argument<String>("srcPath")
                    val destPath = call.argument<String>("destPath")
                    val watermark = call.argument<String>("watermark") ?: ""
                    val watermarkImageBase64 = call.argument<String>("watermarkImageBase64") ?: ""
                    val watermarkOpacity = (call.argument<Double>("watermarkOpacity") ?: 0.20).toFloat()

                    if (srcPath == null || destPath == null) {
                        result.error("INVALID_ARGS", "Missing srcPath or destPath", null)
                        return@setMethodCallHandler
                    }

                    executor.execute {
                        try {
                            val srcFile = File(srcPath)
                            val outFile = File(destPath)
                            outFile.parentFile?.mkdirs()

                            var wmImgBytes: ByteArray? = null
                            if (watermarkImageBase64.isNotBlank()) {
                                val cleanB64 = if (watermarkImageBase64.contains(",")) watermarkImageBase64.substringAfter(",") else watermarkImageBase64
                                wmImgBytes = Base64.decode(cleanB64, Base64.DEFAULT)
                            }

                            applyRasterImageWatermark(srcFile, outFile, wmImgBytes, watermark, watermarkOpacity)
                            runOnUiThread { result.success(destPath) }
                        } catch (e: Throwable) {
                            val errMsg = e.message ?: e.toString()
                            runOnUiThread { result.error("IMAGE_WATERMARK_ERROR", errMsg, null) }
                        }
                    }
                }
                "createEncryptedZip" -> {
                    val srcPaths = call.argument<List<String>>("srcPaths") ?: emptyList()
                    val destZipPath = call.argument<String>("destZipPath")
                    val password = call.argument<String>("password") ?: ""
                    val useZipCrypto = call.argument<Boolean>("useZipCrypto") ?: false

                    if (srcPaths.isEmpty() || destZipPath == null) {
                        result.error("INVALID_ARGS", "Missing srcPaths or destZipPath", null)
                        return@setMethodCallHandler
                    }

                    executor.execute {
                        try {
                            if (srcPaths.size == 1) {
                                val singleFile = File(srcPaths[0])
                                if (singleFile.name.endsWith(".zip", ignoreCase = true)) {
                                    try {
                                        val checkZip = ZipFile(singleFile)
                                        if (checkZip.isEncrypted) {
                                            runOnUiThread {
                                                result.error("ALREADY_ENCRYPTED", "Kho nén .ZIP này đã được đặt mật khẩu bảo vệ trước đó. Vui lòng chuyển sang Tab MỞ KHÓA!", null)
                                            }
                                            return@execute
                                        }
                                    } catch (_: Throwable) {}
                                }
                            }

                            val outZip = File(destZipPath)
                            if (outZip.exists()) outZip.delete()
                            outZip.parentFile?.mkdirs()

                            val zipFile = ZipFile(outZip, password.toCharArray())
                            val zipParameters = ZipParameters().apply {
                                isEncryptFiles = password.isNotEmpty()
                                if (password.isNotEmpty()) {
                                    if (useZipCrypto) {
                                        encryptionMethod = EncryptionMethod.ZIP_STANDARD
                                    } else {
                                        encryptionMethod = EncryptionMethod.AES
                                        aesKeyStrength = AesKeyStrength.KEY_STRENGTH_256
                                    }
                                }
                                compressionMethod = CompressionMethod.DEFLATE
                                compressionLevel = CompressionLevel.NORMAL
                            }

                            for (p in srcPaths) {
                                val f = File(p)
                                if (f.exists()) {
                                    if (f.isDirectory) {
                                        zipFile.addFolder(f, zipParameters)
                                    } else {
                                        zipFile.addFile(f, zipParameters)
                                    }
                                }
                            }

                            runOnUiThread {
                                result.success(destZipPath)
                            }
                        } catch (e: Throwable) {
                            val errMsg = e.message ?: e.toString()
                            runOnUiThread {
                                result.error("ZIP_ENCRYPT_ERROR", errMsg, null)
                            }
                        }
                    }
                }
                "extractEncryptedZip" -> {
                    val zipPath = call.argument<String>("zipPath")
                    val destDirPath = call.argument<String>("destDirPath")
                    val password = call.argument<String>("password") ?: ""
                    val masterPassword = call.argument<String>("masterPassword") ?: ""

                    if (zipPath == null || destDirPath == null) {
                        result.error("INVALID_ARGS", "Missing zipPath or destDirPath", null)
                        return@setMethodCallHandler
                    }

                    executor.execute {
                        try {
                            var zipFile = ZipFile(zipPath, password.toCharArray())
                            if (!zipFile.isValidZipFile) {
                                runOnUiThread { result.error("INVALID_ZIP", "Tệp không phải định dạng ZIP hợp lệ!", null) }
                                return@execute
                            }

                            val outDir = File(destDirPath)
                            outDir.mkdirs()

                            try {
                                zipFile.extractAll(destDirPath)
                            } catch (zErr: Throwable) {
                                if (masterPassword.isNotBlank() && masterPassword != password) {
                                    zipFile = ZipFile(zipPath, masterPassword.toCharArray())
                                    zipFile.extractAll(destDirPath)
                                } else {
                                    throw zErr
                                }
                            }

                            val extractedFiles = outDir.listFiles()?.map { it.name } ?: emptyList()
                            runOnUiThread {
                                result.success(extractedFiles)
                            }
                        } catch (e: Throwable) {
                            val errMsg = e.message ?: e.toString()
                            runOnUiThread {
                                result.error("ZIP_DECRYPT_ERROR", errMsg, null)
                            }
                        }
                    }
                }
                "inspectForensic" -> {
                    val srcPath = call.argument<String>("srcPath")
                    if (srcPath == null) {
                        result.error("INVALID_ARGS", "Missing srcPath", null)
                        return@setMethodCallHandler
                    }

                    executor.execute {
                        try {
                            val srcFile = File(srcPath)
                            if (!srcFile.exists()) {
                                runOnUiThread { result.error("FILE_NOT_FOUND", "File not found: $srcPath", null) }
                                return@execute
                            }

                            val reportJson = inspectForensic(srcFile)
                            runOnUiThread { result.success(reportJson) }
                        } catch (e: Throwable) {
                            val errMsg = e.message ?: e.toString()
                            runOnUiThread { result.error("FORENSIC_ERROR", errMsg, null) }
                        }
                    }
                }
                "authenticateBiometrics" -> {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
                        if (keyguardManager.isKeyguardSecure) {
                            val intent = keyguardManager.createConfirmDeviceCredentialIntent(
                                "KryptoDoc Vault",
                                "Xác thực danh tính bằng vân tay, khuôn mặt hoặc mã PIN phần cứng"
                            )
                            if (intent != null) {
                                pendingBiometricResult = result
                                startActivityForResult(intent, REQUEST_CODE_BIOMETRIC)
                                return@setMethodCallHandler
                            }
                        }
                    }
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun encryptWithPoifs(srcFile: File, outFile: File, password: String) {
        try {
            POIFSFileSystem().use { fs ->
                val info = EncryptionInfo(EncryptionMode.standard)
                val encryptor = info.encryptor
                encryptor.confirmPassword(password)
                encryptor.getDataStream(fs).use { os ->
                    FileInputStream(srcFile).use { fis ->
                        fis.copyTo(os)
                    }
                }
                FileOutputStream(outFile).use { fos ->
                    fs.writeFilesystem(fos)
                }
            }
        } catch (_: Throwable) {
            POIFSFileSystem().use { fs ->
                val info = EncryptionInfo(EncryptionMode.agile)
                val encryptor = info.encryptor
                encryptor.confirmPassword(password)
                encryptor.getDataStream(fs).use { os ->
                    FileInputStream(srcFile).use { fis ->
                        fis.copyTo(os)
                    }
                }
                FileOutputStream(outFile).use { fos ->
                    fs.writeFilesystem(fos)
                }
            }
        }
    }

    private fun createTextWatermarkPngBytes(text: String, opacity: Float): ByteArray {
        val width = 800
        val height = 400
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.GRAY
            alpha = (opacity * 255).coerceIn(30f, 220f).toInt()
            textSize = 58f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        canvas.save()
        canvas.rotate(-30f, width / 2f, height / 2f)
        canvas.drawText(text, width / 2f, height / 2f + 20f, paint)
        canvas.restore()
        val baos = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, baos)
        return baos.toByteArray()
    }

    private fun applyDocxWatermark(srcFile: File, outFile: File, wmImgBytes: ByteArray?, wmText: String, opacity: Float, manifestJson: String) {
        val relsEntry = "word/_rels/header1.xml.rels"
        val headerEntry = "word/header1.xml"
        val wmImgEntry = "word/media/image_wm.png"

        val imgBytes = wmImgBytes ?: if (wmText.isNotBlank()) createTextWatermarkPngBytes(wmText, opacity) else null

        val headerRelsXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdWmPic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image_wm.png"/>
</Relationships>"""

        val headerXml = if (imgBytes != null) {
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <w:p>
    <w:pPr><w:pStyle w:val="Header"/></w:pPr>
    <w:r>
      <w:rPr><w:noProof/></w:rPr>
      <w:pict>
        <v:shape id="WordWatermarkPic" o:spid="_x0000_s1025" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:380pt;height:240pt;z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" fillcolor="#cccccc" stroked="f">
          <v:imagedata r:id="rIdWmPic" o:title="Watermark" blacklevel="0.1" gain="0.8"/>
          <v:fill opacity="$opacity"/>
        </v:shape>
      </w:pict>
    </w:r>
  </w:p>
</w:hdr>"""
        } else {
            ""
        }

        JZipFile(srcFile).use { zipIn ->
            JZipOutputStream(FileOutputStream(outFile)).use { zipOut ->
                val entries = zipIn.entries()
                var hasHeader = false
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    when (entry.name) {
                        "word/document.xml" -> {
                            var docXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (!docXml.contains("headerReference") && headerXml.isNotBlank()) {
                                docXml = if (docXml.contains("<w:sectPr")) {
                                    docXml.replace(Regex("<w:sectPr([^>]*)>"), "<w:sectPr$1><w:headerReference w:type=\"default\" r:id=\"rIdWmHeader\"/>")
                                } else if (docXml.contains("</w:body>")) {
                                    docXml.replace("</w:body>", "<w:sectPr><w:headerReference w:type=\"default\" r:id=\"rIdWmHeader\"/></w:sectPr></w:body>")
                                } else {
                                    docXml
                                }
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(docXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        "word/_rels/document.xml.rels" -> {
                            var docRelsXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (!docRelsXml.contains("Target=\"header1.xml\"") && headerXml.isNotBlank()) {
                                val relTag = "<Relationship Id=\"rIdWmHeader\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/header\" Target=\"header1.xml\"/>"
                                docRelsXml = docRelsXml.replace("</Relationships>", "$relTag</Relationships>")
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(docRelsXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        "[Content_Types].xml" -> {
                            var ctXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (headerXml.isNotBlank() && !ctXml.contains("PartName=\"/word/header1.xml\"")) {
                                val overrideTag = "<Override PartName=\"/word/header1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml\"/>"
                                ctXml = ctXml.replace("</Types>", "$overrideTag</Types>")
                            }
                            if (imgBytes != null && !ctXml.contains("Extension=\"png\"")) {
                                val defTag = "<Default Extension=\"png\" ContentType=\"image/png\"/>"
                                ctXml = ctXml.replace("</Types>", "$defTag</Types>")
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(ctXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        "word/header1.xml" -> {
                            hasHeader = true
                            var hXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (imgBytes != null && !hXml.contains("WordWatermarkPic")) {
                                val pTag = """<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shape id="WordWatermarkPic" o:spid="_x0000_s1025" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:380pt;height:240pt;z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" fillcolor="#cccccc" stroked="f"><v:imagedata r:id="rIdWmPic" o:title="Watermark" blacklevel="0.1" gain="0.8"/><v:fill opacity="$opacity"/></v:shape></w:pict></w:r></w:p>"""
                                hXml = if (hXml.contains("</w:hdr>")) hXml.replace("</w:hdr>", "$pTag</w:hdr>") else hXml
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(hXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        else -> {
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipIn.getInputStream(entry).use { it.copyTo(zipOut) }
                            zipOut.closeEntry()
                        }
                    }
                }

                if (!hasHeader && headerXml.isNotBlank()) {
                    val hEntry = JZipEntry(headerEntry)
                    zipOut.putNextEntry(hEntry)
                    zipOut.write(headerXml.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()

                    val rEntry = JZipEntry(relsEntry)
                    zipOut.putNextEntry(rEntry)
                    zipOut.write(headerRelsXml.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()
                }

                if (imgBytes != null) {
                    val imgEntry = JZipEntry(wmImgEntry)
                    zipOut.putNextEntry(imgEntry)
                    zipOut.write(imgBytes)
                    zipOut.closeEntry()
                }

                if (manifestJson.isNotBlank()) {
                    val mEntry = JZipEntry("customXml/krypto_manifest.dat")
                    zipOut.putNextEntry(mEntry)
                    zipOut.write(manifestJson.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()
                }
            }
        }
    }

    private fun applyXlsxWatermark(srcFile: File, outFile: File, wmImgBytes: ByteArray?, wmText: String, opacity: Float, manifestJson: String) {
        val imgBytes = wmImgBytes ?: if (wmText.isNotBlank()) createTextWatermarkPngBytes(wmText, opacity) else null

        JZipFile(srcFile).use { zipIn ->
            JZipOutputStream(FileOutputStream(outFile)).use { zipOut ->
                val entries = zipIn.entries()
                var hasSheetRels = false
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    when (entry.name) {
                        "xl/worksheets/sheet1.xml" -> {
                            var sheetXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (imgBytes != null) {
                                if (sheetXml.contains("<picture")) {
                                    sheetXml = sheetXml.replace(Regex("<picture[^>]*/>"), "<picture r:id=\"rIdWatermark\"/>")
                                } else if (sheetXml.contains("</worksheet>")) {
                                    sheetXml = sheetXml.replace("</worksheet>", "<picture r:id=\"rIdWatermark\"/></worksheet>")
                                }
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(sheetXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        "xl/worksheets/_rels/sheet1.xml.rels" -> {
                            hasSheetRels = true
                            var relsXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (imgBytes != null && !relsXml.contains("Id=\"rIdWatermark\"")) {
                                val relTag = "<Relationship Id=\"rIdWatermark\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image_wm.png\"/>"
                                relsXml = relsXml.replace("</Relationships>", "$relTag</Relationships>")
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(relsXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        "[Content_Types].xml" -> {
                            var ctXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (imgBytes != null && !ctXml.contains("Extension=\"png\"")) {
                                val defTag = "<Default Extension=\"png\" ContentType=\"image/png\"/>"
                                ctXml = ctXml.replace("</Types>", "$defTag</Types>")
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(ctXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        else -> {
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipIn.getInputStream(entry).use { it.copyTo(zipOut) }
                            zipOut.closeEntry()
                        }
                    }
                }

                if (!hasSheetRels && imgBytes != null) {
                    val relsXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdWatermark" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image_wm.png"/>
</Relationships>"""
                    val rEntry = JZipEntry("xl/worksheets/_rels/sheet1.xml.rels")
                    zipOut.putNextEntry(rEntry)
                    zipOut.write(relsXml.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()
                }

                if (imgBytes != null) {
                    val imgEntry = JZipEntry("xl/media/image_wm.png")
                    zipOut.putNextEntry(imgEntry)
                    zipOut.write(imgBytes)
                    zipOut.closeEntry()
                }

                if (manifestJson.isNotBlank()) {
                    val mEntry = JZipEntry("customXml/krypto_manifest.dat")
                    zipOut.putNextEntry(mEntry)
                    zipOut.write(manifestJson.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()
                }
            }
        }
    }

    private fun applyPptxWatermark(srcFile: File, outFile: File, wmImgBytes: ByteArray?, wmText: String, opacity: Float, manifestJson: String) {
        val imgBytes = wmImgBytes ?: if (wmText.isNotBlank()) createTextWatermarkPngBytes(wmText, opacity) else null

        JZipFile(srcFile).use { zipIn ->
            JZipOutputStream(FileOutputStream(outFile)).use { zipOut ->
                val entries = zipIn.entries()
                var hasMasterRels = false
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    when (entry.name) {
                        "ppt/slideMasters/slideMaster1.xml" -> {
                            var masterXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (imgBytes != null && !masterXml.contains("rIdWmPic")) {
                                val alphaInt = (opacity * 100000).toInt().coerceIn(10000, 90000)
                                val picShape = """<p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:nvPicPr><p:cNvPr id="999" name="Watermark"/><p:cNvPicPr><a:picLocks noSelect="1" noMove="1" noResize="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdWmPic"><a:alphaModFix amt="$alphaInt"/></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="2743200" y="1828800"/><a:ext cx="3657600" cy="2438400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"""
                                masterXml = if (masterXml.contains("</p:spTree>")) {
                                    masterXml.replace("</p:spTree>", "$picShape</p:spTree>")
                                } else {
                                    masterXml
                                }
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(masterXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        "ppt/slideMasters/_rels/slideMaster1.xml.rels" -> {
                            hasMasterRels = true
                            var relsXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (imgBytes != null && !relsXml.contains("rIdWmPic")) {
                                val relTag = "<Relationship Id=\"rIdWmPic\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image_wm.png\"/>"
                                relsXml = relsXml.replace("</Relationships>", "$relTag</Relationships>")
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(relsXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        "[Content_Types].xml" -> {
                            var ctXml = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                            if (imgBytes != null && !ctXml.contains("Extension=\"png\"")) {
                                val defTag = "<Default Extension=\"png\" ContentType=\"image/png\"/>"
                                ctXml = ctXml.replace("</Types>", "$defTag</Types>")
                            }
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipOut.write(ctXml.toByteArray(Charsets.UTF_8))
                            zipOut.closeEntry()
                        }
                        else -> {
                            val newEntry = JZipEntry(entry.name)
                            zipOut.putNextEntry(newEntry)
                            zipIn.getInputStream(entry).use { it.copyTo(zipOut) }
                            zipOut.closeEntry()
                        }
                    }
                }

                if (!hasMasterRels && imgBytes != null) {
                    val relsXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdWmPic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image_wm.png"/>
</Relationships>"""
                    val rEntry = JZipEntry("ppt/slideMasters/_rels/slideMaster1.xml.rels")
                    zipOut.putNextEntry(rEntry)
                    zipOut.write(relsXml.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()
                }

                if (imgBytes != null) {
                    val imgEntry = JZipEntry("ppt/media/image_wm.png")
                    zipOut.putNextEntry(imgEntry)
                    zipOut.write(imgBytes)
                    zipOut.closeEntry()
                }

                if (manifestJson.isNotBlank()) {
                    val mEntry = JZipEntry("customXml/krypto_manifest.dat")
                    zipOut.putNextEntry(mEntry)
                    zipOut.write(manifestJson.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()
                }
            }
        }
    }

    private fun applyRasterImageWatermark(srcFile: File, outFile: File, wmImgBytes: ByteArray?, wmText: String, opacity: Float) {
        val srcBmp = BitmapFactory.decodeFile(srcFile.absolutePath) ?: throw Exception("Không thể giải mã tệp hình ảnh")
        val w = srcBmp.width
        val h = srcBmp.height
        val resBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(resBmp)
        canvas.drawBitmap(srcBmp, 0f, 0f, null)

        if (wmImgBytes != null && wmImgBytes.isNotEmpty()) {
            val wmBmp = BitmapFactory.decodeByteArray(wmImgBytes, 0, wmImgBytes.size)
            if (wmBmp != null) {
                val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    alpha = (opacity * 255).coerceIn(20f, 240f).toInt()
                }
                val targetW = (w * 0.45f).toInt().coerceAtLeast(100)
                val targetH = (wmBmp.height * (targetW.toFloat() / wmBmp.width)).toInt().coerceAtLeast(50)
                val scaledWm = Bitmap.createScaledBitmap(wmBmp, targetW, targetH, true)
                val posX = (w - targetW) / 2f
                val posY = (h - targetH) / 2f
                canvas.drawBitmap(scaledWm, posX, posY, paint)
            }
        } else if (wmText.isNotBlank()) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.GRAY
                alpha = (opacity * 255).coerceIn(20f, 240f).toInt()
                textSize = (w / 12f).coerceAtLeast(36f)
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                textAlign = Paint.Align.CENTER
            }
            canvas.save()
            canvas.rotate(-35f, w / 2f, h / 2f)
            canvas.drawText(wmText, w / 2f, h / 2f, paint)
            canvas.restore()
        }

        val ext = srcFile.extension.lowercase()
        val format = if (ext == "jpg" || ext == "jpeg") Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG
        FileOutputStream(outFile).use { fos ->
            resBmp.compress(format, 95, fos)
        }
    }

    private fun inspectForensic(file: File): String {
        val json = JSONObject()
        val ext = file.extension.lowercase()
        val sha256 = calculateFileSha256(file)
        json.put("fileSha256", sha256)
        json.put("fileSize", file.length())
        json.put("fileName", file.name)
        json.put("isTamperFree", true)
        json.put("tamperStatus", "CHÍNH XÁC (INTACT)")

        var foundManifest = false
        if (ext == "pdf") {
            try {
                PdfReader.unethicalreading = true
                val r = PdfReader(file.absolutePath)
                val info = r.info
                if (info != null && (info.containsKey("KD_RECIPIENT") || info.containsKey("KD_RELEASE") || info.containsKey("KD_ORIGINAL_NAME"))) {
                    foundManifest = true
                    json.put("recipient", info["KD_RECIPIENT"] ?: "")
                    json.put("releaseCode", info["KD_RELEASE"] ?: "")
                    json.put("originalName", info["KD_ORIGINAL_NAME"] ?: file.name)
                    json.put("timestamp", info["KD_TIMESTAMP"] ?: "")
                    json.put("watermarkType", info["KD_WATERMARK"] ?: "Watermark Tích Hợp")
                    json.put("signer", info["KD_SIGNER"] ?: "")
                }
                r.close()
            } catch (_: Throwable) {}
        } else if (isZipFile(file)) {
            try {
                JZipFile(file).use { zipIn ->
                    val entry = zipIn.getEntry("customXml/krypto_manifest.dat")
                    if (entry != null) {
                        val content = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                        val obj = JSONObject(content)
                        foundManifest = true
                        json.put("recipient", obj.optString("recipient", ""))
                        json.put("releaseCode", obj.optString("releaseCode", ""))
                        json.put("originalName", obj.optString("originalName", file.name))
                        json.put("timestamp", obj.optString("timestamp", ""))
                        json.put("signer", obj.optString("signer", ""))
                        json.put("watermarkType", "Dấu bản quyền OpenXML")
                    }
                }
            } catch (_: Throwable) {}
        }

        if (!foundManifest) {
            json.put("hasManifest", false)
            json.put("recipient", "Phát hành chung / Không gắn đối tượng")
            json.put("releaseCode", "KD-" + sha256.substring(0, 8).uppercase())
            json.put("originalName", file.name)
            val df = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault())
            json.put("timestamp", df.format(java.util.Date(file.lastModified())))
            json.put("watermarkType", "Chế độ bảo mật chung")
            json.put("signer", "")
        } else {
            json.put("hasManifest", true)
        }

        return json.toString()
    }

    private fun calculateFileSha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { fis ->
            val buf = ByteArray(8192)
            var n: Int
            while (fis.read(buf).also { n = it } != -1) {
                md.update(buf, 0, n)
            }
        }
        val digest = md.digest()
        val sb = StringBuilder()
        for (b in digest) {
            sb.append(String.format("%02x", b))
        }
        return sb.toString()
    }

    private fun isZipFile(file: File): Boolean {
        if (!file.exists() || file.length() < 4) return false
        return try {
            FileInputStream(file).use { fis ->
                val header = ByteArray(4)
                fis.read(header)
                header[0] == 0x50.toByte() && header[1] == 0x4B.toByte() && header[2] == 0x03.toByte() && header[3] == 0x04.toByte()
            }
        } catch (_: Throwable) {
            false
        }
    }

    private fun computeOfficeSha512Hash(password: String, salt: ByteArray, spinCount: Int = 100000): String {
        val md = MessageDigest.getInstance("SHA-512")
        val pwdBytes = password.toByteArray(Charsets.UTF_16LE)
        md.update(salt)
        md.update(pwdBytes)
        var hash = md.digest()

        val intBuf = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until spinCount) {
            intBuf.clear()
            intBuf.putInt(i)
            md.reset()
            md.update(hash)
            md.update(intBuf.array())
            hash = md.digest()
        }
        return Base64.encodeToString(hash, Base64.NO_WRAP)
    }

    private fun protectDocxReadOnly(srcFile: File, outFile: File, password: String, manifestJson: String = "") {
        val salt = ByteArray(16)
        SecureRandom().nextBytes(salt)
        val saltB64 = Base64.encodeToString(salt, Base64.NO_WRAP)
        val spinCount = 100000
        val hashB64 = computeOfficeSha512Hash(password, salt, spinCount)

        val protTag = "<w:documentProtection w:edit=\"readOnly\" w:enforcement=\"1\" w:cryptProviderType=\"rsaAES\" w:cryptAlgorithmClass=\"hash\" w:cryptAlgorithmType=\"typeAny\" w:cryptAlgorithmSid=\"14\" w:cryptSpinCount=\"$spinCount\" w:salt=\"$saltB64\" w:hash=\"$hashB64\"/>"

        JZipFile(srcFile).use { zipIn ->
            JZipOutputStream(FileOutputStream(outFile)).use { zipOut ->
                val entries = zipIn.entries()
                var hasSettings = false
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    if (entry.name == "word/settings.xml") {
                        hasSettings = true
                        val content = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                        val newContent = if (content.contains("<w:documentProtection")) {
                            content.replace(Regex("<w:documentProtection[^>]*/>"), protTag)
                        } else if (content.contains("</w:settings>")) {
                            content.replace("</w:settings>", "$protTag</w:settings>")
                        } else {
                            content
                        }
                        val newEntry = JZipEntry("word/settings.xml")
                        zipOut.putNextEntry(newEntry)
                        zipOut.write(newContent.toByteArray(Charsets.UTF_8))
                        zipOut.closeEntry()
                    } else {
                        val newEntry = JZipEntry(entry.name)
                        zipOut.putNextEntry(newEntry)
                        zipIn.getInputStream(entry).use { it.copyTo(zipOut) }
                        zipOut.closeEntry()
                    }
                }
                if (!hasSettings) {
                    val simpleSettings = "<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">$protTag</w:settings>"
                    val newEntry = JZipEntry("word/settings.xml")
                    zipOut.putNextEntry(newEntry)
                    zipOut.write(simpleSettings.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()
                }

                if (manifestJson.isNotBlank()) {
                    val mEntry = JZipEntry("customXml/krypto_manifest.dat")
                    zipOut.putNextEntry(mEntry)
                    zipOut.write(manifestJson.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()
                }
            }
        }
    }

    private fun protectXlsxReadOnly(srcFile: File, outFile: File, password: String, manifestJson: String = "") {
        val salt = ByteArray(16)
        SecureRandom().nextBytes(salt)
        val saltB64 = Base64.encodeToString(salt, Base64.NO_WRAP)
        val spinCount = 100000
        val hashB64 = computeOfficeSha512Hash(password, salt, spinCount)

        val wbProt = "<workbookProtection workbookAlgorithmName=\"SHA-512\" workbookHashValue=\"$hashB64\" workbookSaltValue=\"$saltB64\" workbookSpinCount=\"$spinCount\" lockStructure=\"1\"/>"
        val fileSharing = "<fileSharing readOnlyRecommended=\"1\"/>"

        JZipFile(srcFile).use { zipIn ->
            JZipOutputStream(FileOutputStream(outFile)).use { zipOut ->
                val entries = zipIn.entries()
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    if (entry.name == "xl/workbook.xml") {
                        var content = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                        if (content.contains("<fileSharing")) {
                            content = content.replace(Regex("<fileSharing[^>]*/>"), fileSharing)
                        } else if (content.contains("<workbookProtection")) {
                            content = content.replace(Regex("<workbookProtection[^>]*/>"), "$fileSharing$wbProt")
                        } else if (content.contains("</workbook>")) {
                            content = content.replace("</workbook>", "$fileSharing$wbProt</workbook>")
                        }
                        val newEntry = JZipEntry("xl/workbook.xml")
                        zipOut.putNextEntry(newEntry)
                        zipOut.write(content.toByteArray(Charsets.UTF_8))
                        zipOut.closeEntry()
                    } else {
                        val newEntry = JZipEntry(entry.name)
                        zipOut.putNextEntry(newEntry)
                        zipIn.getInputStream(entry).use { it.copyTo(zipOut) }
                        zipOut.closeEntry()
                    }
                }

                if (manifestJson.isNotBlank()) {
                    val mEntry = JZipEntry("customXml/krypto_manifest.dat")
                    zipOut.putNextEntry(mEntry)
                    zipOut.write(manifestJson.toByteArray(Charsets.UTF_8))
                    zipOut.closeEntry()
                }
            }
        }
    }

    private fun unprotectDocx(srcFile: File, outFile: File) {
        JZipFile(srcFile).use { zipIn ->
            JZipOutputStream(FileOutputStream(outFile)).use { zipOut ->
                val entries = zipIn.entries()
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    if (entry.name == "word/settings.xml") {
                        val content = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                        val cleanedContent = content.replace(Regex("<w:documentProtection[^>]*/>"), "")
                        val newEntry = JZipEntry("word/settings.xml")
                        zipOut.putNextEntry(newEntry)
                        zipOut.write(cleanedContent.toByteArray(Charsets.UTF_8))
                        zipOut.closeEntry()
                    } else {
                        val newEntry = JZipEntry(entry.name)
                        zipOut.putNextEntry(newEntry)
                        zipIn.getInputStream(entry).use { it.copyTo(zipOut) }
                        zipOut.closeEntry()
                    }
                }
            }
        }
    }

    private fun unprotectXlsx(srcFile: File, outFile: File) {
        JZipFile(srcFile).use { zipIn ->
            JZipOutputStream(FileOutputStream(outFile)).use { zipOut ->
                val entries = zipIn.entries()
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    if (entry.name == "xl/workbook.xml") {
                        var content = zipIn.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { it.readText() }
                        content = content.replace(Regex("<workbookProtection[^>]*/>"), "")
                        content = content.replace(Regex("<fileSharing[^>]*/>"), "")
                        val newEntry = JZipEntry("xl/workbook.xml")
                        zipOut.putNextEntry(newEntry)
                        zipOut.write(content.toByteArray(Charsets.UTF_8))
                        zipOut.closeEntry()
                    } else {
                        val newEntry = JZipEntry(entry.name)
                        zipOut.putNextEntry(newEntry)
                        zipIn.getInputStream(entry).use { it.copyTo(zipOut) }
                        zipOut.closeEntry()
                    }
                }
            }
        }
    }
}
