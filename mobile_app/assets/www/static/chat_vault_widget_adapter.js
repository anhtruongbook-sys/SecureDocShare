/**
 * CHAT VAULT WIDGET ADAPTER v1.2 (BILINGUAL VI DEFAULT + AUTO SHARE INTENT)
 * -------------------------------------------------------------------------
 * Cầu nối giao diện 1-dòng-lệnh (`ChatVaultAdapter.mount('#container', options)`)
 * tích hợp Kho Lưu Trữ & Tra Cứu Tri Thức Chat (YouTube / GitHub / Web / Ghi chú) vào ứng dụng Krypto.
 * - Mặc định hiển thị Tiếng Việt ('vi'), hỗ trợ chuyển đổi 1 chạm sang Tiếng Anh ('en').
 * - Tự động nhận diện và bóc tách ngay lập tức khi người dùng bấm Chia sẻ (Share) từ Zalo/YouTube sang Krypto.
 * - Tuân thủ nghiêm ngặt Rule 14 (Single-Level Card & Borderless Mobile Table Cells).
 */

(function (global) {
  'use strict';

  // Hàng đợi toàn cục đảm bảo Share Intent đến trước khi mount() hoàn tất vẫn được xử lý 100%
  let activeShareHandler = null;
  let lastHandledShareText = '';
  let lastHandledShareTime = 0;

  global.onReceiveSharedContent = function (sharedText) {
    if (!sharedText || !String(sharedText).trim()) return;
    const cleaned = String(sharedText).trim();
    if (cleaned === lastHandledShareText && (Date.now() - lastHandledShareTime < 4000)) {
      return;
    }
    global.__kryptoHandlingShare = Date.now();
    const lockGate = document.getElementById('cyber-lock-gate');
    if (lockGate) lockGate.style.display = 'none';
    global.__pendingSharedLink = cleaned;
    if (typeof activeShareHandler === 'function') {
      activeShareHandler(cleaned);
    } else if (typeof global.switchTab === 'function') {
      global.switchTab('knowledge');
    }
  };

  function injectScopedStyles() {
    if (document.getElementById('chat-vault-scoped-css')) return;
    const style = document.createElement('style');
    style.id = 'chat-vault-scoped-css';
    style.textContent = `
      .cv-root-wrap {
        background: transparent !important;
        border: none !important;
        padding: 0 !important;
        box-shadow: none !important;
        color: var(--cv-text, #f1f5f9);
        font-family: inherit;
      }
      body.light-mode .cv-root-wrap,
      body.theme-light .cv-root-wrap,
      .cv-root-wrap.cv-light {
        --cv-bg-card: #ffffff;
        --cv-bg-input: #f8fafc;
        --cv-text: #0f172a;
        --cv-muted: #475569;
        --cv-border: #cbd5e1;
        --cv-accent: #0284c7;
      }
      body.dark-mode .cv-root-wrap {
        --cv-bg-card: #131b2e;
        --cv-bg-input: #0b0f19;
        --cv-text: #f1f5f9;
        --cv-muted: #94a3b8;
        --cv-border: #232f48;
        --cv-accent: #38bdf8;
      }
      .cv-single-card {
        background-color: var(--cv-bg-card);
        border: 1px solid var(--cv-border);
        border-radius: 14px;
        padding: 15px 16px;
        margin-bottom: 14px;
        box-shadow: var(--shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.05));
      }
      .cv-divider-section {
        border: none !important;
        border-top: 1px dashed var(--cv-border) !important;
        border-radius: 0 !important;
        background: transparent !important;
        padding: 12px 0 !important;
        margin-top: 12px;
      }
      .cv-input {
        width: 100%;
        padding: 9px 11px;
        border: 1px solid var(--cv-border);
        border-radius: 8px;
        background-color: var(--cv-bg-input);
        color: var(--cv-text);
        font-size: 12.5px;
        box-sizing: border-box;
      }
      .cv-input:focus {
        outline: none;
        border-color: var(--cv-accent);
      }
      .cv-grid-3 {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr;
        gap: 8px;
        margin-top: 8px;
      }
      .cv-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid transparent;
        background-color: var(--cv-accent);
        color: #ffffff;
        font-weight: 700;
        font-size: 11.5px;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
      }
      .cv-btn:active {
        transform: scale(0.96);
      }
      .cv-btn-outline {
        background-color: transparent;
        border-color: var(--cv-border);
        color: var(--cv-text);
      }
      .cv-btn-danger {
        background-color: rgba(239, 68, 68, 0.12);
        border-color: rgba(239, 68, 68, 0.35);
        color: #ef4444;
      }
      .cv-lang-switch {
        display: inline-flex;
        border: 1px solid var(--cv-border);
        border-radius: 8px;
        overflow: hidden;
        background: var(--cv-bg-input);
      }
      .cv-lang-btn {
        border: none;
        background: transparent;
        color: var(--cv-muted);
        font-size: 11px;
        font-weight: 700;
        padding: 5px 9px;
        cursor: pointer;
        white-space: nowrap;
      }
      .cv-lang-btn.active {
        background: var(--cv-accent);
        color: #ffffff;
      }
      .cv-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 6px;
        font-size: 10.5px;
        font-weight: 700;
        color: #ffffff;
        background-color: #ef4444;
        white-space: nowrap;
      }
      .cv-badge.youtube_video { background-color: #ef4444; }
      .cv-badge.github_repo { background-color: #8b5cf6; }
      .cv-badge.web_article { background-color: #10b981; }
      .cv-badge.chat_note, .cv-badge.file_attachment { background-color: #3b82f6; }
      .cv-stats-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 10px;
      }
      .cv-stat-pill {
        font-size: 11px;
        font-weight: 600;
        padding: 4px 9px;
        border-radius: 16px;
        background: var(--cv-bg-input);
        border: 1px solid var(--cv-border);
        color: var(--cv-muted);
      }
      .cv-stat-pill strong {
        color: var(--cv-text);
      }
      .cv-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }
      .cv-table th,
      .cv-table td {
        padding: 10px 8px;
        text-align: left;
        border-bottom: 1px solid var(--cv-border);
        vertical-align: top;
        font-size: 12px;
      }
      body.light-mode .cv-table td,
      body.theme-light .cv-table td {
        border-color: #cbd5e1 !important;
      }
      @media (max-width: 680px) {
        .cv-grid-3 {
          grid-template-columns: 1fr;
        }
        .cv-table thead {
          display: none !important;
        }
        .cv-table, .cv-table tbody, .cv-table tr, .cv-table td {
          display: block !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        .cv-table tr {
          padding: 14px 16px !important;
          border: 1px solid var(--cv-border) !important;
          border-radius: 10px !important;
          margin-bottom: 10px !important;
          background: var(--cv-bg-card) !important;
        }
        .cv-table td,
        body.light-mode .cv-table td,
        body.theme-light .cv-table td {
          border: none !important;
          border-bottom: 1px dashed var(--cv-border) !important;
          padding: 8px 0 !important;
          display: flex !important;
          justify-content: space-between !important;
          align-items: flex-start !important;
          gap: 10px !important;
        }
        .cv-table td:last-child,
        body.light-mode .cv-table td:last-child,
        body.theme-light .cv-table td:last-child {
          border-bottom: none !important;
        }
        .cv-table td::before {
          content: attr(data-label);
          font-weight: 600;
          color: var(--cv-muted);
          font-size: 11px;
          flex-shrink: 0;
        }
        .table-cell-val {
          text-align: right;
          word-break: break-word;
          font-size: 12px;
          color: var(--cv-text);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTypeLabel(rtype) {
    const map = {
      youtube_video: '▶ YouTube',
      github_repo: '📦 GitHub',
      web_article: '🌐 Web',
      chat_note: '💬 Ghi chú',
      file_attachment: '📎 Tệp tin'
    };
    return map[rtype] || rtype;
  }

  function notifyUser(msg) {
    if (typeof global.showToast === 'function') {
      global.showToast(msg);
    }
  }

  function saveTextFileNativeOrWeb(fileName, contentStr, mimeType) {
    if (global.FlutterBridge && typeof global.FlutterBridge.postMessage === 'function') {
      global.FlutterBridge.postMessage(JSON.stringify({
        action: 'save',
        name: fileName,
        content: contentStr
      }));
      notifyUser(`✓ Đã lưu tệp ${fileName} vào thư mục Downloads`);
      return;
    }
    const blob = new Blob([contentStr], { type: mimeType || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    notifyUser(`✓ Đã xuất tệp ${fileName}`);
  }

  const ChatVaultAdapter = {
    async mount(selectorOrElement, options = {}) {
      injectScopedStyles();
      const container = typeof selectorOrElement === 'string'
        ? document.querySelector(selectorOrElement)
        : selectorOrElement;
      if (!container) throw new Error('Không tìm thấy phần tử đích để gắn ChatVaultAdapter');

      const defaultSender = options.defaultSender || 'User';
      const defaultGroup = options.defaultGroup || 'Zalo / R&D';
      let currentLang = global.localStorage.getItem('CHAT_VAULT_LANG') || 'vi';
      if (currentLang !== 'vi' && currentLang !== 'en') currentLang = 'vi';
      let currentDetailIdx = -1;

      container.innerHTML = `
        <div class="cv-root-wrap">
          <div class="cv-single-card">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
              <div>
                <h3 style="margin:0; font-size:14.5px; font-weight:800; color:var(--cv-text);">🧠 Kho Lưu Trữ & Tra Cứu Tri Thức Chat</h3>
                <p style="margin:2px 0 0; font-size:11px; color:var(--cv-muted);">Tự động bóc tách & dịch Tiếng Việt phụ đề YouTube [mm:ss], GitHub, Web</p>
              </div>
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <div class="cv-lang-switch" title="Chọn ngôn ngữ hiển thị (Mặc định: Tiếng Việt)">
                  <button type="button" class="cv-lang-btn ${currentLang === 'vi' ? 'active' : ''}" data-lang="vi">🇻🇳 Tiếng Việt</button>
                  <button type="button" class="cv-lang-btn ${currentLang === 'en' ? 'active' : ''}" data-lang="en">🇬🇧 English</button>
                </div>
                <button type="button" class="cv-btn cv-btn-outline" id="cvBtnExport" title="Xuất toàn bộ CSDL ra file .json">💾 Sao lưu</button>
                <button type="button" class="cv-btn cv-btn-outline" id="cvBtnImport" title="Khôi phục từ file .json">📂 Khôi phục</button>
                <input type="file" id="cvFileImport" accept=".json" style="display:none;" />
              </div>
            </div>

            <textarea id="cvInputRaw" class="cv-input" rows="2" placeholder="Dán link YouTube (https://youtu.be/...), GitHub, bài báo hoặc chia sẻ trực tiếp từ Zalo/YouTube sang Krypto..."></textarea>
            <div class="cv-grid-3">
              <input id="cvInputNote" class="cv-input" type="text" placeholder="Ghi chú ngữ cảnh chia sẻ (tùy chọn)..." />
              <input id="cvInputSender" class="cv-input" type="text" value="${escapeHtml(defaultSender)}" placeholder="Người chia sẻ" />
              <input id="cvInputGroup" class="cv-input" type="text" value="${escapeHtml(defaultGroup)}" placeholder="Nhóm chat / Dự án" />
            </div>
            <div style="margin-top:10px; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
              <button type="button" id="cvBtnSave" class="cv-btn" style="flex:1; min-width:200px;">⚡ Tự Động Bóc Tách & Dịch Lưu Kho</button>
              <button type="button" id="cvBtnPaste" class="cv-btn cv-btn-outline" title="Dán nhanh từ bộ nhớ tạm">📋 Dán Nhanh</button>
            </div>
            <div id="cvStatus" style="margin-top:6px; font-size:11.5px; font-weight:600; color:var(--cv-accent); min-height:16px;"></div>
          </div>

          <div class="cv-single-card">
            <div class="cv-stats-row" id="cvStatsRow"></div>

            <div class="cv-grid-3" style="margin-top:0;">
              <input id="cvSearchInput" class="cv-input" type="text" placeholder="🔍 Tìm từ khóa (Tiếng Việt có dấu/không dấu, Tiếng Anh, [mm:ss])..." />
              <select id="cvFilterType" class="cv-input">
                <option value="">-- Tất cả Loại nguồn --</option>
                <option value="youtube_video">▶ YouTube Idea Card</option>
                <option value="github_repo">📦 GitHub Repository</option>
                <option value="web_article">🌐 Bài viết Web</option>
                <option value="chat_note">💬 Ghi chú Chat</option>
              </select>
              <select id="cvFilterCat" class="cv-input">
                <option value="">-- Tất cả Danh mục --</option>
                <option value="Công nghệ, Lập trình & AI">Công nghệ, Lập trình & AI</option>
                <option value="Pháp lý & Tiêu chuẩn Xây dựng">Pháp lý & Tiêu chuẩn Xây dựng</option>
                <option value="BIM & Kỹ thuật Công trình">BIM & Kỹ thuật Công trình</option>
                <option value="Tài chính, Đầu tư & Kinh tế">Tài chính, Đầu tư & Kinh tế</option>
                <option value="Huyền học & Phong thủy">Huyền học & Phong thủy</option>
                <option value="Quản trị & Phương pháp Nghiên cứu">Quản trị & Phương pháp Nghiên cứu</option>
                <option value="Tri thức Tổng hợp">Tri thức Tổng hợp</option>
              </select>
            </div>

            <div id="cvDetailBox" class="cv-divider-section" style="display:none;"></div>

            <table class="cv-table">
              <thead>
                <tr>
                  <th>Loại</th>
                  <th>Tiêu đề, Tóm tắt & Mốc khớp từ khóa</th>
                  <th>Danh mục</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody id="cvTableBody"></tbody>
            </table>
          </div>
        </div>
      `;

      let currentResults = [];

      function syncLangButtonsUI() {
        container.querySelectorAll('.cv-lang-btn').forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLang);
        });
      }

      async function setLanguage(lang) {
        currentLang = (lang === 'en') ? 'en' : 'vi';
        global.localStorage.setItem('CHAT_VAULT_LANG', currentLang);
        syncLangButtonsUI();
        await refreshList();
        if (currentDetailIdx >= 0 && currentDetailIdx < currentResults.length) {
          showDetail(currentDetailIdx, false);
        }
        notifyUser(currentLang === 'vi' ? '🇻🇳 Đã chuyển sang hiển thị Tiếng Việt' : '🇬🇧 Switched to English view');
      }

      container.querySelectorAll('.cv-lang-btn').forEach(btn => {
        btn.addEventListener('click', () => setLanguage(btn.getAttribute('data-lang')));
      });

      await global.ChatVaultEngine.init();

      async function updateStatsBar() {
        const allItems = await global.ChatVaultEngine.getAllItems();
        const ytCount = allItems.filter(x => x.resource_type === 'youtube_video').length;
        const ghCount = allItems.filter(x => x.resource_type === 'github_repo').length;
        const otherCount = allItems.length - ytCount - ghCount;
        const statsRow = container.querySelector('#cvStatsRow');
        if (statsRow) {
          statsRow.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              <span class="cv-stat-pill">Tổng kho: <strong>${allItems.length}</strong></span>
              <span class="cv-stat-pill">▶ YouTube: <strong>${ytCount}</strong></span>
              <span class="cv-stat-pill">📦 GitHub: <strong>${ghCount}</strong></span>
              <span class="cv-stat-pill">🌐 Web/Ghi chú: <strong>${otherCount}</strong></span>
            </div>
            <span style="font-size:11px; color:var(--cv-accent); font-weight:700;">
              Ngôn ngữ: ${currentLang === 'vi' ? '🇻🇳 Tiếng Việt (Mặc định)' : '🇬🇧 English (Original)'}
            </span>
          `;
        }
      }

      async function refreshList() {
        await updateStatsBar();
        const query = container.querySelector('#cvSearchInput').value;
        const resourceType = container.querySelector('#cvFilterType').value;
        const category = container.querySelector('#cvFilterCat').value;
        const rawResults = await global.ChatVaultEngine.searchVault({ query, resourceType, category });
        currentResults = rawResults.map(r => global.ChatVaultEngine.getLocalizedRecord(r, currentLang));

        const tbody = container.querySelector('#cvTableBody');
        if (!currentResults.length) {
          tbody.innerHTML = `<tr><td colspan="4" data-label="Trạng thái"><span class="table-cell-val">Chưa có bản ghi nào khớp điều kiện tra cứu.</span></td></tr>`;
          return;
        }

        tbody.innerHTML = currentResults.map((item, idx) => {
          const meta = item.metadata || {};
          const tax = item.taxonomy || {};
          const summ = item.summary || {};
          const ctx = item.chat_context || {};
          const tagsHtml = (tax.tags || []).slice(0, 5).map(t => `<span style="display:inline-block; font-size:10px; padding:1px 6px; border-radius:4px; background:var(--cv-bg-input); border:1px solid var(--cv-border); margin-left:4px; color:var(--cv-muted);">#${escapeHtml(t)}</span>`).join('');
          const hits = (item.matched_transcript_segments || []).map(s => {
            const u = item.resource_type === 'youtube_video' ? `${meta.url}&t=${s.start_seconds || 0}s` : meta.url;
            return `<div style="font-size:11px; margin-top:5px; color:var(--cv-muted); text-align:left;"><a href="${escapeHtml(u)}" target="_blank" style="color:var(--cv-accent); font-family:monospace; font-weight:700;">[${escapeHtml(s.timestamp)}]</a> ${escapeHtml(s.text)}</div>`;
          }).join('');

          return `
            <tr>
              <td data-label="Loại"><span class="table-cell-val"><span class="cv-badge ${escapeHtml(item.resource_type)}">${escapeHtml(formatTypeLabel(item.resource_type))}</span></span></td>
              <td data-label="Nội dung">
                <span class="table-cell-val">
                  <div style="font-weight:700; font-size:12.5px; color:var(--cv-text);">${escapeHtml(meta.title)}</div>
                  <div style="font-size:11px; color:var(--cv-muted); margin-top:2px;">${escapeHtml(meta.channel || '')} • ${escapeHtml(meta.duration || '')} • Chia sẻ bởi: <strong>${escapeHtml(ctx.shared_by || 'User')}</strong> (${escapeHtml(ctx.chat_group || 'General')})</div>
                  <div style="font-size:11.5px; color:var(--cv-muted); margin-top:4px;">${escapeHtml(summ.one_liner)}</div>
                  <div style="margin-top:4px;">${tagsHtml}</div>
                  ${hits}
                </span>
              </td>
              <td data-label="Danh mục"><span class="table-cell-val">${escapeHtml(tax.category)}</span></td>
              <td data-label="Thao tác">
                <span class="table-cell-val">
                  <button type="button" class="cv-btn" data-idx="${idx}" style="padding:5px 10px; font-size:11px;">👁️ Chi tiết</button>
                </span>
              </td>
            </tr>
          `;
        }).join('');

        tbody.querySelectorAll('button[data-idx]').forEach(btn => {
          btn.addEventListener('click', () => showDetail(Number(btn.getAttribute('data-idx')), true));
        });
      }

      function showDetail(idx, shouldScroll = true) {
        const item = currentResults[idx];
        if (!item) return;
        currentDetailIdx = idx;
        const meta = item.metadata || {};
        const ctx = item.chat_context || {};
        const summ = item.summary || {};
        const wis = item.wisdom_distillation || {};
        const tl = item.timeline || {};
        const box = container.querySelector('#cvDetailBox');
        const baseUrl = meta.url || '#';
        const isYt = item.resource_type === 'youtube_video';

        const ideasHtml = (wis.core_ideas || []).map(c => {
          const link = isYt ? `${baseUrl}&t=${c.seconds || 0}s` : baseUrl;
          return `<li style="padding:5px 0; border-bottom:1px dashed var(--cv-border);"><a href="${escapeHtml(link)}" target="_blank" style="color:var(--cv-accent); font-family:monospace; font-weight:700;">[${escapeHtml(c.timestamp)}]</a> ${c.chapter ? `<strong>[${escapeHtml(c.chapter)}]</strong> ` : ''}${escapeHtml(c.content)}</li>`;
        }).join('');

        const insightsHtml = (wis.key_insights || []).map(k => {
          const link = isYt ? `${baseUrl}&t=${k.seconds || 0}s` : baseUrl;
          return `<li style="padding:4px 0;"><a href="${escapeHtml(link)}" target="_blank" style="color:var(--cv-accent); font-family:monospace; font-weight:700;">[${escapeHtml(k.timestamp)}]</a> ${escapeHtml(k.content)}</li>`;
        }).join('');

        const chaptersHtml = (tl.chapters || []).map(ch => {
          const link = isYt ? `${baseUrl}&t=${ch.seconds || 0}s` : baseUrl;
          return `<a href="${escapeHtml(link)}" target="_blank" style="display:inline-block; font-size:11px; padding:3px 8px; border-radius:6px; background:var(--cv-bg-input); border:1px solid var(--cv-border); color:var(--cv-accent); text-decoration:none; margin:2px;">[${escapeHtml(ch.timestamp)}] ${escapeHtml(ch.title)}</a>`;
        }).join('');

        box.style.display = 'block';
        box.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
            <div style="flex:1; min-width:200px;">
              <h4 style="margin:0; font-size:13.5px; color:var(--cv-text);">${escapeHtml(meta.title)}</h4>
              <div style="font-size:11px; color:var(--cv-muted); margin-top:3px;">
                Nguồn: <a href="${escapeHtml(baseUrl)}" target="_blank" style="color:var(--cv-accent); word-break:break-all;">${escapeHtml(baseUrl)}</a>
                • Ghi chú: <em>"${escapeHtml(ctx.sender_note || '')}"</em>
              </div>
            </div>
            <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
              <div class="cv-lang-switch">
                <button type="button" class="cv-lang-btn ${currentLang === 'vi' ? 'active' : ''}" id="cvDetailLangVi">🇻🇳 VI</button>
                <button type="button" class="cv-lang-btn ${currentLang === 'en' ? 'active' : ''}" id="cvDetailLangEn">🇬🇧 EN</button>
              </div>
              <button type="button" class="cv-btn cv-btn-outline" id="cvCopyMd" style="padding:5px 9px; font-size:11px;">📋 Copy Thẻ</button>
              <button type="button" class="cv-btn cv-btn-outline" id="cvExportMd" style="padding:5px 9px; font-size:11px;">📝 Xuất (.md)</button>
              <button type="button" class="cv-btn cv-btn-danger" id="cvDeleteRecord" style="padding:5px 9px; font-size:11px;">🗑️ Xóa</button>
              <button type="button" class="cv-btn cv-btn-outline" id="cvCloseDetail" style="padding:5px 9px; font-size:11px;">✕ Đóng</button>
            </div>
          </div>

          <p style="font-size:12px; line-height:1.5; margin:8px 0; color:var(--cv-text);">${escapeHtml(summ.executive_summary)}</p>

          ${chaptersHtml ? `<div style="margin:8px 0;"><div style="font-size:11px; font-weight:700; color:var(--cv-muted); margin-bottom:4px;">⏱️ CHƯƠNG MỤC THỜI GIAN (CHẠM ĐỂ MỞ ĐÚNG GIÂY):</div>${chaptersHtml}</div>` : ''}

          <div style="margin-top:8px;">
            <div style="font-size:11px; font-weight:700; color:var(--cv-muted);">💡 LUẬN ĐIỂM CỐT LÕI (CORE IDEAS):</div>
            <ul style="list-style:none; padding-left:0; margin:4px 0 0; font-size:12px; line-height:1.45;">${ideasHtml || '<li>(Không có dữ liệu)</li>'}</ul>
          </div>

          ${insightsHtml ? `<div style="margin-top:8px;"><div style="font-size:11px; font-weight:700; color:var(--cv-muted);">🔑 ĐÚC KẾT SÂU (KEY INSIGHTS):</div><ul style="list-style:none; padding-left:0; margin:4px 0 0; font-size:12px; line-height:1.45;">${insightsHtml}</ul></div>` : ''}
        `;

        box.querySelector('#cvDetailLangVi').addEventListener('click', () => setLanguage('vi'));
        box.querySelector('#cvDetailLangEn').addEventListener('click', () => setLanguage('en'));

        box.querySelector('#cvCloseDetail').addEventListener('click', () => {
          box.style.display = 'none';
          currentDetailIdx = -1;
        });

        box.querySelector('#cvCopyMd').addEventListener('click', async () => {
          const mdText = global.ChatVaultEngine.exportIdeaCardMarkdown(item);
          try {
            await navigator.clipboard.writeText(mdText);
            notifyUser('📋 Đã sao chép toàn bộ Thẻ Tri Thức (Markdown) vào bộ nhớ tạm!');
          } catch (_) {
            notifyUser('⚠️ Không thể truy cập bộ nhớ tạm.');
          }
        });

        box.querySelector('#cvExportMd').addEventListener('click', () => {
          const mdText = global.ChatVaultEngine.exportIdeaCardMarkdown(item);
          saveTextFileNativeOrWeb(`${item.id}_${currentLang}_idea_card.md`, mdText, 'text/markdown;charset=utf-8');
        });

        box.querySelector('#cvDeleteRecord').addEventListener('click', async () => {
          await global.ChatVaultEngine.deleteRecord(item.id);
          box.style.display = 'none';
          currentDetailIdx = -1;
          notifyUser('🗑️ Đã xóa bản ghi khỏi Kho Tri Thức');
          await refreshList();
        });

        if (shouldScroll) {
          box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      async function executeSaveInput(autoOpenDetail = true) {
        const raw = container.querySelector('#cvInputRaw').value.trim();
        const note = container.querySelector('#cvInputNote').value.trim();
        const sender = container.querySelector('#cvInputSender').value.trim();
        const group = container.querySelector('#cvInputGroup').value.trim();
        const status = container.querySelector('#cvStatus');

        if (!raw) {
          status.textContent = '⚠️ Vui lòng nhập đường dẫn YouTube, GitHub, Web hoặc nội dung ghi chú.';
          return;
        }
        status.textContent = '⏳ Đang tự động bóc tách phụ đề, chắt lọc ý tưởng & dịch sang Tiếng Việt...';
        try {
          const rec = await global.ChatVaultEngine.ingestAndSave(raw, {
            senderNote: note,
            sharedBy: sender,
            chatGroup: group
          });
          const localizedRec = global.ChatVaultEngine.getLocalizedRecord(rec, currentLang);
          status.textContent = `✓ Đã lưu (${currentLang.toUpperCase()}): ${localizedRec.metadata.title}`;
          notifyUser(`✓ Đã bóc tách & lưu: ${localizedRec.metadata.title}`);
          container.querySelector('#cvInputRaw').value = '';
          container.querySelector('#cvInputNote').value = '';
          container.querySelector('#cvSearchInput').value = '';
          container.querySelector('#cvFilterType').value = '';
          container.querySelector('#cvFilterCat').value = '';
          await refreshList();
          if (autoOpenDetail) {
            const foundIdx = currentResults.findIndex(x => x.id === rec.id);
            if (foundIdx !== -1) {
              showDetail(foundIdx, true);
            }
          }
          if (typeof options.onItemSaved === 'function') options.onItemSaved(rec);
        } catch (err) {
          status.textContent = '❌ Lỗi: ' + err.message;
        }
      }

      container.querySelector('#cvBtnPaste').addEventListener('click', async () => {
        try {
          const txt = await navigator.clipboard.readText();
          if (txt && txt.trim()) {
            container.querySelector('#cvInputRaw').value = txt.trim();
            notifyUser('📋 Đã dán nội dung từ bộ nhớ tạm');
          } else {
            notifyUser('⚠️ Bộ nhớ tạm đang trống');
          }
        } catch (_) {
          notifyUser('⚠️ Vui lòng chạm giữ vào ô nhập liệu và chọn Dán (Paste)');
        }
      });

      container.querySelector('#cvBtnSave').addEventListener('click', () => executeSaveInput(true));
      container.querySelector('#cvSearchInput').addEventListener('input', refreshList);
      container.querySelector('#cvFilterType').addEventListener('change', refreshList);
      container.querySelector('#cvFilterCat').addEventListener('change', refreshList);

      // Sao lưu & Khôi phục JSON
      container.querySelector('#cvBtnExport').addEventListener('click', async () => {
        const jsonStr = await global.ChatVaultEngine.exportFullBackupJson();
        const fileName = `chat_vault_backup_${new Date().toISOString().slice(0, 10)}.json`;
        saveTextFileNativeOrWeb(fileName, jsonStr, 'application/json;charset=utf-8');
      });

      const fileImp = container.querySelector('#cvFileImport');
      container.querySelector('#cvBtnImport').addEventListener('click', () => fileImp.click());
      fileImp.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const count = await global.ChatVaultEngine.importFullBackupJson(text);
        container.querySelector('#cvStatus').textContent = `✓ Đã khôi phục ${count} bản ghi thành công!`;
        notifyUser(`✓ Đã khôi phục ${count} bản ghi vào Kho Tri Thức!`);
        await refreshList();
      });

      // Xử lý tự động ngay lập tức khi nhận link chia sẻ từ Android Share Intent (Zalo/YouTube -> Krypto)
      activeShareHandler = async function (sharedText) {
        if (!sharedText || !String(sharedText).trim()) return;
        const cleaned = String(sharedText).trim();
        if (cleaned === lastHandledShareText && (Date.now() - lastHandledShareTime < 4000)) {
          return;
        }
        lastHandledShareText = cleaned;
        lastHandledShareTime = Date.now();
        global.__kryptoHandlingShare = Date.now();
        global.__pendingSharedLink = null;

        // Mở khóa màn hình cổng PIN (nếu đang che) để hiển thị ngay tiến trình bóc tách link chia sẻ
        const lockGate = document.getElementById('cyber-lock-gate');
        if (lockGate) lockGate.style.display = 'none';
        if (typeof global.switchTab === 'function') {
          global.switchTab('knowledge');
        }

        container.querySelector('#cvInputRaw').value = cleaned;
        container.querySelector('#cvInputNote').value = 'Chia sẻ trực tiếp sang Krypto';
        notifyUser('⏳ Đang tự động bóc tách liên kết vừa chia sẻ...');
        await executeSaveInput(true);
      };

      await refreshList();

      // Nếu có link được chia sẻ đến trong lúc app đang khởi động -> xử lý tự động ngay lập tức!
      if (global.__pendingSharedLink) {
        const pending = global.__pendingSharedLink;
        global.__pendingSharedLink = null;
        setTimeout(() => activeShareHandler(pending), 100);
      }

      return { refreshList, setLanguage };
    }
  };

  global.ChatVaultAdapter = ChatVaultAdapter;
})(typeof window !== 'undefined' ? window : globalThis);
