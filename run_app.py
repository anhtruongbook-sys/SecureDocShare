# -*- coding: utf-8 -*-
"""
run_app.py: SCRIPT KHỞI ĐỘNG ỨNG DỤNG SECUREDOCSHARE VÀ TỰ ĐỘNG MỞ TRÌNH DUYỆT
Dự án: SecureDocShare
"""

import sys
import time
import socket
import webbrowser
import threading
import uvicorn

# Thiết lập UTF-8 cho console Windows
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def find_free_port(default_port: int = 8088) -> int:
    """Tìm cổng mạng khả dụng để khởi chạy máy chủ."""
    for port in range(default_port, default_port + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return default_port


def open_browser(url: str):
    """Mở trình duyệt sau khi máy chủ đã khởi động hoàn tất."""
    time.sleep(1.2)
    print(f"\n[*] Đang tự động mở trình duyệt: {url}")
    webbrowser.open(url)


def main():
    port = find_free_port(8088)
    url = f"http://127.0.0.1:{port}"

    print("=" * 75)
    print("   SECUREDOCSHARE - ỨNG DỤNG MÃ HÓA TÀI LIỆU CẤP QUÂN SỰ CHỐNG BẺ KHÓA")
    print(f"   Địa chỉ truy cập: {url}")
    print("=" * 75)

    # Khởi chạy tiểu trình mở trình duyệt
    threading.Thread(target=open_browser, args=(url,), daemon=True).start()

    # Chạy Uvicorn server
    uvicorn.run("app:app", host="127.0.0.1", port=port, log_level="info", reload=False)


if __name__ == "__main__":
    main()
