package com.securedoc.share

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import com.itextpdf.text.pdf.PdfReader
import com.itextpdf.text.pdf.PdfStamper
import com.itextpdf.text.pdf.PdfWriter
import java.io.File
import java.io.FileOutputStream
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
                            // Direct disk random access - 0 RAM heap memory spike!
                            reader = PdfReader(srcPath)

                            val outFile = File(destPath)
                            if (outFile.exists()) outFile.delete()
                            outFile.parentFile?.mkdirs()
                            fos = FileOutputStream(outFile)

                            stamper = PdfStamper(reader, fos)

                            val userPwd = if (isViewOnly) ByteArray(0) else password.toByteArray(Charsets.UTF_8)
                            val ownerPwd = password.toByteArray(Charsets.UTF_8)
                            val permissions = if (isViewOnly) {
                                PdfWriter.ALLOW_SCREENREADERS
                            } else {
                                PdfWriter.ALLOW_PRINTING or PdfWriter.ALLOW_COPY or PdfWriter.ALLOW_SCREENREADERS or PdfWriter.ALLOW_FILL_IN
                            }

                            // RC4 128-bit ISO 32000 standard (Streamed directly to disk, compatible with all PDF readers)
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
                else -> result.notImplemented()
            }
        }
    }
}
