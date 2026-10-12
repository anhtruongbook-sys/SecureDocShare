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
import java.util.concurrent.Executors

class MainActivity: FlutterActivity() {
    private val CHANNEL = "com.securedoc.share/native_engine"
    private val executor = Executors.newSingleThreadExecutor()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "encryptPdf" -> {
                    val srcPath = call.argument<String>("srcPath")
                    val destPath = call.argument<String>("destPath")
                    val password = call.argument<String>("password") ?: ""
                    val isViewOnly = call.argument<Boolean>("isViewOnly") ?: false
                    val watermark = call.argument<String>("watermark") ?: ""
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

                            if (watermark.isNotBlank()) {
                                try {
                                    val baseFont = BaseFont.createFont(BaseFont.HELVETICA_BOLD, BaseFont.WINANSI, BaseFont.NOT_EMBEDDED)
                                    val gState = PdfGState()
                                    gState.setFillOpacity(0.18f)

                                    val totalPages = reader.numberOfPages
                                    for (p in 1..totalPages) {
                                        val over = stamper.getOverContent(p)
                                        val rect = reader.getPageSizeWithRotation(p)
                                        over.saveState()
                                        over.setGState(gState)
                                        over.beginText()
                                        over.setFontAndSize(baseFont, 38f)
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
                                    }
                                } catch (_: Throwable) {}
                            }

                            val userPwd = if (isViewOnly) ByteArray(0) else password.toByteArray(Charsets.UTF_8)
                            val ownerPwd = password.toByteArray(Charsets.UTF_8)
                            val permissions = if (isViewOnly) {
                                PdfWriter.ALLOW_SCREENREADERS
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
                            reader = PdfReader(srcPath, password.toByteArray(Charsets.UTF_8))

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
                            } catch (_: Throwable) {
                                // Tệp Office bình thường (chưa mã hóa) sẽ không phải OLE EncryptedPackage
                            }

                            // Thực hiện mã hóa Office Native (thử Standard trước: 100% binary, tương thích hoàn hảo Word/Excel Android)
                            var encryptSuccess = false
                            var lastError: Throwable? = null

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
                                encryptSuccess = true
                            } catch (eStd: Throwable) {
                                lastError = eStd
                                try {
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
                                    encryptSuccess = true
                                } catch (eAgile: Throwable) {
                                    lastError = eAgile
                                }
                            }

                            if (!encryptSuccess) {
                                throw lastError ?: Exception("Không thể mã hóa Office Native")
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

                            POIFSFileSystem(srcFile).use { fs ->
                                val info = EncryptionInfo(fs)
                                val decryptor = info.decryptor
                                if (!decryptor.verifyPassword(password)) {
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

                    if (zipPath == null || destDirPath == null) {
                        result.error("INVALID_ARGS", "Missing zipPath or destDirPath", null)
                        return@setMethodCallHandler
                    }

                    executor.execute {
                        try {
                            val zipFile = ZipFile(zipPath, password.toCharArray())
                            if (!zipFile.isValidZipFile) {
                                runOnUiThread { result.error("INVALID_ZIP", "Tệp không phải định dạng ZIP hợp lệ!", null) }
                                return@execute
                            }

                            val outDir = File(destDirPath)
                            outDir.mkdirs()

                            zipFile.extractAll(destDirPath)

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
                else -> result.notImplemented()
            }
        }
    }
}
