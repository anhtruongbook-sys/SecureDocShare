import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Cầu nối Native Flutter <-> JavaScript (`ChatVaultNativeBridge`)
/// Giải quyết 2 bài toán cốt lõi trên Android:
/// 1. Vượt rào chắn CORS của WebView và cho phép gắn Header `User-Agent` Android YouTube
///    để tải toàn văn phụ đề XML TimedText (47KB+).
/// 2. Sao lưu kép (Dual-Mirror Persistence) ra cả thư mục nội bộ App lẫn thư mục
///    Download/ChatKnowledgeVault bền vững trên thiết bị — đảm bảo KHI CÀI LẠI APP KHÔNG MẤT DỮ LIỆU.
class ChatVaultNativeBridge {
  final WebViewController controller;

  ChatVaultNativeBridge(this.controller);

  /// Đăng ký JavaScriptChannel vào WebViewController
  void register() {
    controller.addJavaScriptChannel(
      'ChatVaultNativeBridge',
      onMessageReceived: (JavaScriptMessage message) async {
        await _handleJsMessage(message.message);
      },
    );
  }

  Future<void> _handleJsMessage(String rawJson) async {
    String reqId = '';
    try {
      final Map<String, dynamic> payload = jsonDecode(rawJson);
      reqId = (payload['reqId'] ?? '').toString();
      final String action = (payload['action'] ?? '').toString();

      if (action == 'httpRequest') {
        final String data = await _performNativeHttp(payload);
        await _sendResponse(reqId, ok: true, data: data);
      } else if (action == 'savePersistentBackup') {
        final String backupJson = (payload['backupJson'] ?? '').toString();
        final String savedPath = await _saveMirrorBackup(backupJson);
        await _sendResponse(reqId, ok: true, data: savedPath);
      } else if (action == 'loadPersistentBackup') {
        final String? restoredJson = await _loadMirrorBackup();
        await _sendResponse(reqId, ok: true, data: restoredJson);
      } else {
        await _sendResponse(reqId, ok: false, error: 'Unknown action: $action');
      }
    } catch (e) {
      if (reqId.isNotEmpty) {
        await _sendResponse(reqId, ok: false, error: e.toString());
      }
    }
  }

  /// Thực thi HTTP GET/POST từ tầng Native Dart (không bị chặn CORS, hỗ trợ đổi User-Agent)
  Future<String> _performNativeHttp(Map<String, dynamic> payload) async {
    final String url = payload['url'].toString();
    final String method = (payload['method'] ?? 'GET').toString().toUpperCase();
    final Map<String, dynamic> headers =
        (payload['headers'] as Map<String, dynamic>?) ?? {};
    final String? body = payload['body']?.toString();

    final HttpClient client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 15);
    try {
      final Uri uri = Uri.parse(url);
      final HttpClientRequest request =
          method == 'POST' ? await client.postUrl(uri) : await client.getUrl(uri);

      // Gắn đầy đủ Header tùy chỉnh (bao gồm User-Agent Android YouTube Innertube)
      headers.forEach((key, value) {
        if (key.toLowerCase() == 'user-agent') {
          request.headers.set(HttpHeaders.userAgentHeader, value.toString());
        } else {
          request.headers.set(key, value.toString());
        }
      });

      if (body != null && body.isNotEmpty) {
        final List<int> utf8Bytes = utf8.encode(body);
        request.contentLength = utf8Bytes.length;
        request.add(utf8Bytes);
      }

      final HttpClientResponse response = await request.close();
      return await response.transform(utf8.decoder).join();
    } finally {
      client.close();
    }
  }

  /// Lưu đồng thời vào 2 nơi:
  /// 1. ApplicationDocumentsDirectory (dùng cho cập nhật In-place Update).
  /// 2. Thư mục chung `/storage/emulated/0/Download/ChatKnowledgeVault/vault_master_backup.json`
  ///    (Tồn tại vĩnh viễn ngay cả khi gỡ cài đặt App rồi cài lại mới).
  Future<String> _saveMirrorBackup(String backupJson) async {
    final Directory appDocDir = await getApplicationDocumentsDirectory();
    final File internalFile =
        File('${appDocDir.path}/vault_master_backup.json');
    await internalFile.writeAsString(backupJson, flush: true);

    try {
      final Directory publicDir =
          Directory('/storage/emulated/0/Download/ChatKnowledgeVault');
      if (!await publicDir.exists()) {
        await publicDir.create(recursive: true);
      }
      final File externalFile =
          File('${publicDir.path}/vault_master_backup.json');
      await externalFile.writeAsString(backupJson, flush: true);
      return externalFile.path;
    } catch (_) {
      return internalFile.path;
    }
  }

  /// Tự động tìm và khôi phục dữ liệu khi mở App sau khi cài đặt lại
  Future<String?> _loadMirrorBackup() async {
    try {
      final File externalFile = File(
          '/storage/emulated/0/Download/ChatKnowledgeVault/vault_master_backup.json');
      if (await externalFile.exists()) {
        final String content = await externalFile.readAsString();
        if (content.trim().isNotEmpty) return content;
      }
    } catch (_) {}

    try {
      final Directory appDocDir = await getApplicationDocumentsDirectory();
      final File internalFile =
          File('${appDocDir.path}/vault_master_backup.json');
      if (await internalFile.exists()) {
        final String content = await internalFile.readAsString();
        if (content.trim().isNotEmpty) return content;
      }
    } catch (_) {}

    return null;
  }

  Future<void> _sendResponse(
    String reqId, {
    required bool ok,
    dynamic data,
    String? error,
  }) async {
    final String jsonPayload = jsonEncode({
      'reqId': reqId,
      'ok': ok,
      'data': data,
      'error': error,
    });
    final String escaped = jsonEncode(jsonPayload);
    await controller.runJavaScript(
      'window.__onChatVaultNativeResponse && window.__onChatVaultNativeResponse($escaped);',
    );
  }
}
