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
            final fileName = data['name'] as String? ?? 'SecureDoc_Protected.html';

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
              // 1. Mở hộp thoại chọn thư mục lưu tệp native của Android (Storage Access Framework)
              String? outputFilePath;
              try {
                outputFilePath = await FilePicker.platform.saveFile(
                  dialogTitle: 'Chọn nơi lưu tệp $fileName',
                  fileName: fileName,
                  bytes: bytesToSave,
                );
              } catch (e) {
                debugPrint('FilePicker.saveFile error: $e');
              }

              if (outputFilePath != null && outputFilePath.isNotEmpty) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Row(
                        children: [
                          const Icon(Icons.check_circle_rounded, color: Color(0xFF10B981), size: 24),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              '✓ Đã lưu thành công vào điện thoại:\n$fileName',
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
                      duration: const Duration(seconds: 4),
                    ),
                  );
                }
              } else {
                // 2. Fallback: Nếu không chọn được từ SAF, tự ghi vào thư mục Downloads hoặc kích hoạt Share Sheet
                bool wrotePublic = false;
                try {
                  final dlDir = Directory('/storage/emulated/0/Download');
                  if (await dlDir.exists()) {
                    final target = File('${dlDir.path}/$fileName');
                    await target.writeAsBytes(bytesToSave);
                    wrotePublic = true;
                  }
                } catch (_) {}

                if (wrotePublic && mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('✓ Đã lưu tệp vào mục Tải về (Downloads):\n$fileName'),
                      backgroundColor: const Color(0xFF10B981),
                      behavior: SnackBarBehavior.floating,
                      margin: const EdgeInsets.all(16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  );
                } else {
                  // Mở Share Sheet để người dùng bấm "Lưu vào Tệp" hoặc gửi Zalo/Drive
                  await Share.shareXFiles(
                    [XFile(tempFile.path)],
                    text: 'Lưu tệp bảo mật $fileName',
                  );
                }
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
