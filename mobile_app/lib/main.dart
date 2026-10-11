import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:file_picker/file_picker.dart';
import 'package:share_plus/share_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:syncfusion_flutter_pdf/pdf.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF090D16),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const SecureDocApp());
}

class SecureDocApp extends StatelessWidget {
  const SecureDocApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SecureDocShare',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF090D16),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF3B82F6),
          secondary: Color(0xFF10B981),
          surface: Color(0xFF111827),
        ),
      ),
      home: const SecureDocWebViewScreen(),
    );
  }
}

class SecureDocWebViewScreen extends StatefulWidget {
  const SecureDocWebViewScreen({super.key});

  @override
  State<SecureDocWebViewScreen> createState() => _SecureDocWebViewScreenState();
}

class _SecureDocWebViewScreenState extends State<SecureDocWebViewScreen> {
  late final WebViewController _controller;
  bool _isLoading = true;
  final Map<String, String> _cachedFilePaths = {};

  @override
  void initState() {
    super.initState();
    _initController();
  }

  void _initController() async {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF090D16))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (String url) {
            setState(() => _isLoading = true);
          },
          onPageFinished: (String url) {
            setState(() => _isLoading = false);
          },
          onWebResourceError: (WebResourceError error) {
            debugPrint('WebView Error: ${error.description}');
          },
        ),
      )
      ..addJavaScriptChannel(
        'FlutterBridge',
        onMessageReceived: (JavaScriptMessage message) async {
          try {
            final data = jsonDecode(message.message) as Map<String, dynamic>;
            final action = data['action'] as String? ?? 'save';
            final fileName = data['name'] as String? ?? 'document';
            final password = data['password'] as String? ?? '';
            final protectionLevel = data['protection_level'] as String? ?? 'open_password';
            final isViewOnly = (protectionLevel == 'view_only_restricted');

            // -----------------------------------------------------------------
            // CHỨC NĂNG 1: MÃ HÓA PDF NATIVE CHUẨN ADOBE ISO 32000 (R6 AES-256)
            // -----------------------------------------------------------------
            if (action == 'lock_pdf_native') {
              Uint8List pdfBytes;
              if (_cachedFilePaths.containsKey(fileName)) {
                final fileOnDisk = File(_cachedFilePaths[fileName]!);
                if (await fileOnDisk.exists()) {
                  pdfBytes = await fileOnDisk.readAsBytes();
                } else if (data.containsKey('base64')) {
                  pdfBytes = base64Decode(data['base64'] as String);
                } else {
                  throw Exception('Không tìm thấy tệp PDF nguồn trên thiết bị');
                }
              } else if (data.containsKey('base64')) {
                pdfBytes = base64Decode(data['base64'] as String);
              } else {
                throw Exception('Không tìm thấy dữ liệu tệp PDF nguồn');
              }

              // Khởi tạo tài liệu và cấu hình mã hóa chuẩn Adobe
              final PdfDocument document = PdfDocument(inputBytes: pdfBytes);
              if (isViewOnly) {
                document.security.ownerPassword = password;
                document.security.userPassword = '';
                document.security.algorithm = PdfEncryptionAlgorithm.aesx256BitRevision6;
                document.security.permissions.clear(); // CẤM IN, CẤM COPY CHỮ
              } else {
                document.security.userPassword = password;
                document.security.ownerPassword = password;
                document.security.algorithm = PdfEncryptionAlgorithm.aesx256BitRevision6;
              }

              final List<int> securedBytes = document.save();
              document.dispose();
              final Uint8List outBytes = Uint8List.fromList(securedBytes);

              final baseName = fileName.replaceAll(RegExp(r'\.[^/.]+$'), '');
              final outFileName = isViewOnly ? '${baseName}_ReadOnly.pdf' : '${baseName}_Locked.pdf';

              final tempDir = await getTemporaryDirectory();
              final tempFile = File('${tempDir.path}/$outFileName');
              await tempFile.writeAsBytes(outBytes);

              // Mở hộp thoại chọn thư mục lưu tệp PDF (SAF Native)
              try {
                await FilePicker.platform.saveFile(
                  dialogTitle: 'Chọn nơi lưu tệp PDF bảo mật: $outFileName',
                  fileName: outFileName,
                  bytes: outBytes,
                );
              } catch (e) {
                debugPrint('FilePicker.saveFile error: $e');
              }

              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Row(
                      children: [
                        const Icon(Icons.check_circle_rounded, color: Color(0xFF10B981), size: 24),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            '✓ Đã tạo xong tệp PDF Native chuẩn Adobe:\n$outFileName',
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
                          ),
                        ),
                      ],
                    ),
                    backgroundColor: const Color(0xFF1E293B),
                    behavior: SnackBarBehavior.floating,
                    margin: const EdgeInsets.all(16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: const BorderSide(color: Color(0xFF10B981), width: 1.5),
                    ),
                    duration: const Duration(seconds: 5),
                  ),
                );
              }

              // Thông báo kết quả cho giao diện WebView
              final escapedName = outFileName.replaceAll("'", r"\'");
              final escapedTempPath = tempFile.path.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              await _controller.runJavaScript("if (window.onNativePdfLocked) { window.onNativePdfLocked('$escapedName', '$escapedTempPath'); }");
              return;
            }

            // Chia sẻ tệp PDF vừa tạo
            if (action == 'share_temp_file') {
              final filePath = data['path'] as String?;
              if (filePath != null && await File(filePath).exists()) {
                await Share.shareXFiles(
                  [XFile(filePath)],
                  text: 'Tài liệu PDF bảo mật chuẩn Adobe: $fileName',
                );
              }
              return;
            }

            // Lưu lại tệp
            if (action == 'save_file_again') {
              final filePath = data['path'] as String?;
              if (filePath != null && await File(filePath).exists()) {
                final bytes = await File(filePath).readAsBytes();
                await FilePicker.platform.saveFile(
                  dialogTitle: 'Chọn nơi lưu tệp $fileName',
                  fileName: fileName,
                  bytes: bytes,
                );
              }
              return;
            }

            // -----------------------------------------------------------------
            // CHỨC NĂNG 2: XỬ LÝ LƯU & CHIA SẺ FILE HTML / BINARY
            // -----------------------------------------------------------------
            Uint8List bytesToSave;
            if (data.containsKey('base64')) {
              bytesToSave = base64Decode(data['base64'] as String);
            } else {
              bytesToSave = Uint8List.fromList(utf8.encode(data['content'] as String? ?? ''));
            }

            final tempDir = await getTemporaryDirectory();
            final tempFile = File('${tempDir.path}/$fileName');
            await tempFile.writeAsBytes(bytesToSave);

            if (action == 'share' || action == 'share_binary') {
              await Share.shareXFiles(
                [XFile(tempFile.path)],
                text: 'Tài liệu bảo mật $fileName (SecureDocShare)',
              );
            } else if (action == 'save' || action == 'save_binary') {
              try {
                await FilePicker.platform.saveFile(
                  dialogTitle: 'Chọn nơi lưu tệp $fileName',
                  fileName: fileName,
                  bytes: bytesToSave,
                );
              } catch (e) {
                debugPrint('FilePicker.saveFile error: $e');
              }

              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('✓ Đã xử lý lưu tệp: $fileName'),
                    backgroundColor: const Color(0xFF10B981),
                    behavior: SnackBarBehavior.floating,
                    margin: const EdgeInsets.all(16),
                  ),
                );
              }
            }
          } catch (e) {
            debugPrint('FlutterBridge error: $e');
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Lỗi: $e'),
                  backgroundColor: Colors.redAccent,
                  behavior: SnackBarBehavior.floating,
                ),
              );
            }
          }
        },
      );

    if (Platform.isAndroid) {
      final androidController = _controller.platform as AndroidWebViewController;
      await androidController.setOnShowFileSelector((FileSelectorParams params) async {
        final allowMultiple = params.mode == FileSelectorMode.openMultiple;
        try {
          final result = await FilePicker.platform.pickFiles(
            allowMultiple: allowMultiple,
            type: FileType.any,
          );
          if (result != null && result.files.isNotEmpty) {
            for (final f in result.files) {
              if (f.name.isNotEmpty && f.path != null) {
                _cachedFilePaths[f.name] = f.path!;
              }
            }
            return result.files
                .where((f) => f.path != null)
                .map((f) => Uri.file(f.path!).toString())
                .toList();
          }
        } catch (e) {
          debugPrint('setOnShowFileSelector error: $e');
        }
        return [];
      });
    }

    await _controller.loadFlutterAsset('assets/www/index.html');
  }

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      onWillPop: () async {
        if (await _controller.canGoBack()) {
          _controller.goBack();
          return false;
        }
        return true;
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              WebViewWidget(controller: _controller),
              if (_isLoading)
                const Center(
                  child: CircularProgressIndicator(
                    color: Color(0xFF3B82F6),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
