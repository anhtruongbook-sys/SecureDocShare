@echo off
chcp 65001 > nul
title SecureDocShare - Ứng Dụng Mã Hóa Tài Liệu Cấp Quân Sự
echo ==============================================================================
echo    SECUREDOCSHARE - ỨNG DỤNG MÃ HÓA TÀI LIỆU CẤP QUÂN SỰ CHỐNG BẺ KHÓA
echo    Bảo vệ PDF, Word, Excel, PowerPoint truyền qua mạng Internet
echo ==============================================================================
cd /d "%~dp0"
python run_app.py
pause
