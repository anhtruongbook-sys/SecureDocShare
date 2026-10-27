# -*- coding: utf-8 -*-
"""
handwritten_sig_processor.py: BỘ XỬ LÝ ẢNH CHỮ KÝ TAY (.PNG TRONG SUỐT) & KẾT XUẤT MẪU CHỮ KÝ HÀNH CHÍNH
Dự án: Nghiên cứu Chữ ký số Cá nhân Chuẩn HSM & Tích hợp Krypto (SecureDocShare)

Tính năng kỹ thuật cốt lõi:
1. Khử bóng nền giấy chụp bằng điện thoại (Adaptive Illumination Normalization).
2. Tách nền trong suốt mượt ở viền nét bút (Continuous Alpha Matting, 0..255).
3. Chuẩn hóa màu mực hành chính:
   - Xanh cửu long chuẩn hành chính (#003399 / RGB: 0, 51, 153)
   - Xanh biếc (#004CB4)
   - Đen tuyền (#0F0F0F)
   - Đỏ tươi con dấu (#C00000)
4. Tự động cắt sát khung bao (Auto-Bounding-Box Crop) và căn lề tiêu chuẩn.
5. Tự động sinh ảnh chữ ký tay mẫu vector/bezier sắc nét khi người dùng chưa có ảnh chụp sẵn.
6. Tính toán mã băm mật mã SHA-256 (VisualSignatureImageHash) để khóa chặt vào chứng thư số X.509v3 trong HSM.
"""

import io
import os
import math
import hashlib
import base64
from typing import Tuple, Optional, Dict, Any
from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageFont


INK_COLOR_PRESETS: Dict[str, Tuple[int, int, int]] = {
    "administrative_blue": (0, 51, 153),   # Xanh cửu long chuẩn hành chính (#003399)
    "royal_blue": (0, 76, 180),            # Xanh biếc tươi (#004CB4)
    "carbon_black": (15, 15, 15),          # Đen mực bút ký (#0F0F0F)
    "seal_red": (192, 0, 0),               # Đỏ tươi con dấu (#C00000)
}


