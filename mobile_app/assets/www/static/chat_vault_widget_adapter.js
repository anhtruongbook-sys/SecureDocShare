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
  let isProcessingShare = false;

  global.onReceiveSharedContent = function (sharedText) {
    if (!sharedText || !String(sharedText).trim()) return;
    const cleaned = String(sharedText).trim();
    if (cleaned === lastHandledShareText && (isProcessingShare || (Date.now() - lastHandledShareTime < 5000))) {
      return;
    }
    global.__kryptoHandlingShare = Date.now();
    const lockGate = document.getElementById('cyber-lock-gate');
    if (lockGate) lockGate.style.display = 'none';
    if (typeof activeShareHandler === 'function') {
      activeShareHandler(cleaned);
    } else {
      global.__pendingSharedLink = cleaned;
      if (typeof global.switchTab === 'function') {
        global.switchTab('knowledge');
      }
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

  global.onVaultFileSaved = function (fileName, savedPath, tempPath) {
    notifyUser(`✓ Đã lưu: ${fileName} vào mục Tải về (Downloads)`);
    if (typeof global.showCyberDialog === 'function') {
      global.showCyberDialog({
        type: 'success',
        icon: '📁',
        title: 'Đã Lưu Tệp Thành Công',
        message: `Tệp "${fileName}" đã được ghi vào bộ nhớ máy tại:\n• Bộ nhớ trong / Download / ${fileName}\n(Hiển thị trong mục "Tệp gần đây" và "Tải về" của ứng dụng File của bạn).\n\nBạn có muốn mở hoặc chia sẻ tệp này ngay qua Zalo / Notes / Drive không?`,
        actionText: '📤 Mở / Chia Sẻ Ngay',
        cancelText: 'Đóng',
        onAction: function () {
          if (global.FlutterBridge && typeof global.FlutterBridge.postMessage === 'function') {
            global.FlutterBridge.postMessage(JSON.stringify({
              action: 'share_temp_file',
              name: fileName,
              path: tempPath
            }));
          }
        }
      });
    }
  };

  function saveTextFileNativeOrWeb(fileName, contentStr, mimeType) {
    if (global.FlutterBridge && typeof global.FlutterBridge.postMessage === 'function') {
      notifyUser(`⏳ Đang ghi tệp ${fileName} vào thư mục Download...`);
      global.FlutterBridge.postMessage(JSON.stringify({
        action: 'save',
        name: fileName,
        content: contentStr
      }));
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
                <button type="button" class="cv-btn cv-btn-outline" id="cvBtnDedupe" title="Quét & gộp các bản ghi trùng lặp nội dung">🧹 Quét trùng</button>
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
            <div id="cvTopicChipsBar" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:10px;"></div>

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
                <option value="">-- Tất cả Chủ đề (Tự động nhận dạng) --</option>
              </select>
            </div>

            <div id="cvDetailBox" class="cv-divider-section" style="display:none;"></div>

            <table class="cv-table">
              <thead>
                <tr>
                  <th>Loại</th>
                  <th>Tiêu đề, Tóm tắt & Mốc khớp từ khóa</th>
                  <th>Chủ đề</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody id="cvTableBody"></tbody>
            </table>
          </div>
        </div>
      `;

      let currentResults = [];
      let groupByTopic = global.localStorage.getItem('CHAT_VAULT_GROUP_BY_TOPIC') !== '0';
      const collapsedTopics = new Set();

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

      const engineInitPromise = global.ChatVaultEngine.init();

      async function updateStatsAndTopicsBar() {
        const allItems = await global.ChatVaultEngine.getAllItems();
        const ytCount = allItems.filter(x => x.resource_type === 'youtube_video').length;
        const ghCount = allItems.filter(x => x.resource_type === 'github_repo').length;
        const otherCount = allItems.length - ytCount - ghCount;

        // Thống kê tự động các Chủ đề đang có trong kho
        const topicCounts = new Map();
        for (const it of allItems) {
          const cat = (it.taxonomy && it.taxonomy.category) || '📚 Tri thức Đa ngành & Ghi chú';
          topicCounts.set(cat, (topicCounts.get(cat) || 0) + 1);
        }

        const statsRow = container.querySelector('#cvStatsRow');
        if (statsRow) {
          statsRow.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
              <span class="cv-stat-pill">Tổng kho: <strong>${allItems.length}</strong></span>
              <span class="cv-stat-pill">🗂️ Chủ đề: <strong>${topicCounts.size}</strong></span>
              <span class="cv-stat-pill">▶ YouTube: <strong>${ytCount}</strong></span>
              <span class="cv-stat-pill">📦 GitHub: <strong>${ghCount}</strong></span>
              ${otherCount > 0 ? `<span class="cv-stat-pill">🌐 Web/Ghi chú: <strong>${otherCount}</strong></span>` : ''}
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <button type="button" id="cvToggleGroupMode" class="cv-btn cv-btn-outline" style="padding:4px 9px; font-size:11px;">
                ${groupByTopic ? '🗂️ Đang Nhóm Theo Chủ Đề' : '📋 Đang Xem Danh Sách Phẳng'}
              </button>
              <span style="font-size:11px; color:var(--cv-accent); font-weight:700;">
                ${currentLang === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
              </span>
            </div>
          `;
          const btnToggle = statsRow.querySelector('#cvToggleGroupMode');
          if (btnToggle) {
            btnToggle.addEventListener('click', () => {
              groupByTopic = !groupByTopic;
              global.localStorage.setItem('CHAT_VAULT_GROUP_BY_TOPIC', groupByTopic ? '1' : '0');
              refreshList();
              notifyUser(groupByTopic ? '🗂️ Đã bật chế độ Tự động Nhóm theo Chủ đề' : '📋 Đã chuyển sang chế độ Danh sách phẳng');
            });
          }
        }

        // Đồng bộ danh sách Chủ đề vào ô Select #cvFilterCat và Thanh Chip Chủ đề #cvTopicChipsBar
        const selectCat = container.querySelector('#cvFilterCat');
        const activeCat = selectCat ? selectCat.value : '';
        const defaultTopics = [
          '📈 Chiến lược RevOps, Kinh doanh & Quản trị',
          '🤖 AI Agent & Công cụ Lập trình',
          '🛡️ An toàn Thông tin & Kiểm toán Bảo mật',
          '⚖️ Pháp lý, Đấu thầu & Quy chuẩn Xây dựng',
          '🏗️ BIM, CDE & Kỹ thuật Công trình',
          '💰 Tài chính, Đầu tư & Kinh tế Vĩ mô',
          '🧬 Y sinh, Ngân hàng Sinh học & Nghiên cứu KH&CN',
          '🌐 Hạ tầng Đám mây, Mạng & Hệ thống',
          '☯️ Huyền học, Tử vi & Phong thủy'
        ];
        const allTopicNames = Array.from(new Set([...topicCounts.keys(), ...defaultTopics]));
        if (selectCat) {
          selectCat.innerHTML = `<option value="">-- Tất cả Chủ đề (${allItems.length}) --</option>` +
            allTopicNames.map(c => {
              const cnt = topicCounts.get(c) || 0;
              return `<option value="${escapeHtml(c)}" ${c === activeCat ? 'selected' : ''}>${escapeHtml(c)}${cnt > 0 ? ` (${cnt})` : ''}</option>`;
            }).join('');
        }

        const chipsBar = container.querySelector('#cvTopicChipsBar');
        if (chipsBar) {
          const activeEntries = Array.from(topicCounts.entries()).sort((a, b) => b[1] - a[1]);
          chipsBar.innerHTML = `
            <button type="button" class="cv-btn ${!activeCat ? '' : 'cv-btn-outline'}" data-topic-chip="" style="padding:4px 10px; font-size:11px; border-radius:999px;">
              🗂️ Tất cả (${allItems.length})
            </button>
            ${activeEntries.map(([tName, cnt]) => `
              <button type="button" class="cv-btn ${activeCat === tName ? '' : 'cv-btn-outline'}" data-topic-chip="${escapeHtml(tName)}" style="padding:4px 10px; font-size:11px; border-radius:999px;">
                ${escapeHtml(tName)} <strong>(${cnt})</strong>
              </button>
            `).join('')}
          `;
          chipsBar.querySelectorAll('button[data-topic-chip]').forEach(chip => {
            chip.addEventListener('click', () => {
              const chosen = chip.getAttribute('data-topic-chip') || '';
              if (selectCat) selectCat.value = chosen;
              refreshList();
            });
          });
        }
      }

      function renderSingleItemRow(item, idx) {
        const meta = item.metadata || {};
        const tax = item.taxonomy || {};
        const summ = item.summary || {};
        const ctx = item.chat_context || {};
        const subTopicHtml = tax.sub_topic
          ? `<div style="font-size:10.5px; font-weight:700; color:var(--cv-accent); margin-top:2px;">↳ Nhánh: ${escapeHtml(tax.sub_topic)}</div>`
          : '';
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
                ${subTopicHtml}
                <div style="font-size:11px; color:var(--cv-muted); margin-top:2px;">${escapeHtml(meta.channel || '')} • ${escapeHtml(meta.duration || '')} • Chia sẻ bởi: <strong>${escapeHtml(ctx.shared_by || 'User')}</strong> (${escapeHtml(ctx.chat_group || 'General')})</div>
                <div style="font-size:11.5px; color:var(--cv-muted); margin-top:4px;">${escapeHtml(summ.one_liner)}</div>
                <div style="margin-top:4px;">${tagsHtml}</div>
                ${hits}
              </span>
            </td>
            <td data-label="Chủ đề"><span class="table-cell-val"><span style="font-weight:700; color:var(--cv-accent); font-size:11.5px;">${escapeHtml(tax.category)}</span></span></td>
            <td data-label="Thao tác">
              <span class="table-cell-val">
                <button type="button" class="cv-btn" data-idx="${idx}" style="padding:5px 10px; font-size:11px;">👁️ Chi tiết</button>
              </span>
            </td>
          </tr>
        `;
      }

      async function refreshList() {
        await updateStatsAndTopicsBar();
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

        if (!groupByTopic) {
          tbody.innerHTML = currentResults.map((item, idx) => renderSingleItemRow(item, idx)).join('');
        } else {
          // Gom nhóm tự động theo Chủ đề
          const groups = new Map();
          currentResults.forEach((item, idx) => {
            const cat = (item.taxonomy && item.taxonomy.category) || '📚 Tri thức Đa ngành & Ghi chú';
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push({ item, idx });
          });

          const rowsHtml = [];
          for (const [catName, entries] of groups.entries()) {
            const isCollapsed = collapsedTopics.has(catName);
            const groupTags = Array.from(new Set(entries.flatMap(e => (e.item.taxonomy && e.item.taxonomy.tags) || []))).slice(0, 5);
            const groupTagsStr = groupTags.map(t => `#${t}`).join(' • ');
            rowsHtml.push(`
              <tr class="cv-topic-group-row" style="background:var(--cv-bg-input);">
                <td colspan="4" data-label="Nhóm chủ đề" style="border-top:2px solid var(--cv-accent) !important;">
                  <span class="table-cell-val" style="width:100%;">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; width:100%;">
                      <div style="text-align:left; cursor:pointer;" data-toggle-topic="${escapeHtml(catName)}">
                        <div style="font-size:13px; font-weight:800; color:var(--cv-accent);">
                          ${isCollapsed ? '▶' : '▼'} ${escapeHtml(catName)} <span style="font-size:11.5px; color:var(--cv-text);">(${entries.length} bản ghi)</span>
                        </div>
                        ${groupTagsStr ? `<div style="font-size:10.5px; color:var(--cv-muted); margin-top:2px;">Từ khóa nhóm: ${escapeHtml(groupTagsStr)}</div>` : ''}
                      </div>
                      <div style="display:flex; gap:6px; align-items:center;">
                        <button type="button" class="cv-btn cv-btn-outline" data-export-topic="${escapeHtml(catName)}" style="padding:4px 9px; font-size:10.5px;">📝 Xuất Nhóm (.md)</button>
                        <button type="button" class="cv-btn cv-btn-outline" data-toggle-topic="${escapeHtml(catName)}" style="padding:4px 8px; font-size:10.5px;">${isCollapsed ? 'Mở rộng' : 'Thu gọn'}</button>
                      </div>
                    </div>
                  </span>
                </td>
              </tr>
            `);
            if (!isCollapsed) {
              for (const { item, idx } of entries) {
                rowsHtml.push(renderSingleItemRow(item, idx));
              }
            }
          }
          tbody.innerHTML = rowsHtml.join('');

          tbody.querySelectorAll('[data-toggle-topic]').forEach(el => {
            el.addEventListener('click', () => {
              const tName = el.getAttribute('data-toggle-topic');
              if (collapsedTopics.has(tName)) collapsedTopics.delete(tName);
              else collapsedTopics.add(tName);
              refreshList();
            });
          });

          tbody.querySelectorAll('button[data-export-topic]').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const tName = btn.getAttribute('data-export-topic');
              const groupItems = (groups.get(tName) || []).map(x => x.item);
              if (global.ChatVaultEngine.exportTopicGroupMarkdown) {
                const md = global.ChatVaultEngine.exportTopicGroupMarkdown(tName, groupItems);
                const slug = global.ChatVaultEngine.removeVietnameseAccents(tName).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
                saveTextFileNativeOrWeb(`Chu_De_${slug}_${currentLang}.md`, md, 'text/markdown;charset=utf-8');
              }
            });
          });
        }

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

        // Tự động dịch bổ sung ngay lập tức nếu đang ở chế độ Tiếng Việt mà bản ghi cũ vẫn còn tiếng Anh
        if (
          currentLang === 'vi' &&
          !item._autoTranslatingVi &&
          global.ChatVaultEngine.isPrimarilyVietnamese &&
          !global.ChatVaultEngine.isPrimarilyVietnamese(`${summ.one_liner || ''} ${summ.executive_summary || ''}`)
        ) {
          item._autoTranslatingVi = true;
          (async () => {
            try {
              const statusEl = container.querySelector('#cvStatus');
              if (statusEl) statusEl.textContent = '⏳ Đang tự động dịch toàn bộ thẻ sang Tiếng Việt...';
              await global.ChatVaultEngine.ensureRecordBilingual(item);
              await global.ChatVaultEngine.saveRecord(item);
              await refreshList();
              const newIdx = currentResults.findIndex(x => x.id === item.id);
              if (newIdx !== -1) showDetail(newIdx, false);
              if (statusEl) statusEl.textContent = `✓ Đã dịch sang Tiếng Việt: ${(item.metadata && item.metadata.title) || ''}`;
            } catch (_) {}
          })();
        }
        const box = container.querySelector('#cvDetailBox');
        const baseUrl = meta.url || '#';
        const isYt = item.resource_type === 'youtube_video';

        const ideasHtml = (wis.core_ideas || []).map(c => {
          const link = isYt ? `${baseUrl}&t=${c.seconds || 0}s` : baseUrl;
          return `<li style="padding:7px 0; border-bottom:1px dashed var(--cv-border);"><a href="${escapeHtml(link)}" target="_blank" style="color:var(--cv-accent); font-family:monospace; font-weight:700;">[${escapeHtml(c.timestamp)}]</a> ${c.chapter ? `<strong style="color:var(--cv-text);">${escapeHtml(c.chapter)}:</strong> ` : ''}${escapeHtml(c.content)}</li>`;
        }).join('');

        const insightsHtml = (wis.key_insights || []).map(k => {
          const link = isYt ? `${baseUrl}&t=${k.seconds || 0}s` : baseUrl;
          return `<li style="padding:5px 0; border-bottom:1px dashed var(--cv-border);"><a href="${escapeHtml(link)}" target="_blank" style="color:var(--cv-accent); font-family:monospace; font-weight:700;">[${escapeHtml(k.timestamp)}]</a> ${escapeHtml(k.content)}</li>`;
        }).join('');

        const actionsHtml = (wis.actionable_steps || []).map(st => {
          const link = isYt ? `${baseUrl}&t=${st.seconds || 0}s` : baseUrl;
          return `<li style="padding:5px 0; border-bottom:1px dashed var(--cv-border);"><a href="${escapeHtml(link)}" target="_blank" style="color:var(--cv-accent); font-family:monospace; font-weight:700;">[${escapeHtml(st.timestamp)}]</a> ${escapeHtml(st.content)}</li>`;
        }).join('');

        const chaptersHtml = (tl.chapters || []).map(ch => {
          const link = isYt ? `${baseUrl}&t=${ch.seconds || 0}s` : baseUrl;
          return `<a href="${escapeHtml(link)}" target="_blank" style="display:inline-block; font-size:11px; padding:3px 8px; border-radius:6px; background:var(--cv-bg-input); border:1px solid var(--cv-border); color:var(--cv-accent); text-decoration:none; margin:2px;">[${escapeHtml(ch.timestamp)}] ${escapeHtml(ch.title)}</a>`;
        }).join('');

        box.style.display = 'block';
        box.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
            <div style="flex:1; min-width:200px;">
              <h4 style="margin:0; font-size:13.5px; color:var(--cv-text); line-height:1.4;">${escapeHtml(meta.title)}</h4>
              <div style="font-size:11px; color:var(--cv-muted); margin-top:4px;">
                Nguồn: <a href="${escapeHtml(baseUrl)}" target="_blank" style="color:var(--cv-accent); word-break:break-all;">${escapeHtml(baseUrl)}</a>
                • Ghi chú: <em>"${escapeHtml(ctx.sender_note || '')}"</em>
              </div>
            </div>
            <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
              <div class="cv-lang-switch">
                <button type="button" class="cv-lang-btn ${currentLang === 'vi' ? 'active' : ''}" id="cvDetailLangVi">🇻🇳 VI</button>
                <button type="button" class="cv-lang-btn ${currentLang === 'en' ? 'active' : ''}" id="cvDetailLangEn">🇬🇧 EN</button>
              </div>
              <button type="button" class="cv-btn cv-btn-outline" id="cvReSummarize" style="padding:5px 9px; font-size:11px;" title="Tóm tắt & dịch lại bản ghi này">🔄 Tóm tắt lại</button>
              <button type="button" class="cv-btn cv-btn-outline" id="cvCopyMd" style="padding:5px 9px; font-size:11px;">📋 Copy Thẻ</button>
              <button type="button" class="cv-btn cv-btn-outline" id="cvExportMd" style="padding:5px 9px; font-size:11px;">📝 Xuất (.md)</button>
              <button type="button" class="cv-btn cv-btn-danger" id="cvDeleteRecord" style="padding:5px 9px; font-size:11px;">🗑️ Xóa</button>
              <button type="button" class="cv-btn cv-btn-outline" id="cvCloseDetail" style="padding:5px 9px; font-size:11px;">✕ Đóng</button>
            </div>
          </div>

          <div style="margin-top:10px; padding-top:8px; border-top:1px dashed var(--cv-border);">
            <div style="font-size:11px; font-weight:700; color:var(--cv-accent); margin-bottom:3px;">📌 THÔNG ĐIỆP TRỌNG TÂM (CORE THESIS):</div>
            <div style="font-size:12.5px; font-weight:600; line-height:1.5; color:var(--cv-text);">${escapeHtml(summ.one_liner)}</div>
          </div>

          <div style="margin-top:8px;">
            <div style="font-size:11px; font-weight:700; color:var(--cv-accent); margin-bottom:3px;">🎯 BỨC TRANH TỔNG THỂ & Ý NGHĨA CHÍNH (EXECUTIVE OVERVIEW):</div>
            <p style="font-size:12px; line-height:1.55; margin:0; color:var(--cv-text);">${escapeHtml(summ.executive_summary)}</p>
          </div>

          ${chaptersHtml ? `<div style="margin:10px 0;"><div style="font-size:11px; font-weight:700; color:var(--cv-muted); margin-bottom:4px;">⏱️ MỤC LỤC PHẦN / CHƯƠNG MỤC:</div>${chaptersHtml}</div>` : ''}

          <div style="margin-top:10px;">
            <div style="font-size:11px; font-weight:700; color:var(--cv-accent);">💡 NỘI DUNG CỐT LÕI THEO MẠCH PHẦN / CHƯƠNG MỤC:</div>
            <ul style="list-style:none; padding-left:0; margin:4px 0 0; font-size:12px; line-height:1.5;">${ideasHtml || '<li>(Không có dữ liệu)</li>'}</ul>
          </div>

          ${insightsHtml ? `<div style="margin-top:10px;"><div style="font-size:11px; font-weight:700; color:var(--cv-accent);">🔑 NGUYÊN LÝ & ĐÚC KẾT SÂU (KEY INSIGHTS):</div><ul style="list-style:none; padding-left:0; margin:4px 0 0; font-size:12px; line-height:1.5;">${insightsHtml}</ul></div>` : ''}

          ${actionsHtml ? `<div style="margin-top:10px;"><div style="font-size:11px; font-weight:700; color:var(--cv-accent);">🚀 KHUYẾN NGHỊ HÀNH ĐỘNG & ỨNG DỤNG (ACTIONABLE STEPS):</div><ul style="list-style:none; padding-left:0; margin:4px 0 0; font-size:12px; line-height:1.5;">${actionsHtml}</ul></div>` : ''}
        `;

        box.querySelector('#cvDetailLangVi').addEventListener('click', () => setLanguage('vi'));
        box.querySelector('#cvDetailLangEn').addEventListener('click', () => setLanguage('en'));

        box.querySelector('#cvReSummarize').addEventListener('click', async () => {
          if (!global.ChatVaultEngine.reExtractRecord) return;
          notifyUser('⏳ Đang bóc tách & tổng hợp lại mạch nội dung chuẩn v3...');
          const fresh = await global.ChatVaultEngine.reExtractRecord(item.id);
          await refreshList();
          if (fresh) {
            const newIdx = currentResults.findIndex(x => x.id === fresh.id);
            if (newIdx !== -1) showDetail(newIdx, false);
            notifyUser('✓ Đã tổng hợp lại nội dung chính thành công!');
          }
        });

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

      async function executeSaveInput(autoOpenDetail = true, extraOpts = {}) {
        const raw = (extraOpts.overrideRaw || container.querySelector('#cvInputRaw').value).trim();
        const note = container.querySelector('#cvInputNote').value.trim();
        const sender = container.querySelector('#cvInputSender').value.trim();
        const group = container.querySelector('#cvInputGroup').value.trim();
        const status = container.querySelector('#cvStatus');

        if (!raw) {
          status.textContent = '⚠️ Vui lòng nhập đường dẫn YouTube, GitHub, Web hoặc nội dung ghi chú.';
          return;
        }
        status.textContent = '⏳ Đang kiểm tra trùng lặp, bóc tách phụ đề & dịch sang Tiếng Việt...';
        try {
          const rec = await global.ChatVaultEngine.ingestAndSave(raw, {
            senderNote: note,
            sharedBy: sender,
            chatGroup: group,
            forceReExtract: Boolean(extraOpts.forceReExtract),
            keepBoth: Boolean(extraOpts.keepBoth)
          });
          const localizedRec = global.ChatVaultEngine.getLocalizedRecord(rec, currentLang);
          const dupInfo = rec._duplicateInfo || {};

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

          if (dupInfo.isDuplicate) {
            const simPct = Math.round((dupInfo.similarity || 1) * 100);
            const dupLabel = dupInfo.duplicateType === 'semantic_content'
              ? `Trùng khớp ngữ nghĩa ${simPct}%`
              : 'Đã có sẵn trong Kho Tri Thức (Trùng 100%)';
            status.textContent = `⚡ Phát hiện trùng nội dung (${dupLabel}): Đã mở ngay "${localizedRec.metadata.title}"`;
            notifyUser(`⚡ ${dupLabel}: Đã mở bản ghi sẵn có!`);

            if (typeof global.showCyberDialog === 'function') {
              if (dupInfo.duplicateType === 'semantic_content' && dupInfo.candidateRecord) {
                global.showCyberDialog({
                  type: 'warning',
                  icon: '🔍',
                  title: `Phát Hiện Trùng Nội Dung (${simPct}%)`,
                  message: `Nội dung bạn vừa nhập có độ tương đồng ngữ nghĩa ${simPct}% với bản ghi đã có trong kho:\n\n• "${localizedRec.metadata.title}"\n\nHệ thống đã mở bản ghi sẵn có để tránh lưu trùng. Bạn muốn giữ nguyên hay vẫn lưu thành một bản ghi riêng biệt?`,
                  actionText: '➕ Vẫn Lưu Thành Bản Riêng',
                  cancelText: 'Giữ Bản Đã Có',
                  onAction: async function () {
                    const sepRec = dupInfo.candidateRecord;
                    sepRec.id = `${sepRec.id}_${Date.now().toString(36).slice(-4)}`;
                    await global.ChatVaultEngine.saveRecord(sepRec);
                    await refreshList();
                    const idxNew = currentResults.findIndex(x => x.id === sepRec.id);
                    if (idxNew !== -1) showDetail(idxNew, true);
                    notifyUser('✓ Đã lưu thêm bản ghi riêng biệt vào kho!');
                  }
                });
              } else {
                global.showCyberDialog({
                  type: 'info',
                  icon: '⚡',
                  title: 'Nội Dung Đã Có Trong Kho Tri Thức',
                  message: `Đường dẫn / nội dung này đã được lưu trước đó:\n\n• "${localizedRec.metadata.title}"\n• Chủ đề: ${(localizedRec.taxonomy && localizedRec.taxonomy.category) || ''}\n\nHệ thống đã mở ngay bản ghi sẵn có (không cần tải lại). Bạn có muốn bóc tách và làm mới lại từ nguồn không?`,
                  actionText: '🔄 Bóc Tách & Làm Mới Lại',
                  cancelText: 'Xem Bản Hiện Có',
                  onAction: function () {
                    executeSaveInput(true, { overrideRaw: raw, forceReExtract: true });
                  }
                });
              }
            }
          } else {
            status.textContent = `✓ Đã lưu (${currentLang.toUpperCase()}): ${localizedRec.metadata.title}`;
            notifyUser(`✓ Đã bóc tách & lưu: ${localizedRec.metadata.title}`);
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

      // Quét & Gộp trùng lặp toàn kho
      container.querySelector('#cvBtnDedupe').addEventListener('click', async () => {
        if (!global.ChatVaultEngine.scanAndMergeVaultDuplicates) return;
        const res = await global.ChatVaultEngine.scanAndMergeVaultDuplicates();
        await refreshList();
        if (res.mergedCount > 0) {
          const detailLines = res.details.map(d => `• Đã gộp "${d.removedTitle}" -> "${d.keptTitle}" (Trùng ${d.similarity}%)`).join('\n');
          notifyUser(`🧹 Đã phát hiện & gộp ${res.mergedCount} bản ghi trùng lặp!`);
          if (typeof global.showCyberDialog === 'function') {
            global.showCyberDialog({
              type: 'success',
              icon: '🧹',
              title: `Đã Dọn Sạch ${res.mergedCount} Bản Ghi Trùng Lặp`,
              message: `Hệ thống đã rà soát ngữ nghĩa toàn kho và tự động gộp ${res.mergedCount} bản ghi trùng lặp (còn lại ${res.remainingCount} bản ghi duy nhất):\n\n${detailLines}`,
              actionText: 'Đã Hiểu'
            });
          }
        } else {
          notifyUser(`✓ Kho Tri Thức sạch 100% (${res.remainingCount} bản ghi duy nhất, không có trùng lặp)`);
          if (typeof global.showCyberDialog === 'function') {
            global.showCyberDialog({
              type: 'info',
              icon: '✅',
              title: 'Kho Tri Thức Không Có Trùng Lặp',
              message: `Đã kiểm tra đối sánh đường dẫn và độ tương đồng ngữ nghĩa trên toàn bộ ${res.remainingCount} bản ghi trong Kho Tri Thức.\n\nTất cả các bản ghi đều là duy nhất (không có nội dung trùng lặp >= 75%).`,
              actionText: 'Đóng'
            });
          }
        }
      });

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

      // Xử lý tự động ngay lập tức khi nhận link chia sẻ từ Android Share Intent (GitHub/Zalo/YouTube -> Krypto)
      activeShareHandler = async function (sharedText) {
        if (!sharedText || !String(sharedText).trim()) return;
        const cleaned = String(sharedText).trim();
        if (cleaned === lastHandledShareText && (isProcessingShare || (Date.now() - lastHandledShareTime < 5000))) {
          return;
        }
        isProcessingShare = true;
        lastHandledShareText = cleaned;
        lastHandledShareTime = Date.now();
        global.__kryptoHandlingShare = Date.now();
        global.__pendingSharedLink = null;

        try {
          // Mở khóa màn hình cổng PIN (nếu đang che) và chuyển ngay sang Tab Tri Thức
          const lockGate = document.getElementById('cyber-lock-gate');
          if (lockGate) lockGate.style.display = 'none';
          if (typeof global.switchTab === 'function') {
            global.switchTab('knowledge');
          }

          const inputEl = container.querySelector('#cvInputRaw');
          const noteEl = container.querySelector('#cvInputNote');
          const statusEl = container.querySelector('#cvStatus');
          if (inputEl) inputEl.value = cleaned;
          if (noteEl) noteEl.value = 'Chia sẻ trực tiếp sang Krypto';
          if (statusEl) statusEl.textContent = '⏳ Đang tự động bóc tách & lưu liên kết vừa chia sẻ...';
          notifyUser('⏳ Đang tự động bóc tách & lưu liên kết vừa chia sẻ...');

          await engineInitPromise;
          await executeSaveInput(true, { overrideRaw: cleaned });
        } finally {
          isProcessingShare = false;
        }
      };

      await engineInitPromise;
      await refreshList();

      // Nếu có link được chia sẻ đến trong lúc app đang khởi động -> xử lý tự động ngay lập tức!
      if (global.__pendingSharedLink) {
        const pending = global.__pendingSharedLink;
        global.__pendingSharedLink = null;
        setTimeout(() => activeShareHandler(pending), 50);
      }

      return { refreshList, setLanguage, handleShare: activeShareHandler };
    }
  };

  global.ChatVaultAdapter = ChatVaultAdapter;
})(typeof window !== 'undefined' ? window : globalThis);