class HandwrittenSignatureProcessor:
    """Bộ xử lý ảnh chữ ký tay (.PNG nền trong suốt) gắn kết với buồng HSM."""

    @staticmethod
    def compute_image_sha256(png_bytes: bytes) -> str:
        """Tính mã băm SHA-256 dạng hex (64 ký tự) của tệp ảnh chữ ký tay PNG."""
        return hashlib.sha256(png_bytes).hexdigest()

    @classmethod
    def process_raw_signature_image(
        cls,
        image_input: bytes | str,
        ink_preset: str = "administrative_blue",
        custom_rgb: Optional[Tuple[int, int, int]] = None,
        target_height: int = 240,
        padding_ratio: float = 0.06,
        stroke_boost: float = 1.35
    ) -> Dict[str, Any]:
        """
        Tách nền trong suốt 100%, khử bóng đổ nền giấy và chuẩn hóa màu mực từ ảnh chụp chữ ký tay.

        Tham số:
        - image_input: Đường dẫn file ảnh hoặc chuỗi bytes (PNG/JPG/WEBP).
        - ink_preset: Mã màu mực chuẩn ('administrative_blue', 'royal_blue', 'carbon_black', 'seal_red').
        - target_height: Chiều cao chuẩn hóa sau khi cắt sát (mặc định 240px sắc nét).
        """
        if isinstance(image_input, str):
            with open(image_input, "rb") as f:
                raw_bytes = f.read()
        else:
            raw_bytes = image_input

        src_img = Image.open(io.BytesIO(raw_bytes))
        ink_rgb = custom_rgb if custom_rgb else INK_COLOR_PRESETS.get(ink_preset, (0, 51, 153))

        # Nếu ảnh đầu vào đã có kênh Alpha trong suốt thực sự, sử dụng kết hợp kênh Alpha và độ tối
        has_real_alpha = False
        if src_img.mode in ("RGBA", "LA") or (src_img.mode == "P" and "transparency" in src_img.info):
            rgba_img = src_img.convert("RGBA")
            alpha_extrema = rgba_img.getchannel("A").getextrema()
            if alpha_extrema and alpha_extrema[0] < 240:
                has_real_alpha = True

        if has_real_alpha:
            rgba_img = src_img.convert("RGBA")
            r_ch, g_ch, b_ch, a_ch = rgba_img.split()
            gray = ImageOps.grayscale(rgba_img)
            # Kết hợp độ tối và alpha sẵn có
            a_data = a_ch.getdata()
            g_data = gray.getdata()
            new_alpha = []
            for a_val, g_val in zip(a_data, g_data):
                if a_val < 15:
                    new_alpha.append(0)
                else:
                    # Nếu là nét vẽ trên nền trong suốt, giữ nguyên độ đậm alpha
                    darkness = 255 - g_val
                    combined = max(a_val if g_val < 235 else int(a_val * (darkness / 255.0)), 0)
                    boosted = min(255, int(combined * stroke_boost))
                    new_alpha.append(boosted if boosted > 18 else 0)
            alpha_mask = Image.new("L", rgba_img.size)
            alpha_mask.putdata(new_alpha)
        else:
            # Ảnh chụp trên giấy trắng/xám (JPG/PNG không trong suốt)
            # Bước 1: Chuyển sang Grayscale
            gray = src_img.convert("L")
            # Bước 2: Ước lượng mặt phẳng chiếu sáng nền giấy bằng Gaussian Blur bán kính lớn
            blur_radius = max(15, min(gray.width, gray.height) // 12)
            bg_illumination = gray.filter(ImageFilter.GaussianBlur(radius=blur_radius))

            # Bước 3: Tính độ chênh lệch tương đối giữa nét mực và nền giấy cục bộ
            g_bytes = gray.tobytes()
            b_bytes = bg_illumination.tobytes()
            alpha_vals = bytearray(len(g_bytes))

            for i in range(len(g_bytes)):
                bg_v = max(b_bytes[i], 30)
                px_v = g_bytes[i]
                # Độ sẫm tương đối so với nền giấy tại điểm đó
                diff = bg_v - px_v
                if diff <= 14:
                    alpha_vals[i] = 0
                else:
                    # Chuẩn hóa mượt (Soft Knee Alpha Matting)
                    norm = (diff - 14) / max(1.0, (bg_v * 0.55))
                    val = int(min(255.0, norm * 255.0 * stroke_boost))
                    alpha_vals[i] = val if val > 20 else 0

            alpha_mask = Image.frombytes("L", gray.size, bytes(alpha_vals))

        # Bước 4: Tự động cắt sát khung bao (Bounding Box) của nét chữ ký
        bbox = alpha_mask.getbbox()
        if bbox:
            alpha_cropped = alpha_mask.crop(bbox)
        else:
            alpha_cropped = alpha_mask

        # Bước 5: Chuẩn hóa kích thước và thêm lề đệm (Padding)
        cw, ch = alpha_cropped.size
        if ch > 0 and cw > 0:
            scale = target_height / float(ch)
            new_w = max(80, int(cw * scale))
            new_h = max(40, int(ch * scale))
            alpha_resized = alpha_cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
        else:
            alpha_resized = alpha_cropped
            new_w, new_h = alpha_resized.size

        pad_x = max(8, int(new_w * padding_ratio))
        pad_y = max(6, int(new_h * padding_ratio))
        final_w = new_w + pad_x * 2
        final_h = new_h + pad_y * 2

        final_alpha = Image.new("L", (final_w, final_h), 0)
        final_alpha.paste(alpha_resized, (pad_x, pad_y))

        # Bước 6: Phủ màu mực chuẩn hành chính lên toàn bộ nét bút
        r_img = Image.new("L", (final_w, final_h), ink_rgb[0])
        g_img = Image.new("L", (final_w, final_h), ink_rgb[1])
        b_img = Image.new("L", (final_w, final_h), ink_rgb[2])

        final_rgba = Image.merge("RGBA", (r_img, g_img, b_img, final_alpha))

        out_buf = io.BytesIO()
        final_rgba.save(out_buf, format="PNG", optimize=True)
        png_bytes = out_buf.getvalue()
        img_hash = cls.compute_image_sha256(png_bytes)

        return {
            "png_bytes": png_bytes,
            "base64_data_url": "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii"),
            "sha256_hash": img_hash,
            "width": final_w,
            "height": final_h,
            "ink_rgb": ink_rgb,
            "ink_hex": "#{:02X}{:02X}{:02X}".format(*ink_rgb),
        }

    @classmethod
    def generate_stylized_handwritten_signature(
        cls,
        signer_name: str = "Nguyễn Văn A",
        ink_preset: str = "administrative_blue",
        width: int = 640,
        height: int = 240
    ) -> Dict[str, Any]:
        """
        Tạo ảnh chữ ký tay mẫu mượt mà (Bezier Calligraphic Stroke Simulation) trên nền trong suốt
        để người dùng có thể thử nghiệm ngay hoặc dùng làm chữ ký mặc định khi chưa tải ảnh chụp.
        """
        # Vẽ ở độ phân giải gấp đôi (2x Supersampling) để khử răng cưa hoàn toàn
        ss = 2
        w2, h2 = width * ss, height * ss
        canvas = Image.new("RGBA", (w2, h2), (0, 0, 0, 0))
        draw = ImageDraw.Draw(canvas)
        ink_rgb = INK_COLOR_PRESETS.get(ink_preset, (0, 51, 153))

        # Sinh quỹ đạo nét bút ký đặc trưng dựa trên băm tên người ký (nhất quán 100% cho cùng 1 tên)
        seed_bytes = hashlib.sha256(signer_name.encode("utf-8")).digest()

        def _cubic_bezier(p0, p1, p2, p3, steps=90):
            pts = []
            for i in range(steps + 1):
                t = i / float(steps)
                mt = 1.0 - t
                x = (mt**3)*p0[0] + 3*(mt**2)*t*p1[0] + 3*mt*(t**2)*p2[0] + (t**3)*p3[0]
                y = (mt**3)*p0[1] + 3*(mt**2)*t*p1[1] + 3*mt*(t**2)*p2[1] + (t**3)*p3[1]
                pts.append((x, y))
            return pts

        def _draw_calligraphic_curve(pts, base_thickness=7.0, alpha_max=248):
            n = len(pts)
            for i in range(n - 1):
                prog = i / float(max(1, n - 1))
                # Áp lực bút tự nhiên: đầu nét thanh, giữa nét đậm, cuối nét vuốt nhọn
                pressure = math.sin(prog * math.pi) ** 0.65
                w_stroke = max(2.2, base_thickness * ss * (0.38 + 0.85 * pressure))
                x0, y0 = pts[i]
                x1, y1 = pts[i + 1]
                r = w_stroke / 2.0
                color = (ink_rgb[0], ink_rgb[1], ink_rgb[2], int(alpha_max * (0.75 + 0.25 * pressure)))
                draw.line([(x0, y0), (x1, y1)], fill=color, width=int(w_stroke))
                draw.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=color)

        # Nét 1: Vòng lượn chữ cái đầu mạnh mẽ (Capital Flourish Loop)
        s0 = (seed_bytes[0] % 30) - 15
        s1 = (seed_bytes[1] % 30) - 15
        loop1 = _cubic_bezier(
            (w2 * 0.14, h2 * 0.68 + s0),
            (w2 * 0.05, h2 * 0.12 + s1),
            (w2 * 0.34, h2 * 0.08 - s0),
            (w2 * 0.23, h2 * 0.78),
            steps=110
        )
        _draw_calligraphic_curve(loop1, base_thickness=5.2)

        # Nét 2: Thân chữ ký liên hoàn (Cursive Body Wave)
        loop2 = _cubic_bezier(
            (w2 * 0.23, h2 * 0.78),
            (w2 * 0.30, h2 * 0.25 + s1),
            (w2 * 0.42, h2 * 0.82 - s0),
            (w2 * 0.52, h2 * 0.38),
            steps=100
        )
        _draw_calligraphic_curve(loop2, base_thickness=4.6)

        loop3 = _cubic_bezier(
            (w2 * 0.52, h2 * 0.38),
            (w2 * 0.58, h2 * 0.76),
            (w2 * 0.66, h2 * 0.28 + s0),
            (w2 * 0.76, h2 * 0.56),
            steps=90
        )
        _draw_calligraphic_curve(loop3, base_thickness=4.2)

        # Nét 3: Đường gạch chân vuốt xéo dứt khoát đặc trưng chữ ký lãnh đạo (Signature Underline Flourish)
        flourish = _cubic_bezier(
            (w2 * 0.76, h2 * 0.56),
            (w2 * 0.88, h2 * 0.48),
            (w2 * 0.22, h2 * 0.92),
            (w2 * 0.89, h2 * 0.66 - abs(s0)),
            steps=130
        )
        _draw_calligraphic_curve(flourish, base_thickness=4.8)

        # Nếu có font nghiêng trên Windows, chèn thêm tên viết tay mảnh tinh tế phía trên đường gạch
        try:
            font_paths = [
                r"C:\Windows\Fonts\segoeprb.ttf",
                r"C:\Windows\Fonts\segoepr.ttf",
                r"C:\Windows\Fonts\timesbi.ttf",
            ]
            selected_font = None
            for fp in font_paths:
                if os.path.exists(fp):
                    selected_font = ImageFont.truetype(fp, int(36 * ss))
                    break
            if selected_font:
                short_name = signer_name.split()[-1] if signer_name.strip() else "Sign"
                draw.text(
                    (int(w2 * 0.36), int(h2 * 0.32)),
                    short_name,
                    font=selected_font,
                    fill=(ink_rgb[0], ink_rgb[1], ink_rgb[2], 235)
                )
        except Exception:
            pass

        # Thu nhỏ về kích thước chuẩn (Supersampling Downscale)
        smooth_img = canvas.resize((width, height), Image.Resampling.LANCZOS)
        out_buf = io.BytesIO()
        smooth_img.save(out_buf, format="PNG", optimize=True)
        return cls.process_raw_signature_image(
            out_buf.getvalue(),
            ink_preset=ink_preset,
            target_height=200,
            stroke_boost=1.05
        )
