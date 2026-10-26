/**
 * CHAT KNOWLEDGE VAULT — HYBRID ENGINE v3.0 (COHERENT SEMANTIC SYNTHESIS + BILINGUAL VI/EN)
 * -----------------------------------------------------------------------------------------
 * Giải quyết triệt để bài toán tóm tắt mạch lạc, có cấu trúc và ý nghĩa thực chất:
 * 1. GitHub Repository: Tự động gọi GitHub REST API + tải nguyên bản README.md (Markdown),
 *    phân tích cấu trúc từng đề mục (# / ## / ###), bảng biểu và nguyên lý thiết kế để tổng hợp
 *    Bức tranh tổng thể & Luận điểm theo từng phần (tuyệt đối không quét rác HTML/Menu/React JSON).
 * 2. YouTube Video: Tái tạo câu văn hoàn chỉnh từ phụ đề (không cắt ngang câu 30 giây),
 *    khử từ đệm hội thoại (filler words) & quảng cáo (sponsor links), tổng hợp mạch lạc
 *    Nội dung cốt lõi theo từng Chương mục (Chapter Synthesis) và Tổng quan toàn video.
 * 3. Song ngữ Việt - Anh: Mặc định hiển thị Tiếng Việt ('vi'), chuyển đổi 1 chạm sang Tiếng Anh ('en'),
 *    tự động nâng cấp mọi bản ghi cũ trong máy lên chuẩn Schema v3.
 */

(function (global) {
  'use strict';

  const CURRENT_SCHEMA_VERSION = 5;
  const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
  const GITHUB_REGEX = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i;
  const FACEBOOK_REGEX = /https?:\/\/(?:www\.|m\.|mbasic\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s<>"']+/i;
  const URL_REGEX = /(https?:\/\/[^\s<>"']+)/i;
  const VI_DIACRITIC_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

  const TAXONOMY_RULES = {
    '🛡️ An toàn Thông tin & Kiểm toán Bảo mật': [
      'security', 'security-audit', 'vulnerability', 'vulnerabilities', 'pen-test', 'exploit',
      'devsecops', 'attack-classes', 'memory-safety', 'prompt-injection', 'cryptography', 'pqc',
      'ml-kem', 'cipher', 'bảo mật', 'an toàn thông tin', 'lỗ hổng', 'kiểm toán bảo mật', 'mật mã',
      'cve-', 'rce', 'kiểm chứng hình thức', 'formal verification', 'lean verification'
    ],
    '📈 Chiến lược RevOps, Kinh doanh & Quản trị': [
      'revops', 'revenue operations', 'company brain', 'hubspot', 'salesforce', 'crm', 'go-to-market',
      'fp&a', 'p&l', 'quota', 'ramp time', 'sales rep', 'deal', 'forecasting', 'doanh thu',
      'bán hàng', 'kinh doanh', 'quản trị doanh nghiệp', 'lãnh đạo', 'chiến lược', 'vận hành'
    ],
    '🤖 AI Agent & Công cụ Lập trình': [
      'coding agent', 'claude code', 'claw-code', 'oh-my-codex', 'codex', 'llm', 'agent harness',
      'rust', 'python', 'typescript', 'javascript', 'cli tool', 'github copilot', 'prompt',
      'lập trình', 'trí tuệ nhân tạo', 'mã nguồn', 'phần mềm', 'ai agent'
    ],
    '⚖️ Pháp lý, Đấu thầu & Quy chuẩn Xây dựng': [
      'luật', 'nghị định', 'thông tư', 'qcvn', 'tcvn', 'pháp lý', 'hợp đồng', 'đấu thầu',
      'nghiệm thu', 'pccc', 'thẩm định', 'thẩm tra', 'cấp phép', 'muasamcong', 'law', 'legal'
    ],
    '🏗️ BIM, CDE & Kỹ thuật Công trình': [
      'bim', 'revit', 'ifc', 'cde', 'iso 19650', 'kết cấu', 'kiến trúc', 'mep', 'uniclass',
      'bản vẽ', 'thiết kế', 'công trình', 'aidc', 'data center', 'structural', 'construction'
    ],
    '💰 Tài chính, Đầu tư & Kinh tế Vĩ mô': [
      'tài chính', 'đầu tư', 'chứng khoán', 'cổ phiếu', 'vĩ mô', 'lãi suất', 'thuế', 'ngân hàng',
      'trái phiếu', 'tỷ giá', 'lạm phát', 'finance', 'investment', 'stock', 'valuation', 'portfolio'
    ],
    '🧬 Y sinh, Ngân hàng Sinh học & Nghiên cứu KH&CN': [
      'biobank', 'iso 20387', 'sprec', 'miabis', 'y sinh', 'bệnh viện', 'lâm sàng', 'luận án',
      'tiến sĩ', 'scopus', 'wos', 'nghiên cứu khoa học', 'clinical', 'medical', 'genomics'
    ],
    '🌐 Hạ tầng Đám mây, Mạng & Hệ thống': [
      'kubernetes', 'docker', 'serverless', 'aws', 'gcp', 'azure', 'linux', 'database',
      'distributed', 'network', 'microservice', 'hạ tầng mạng', 'máy chủ', 'đám mây'
    ],
    '☯️ Huyền học, Tử vi & Phong thủy': [
      'tử vi', 'phong thủy', 'bát tự', 'kinh dịch', 'quẻ', 'mệnh', 'cung', 'sao', 'huyền học'
    ]
  };

  const STOPWORDS = new Set([
    'the', 'and', 'to', 'of', 'in', 'is', 'it', 'that', 'for', 'you', 'on', 'with', 'as', 'are',
    'this', 'by', 'be', 'at', 'or', 'from', 'an', 'have', 'has', 'was', 'were', 'but', 'not',
    'what', 'all', 'we', 'they', 'your', 'can', 'will', 'about', 'which', 'their', 'if', 'do',
    'so', 'up', 'out', 'just', 'like', 'know', 'going', 'think', 'get', 'really', 'right', 'now',
    'there', 'would', 'could', 'should', 'how', 'when', 'where', 'who', 'them', 'then', 'than',
    'into', 'some', 'more', 'other', 'one', 'two', 'time', 'way', 'thing', 'things', 'people',
    'very', 'also', 'even', 'because', 'actually', 'kind', 'sort', 'mean', 'yeah', 'okay', 'well',
    'gonna', 'wanna', 'gotta', 'stuff', 'lot', 'little', 'bit', 'said', 'say', 'saying', 'look',
    'và', 'của', 'là', 'có', 'trong', 'được', 'cho', 'với', 'các', 'những', 'một', 'này',
    'đó', 'khi', 'để', 'từ', 'không', 'như', 'về', 'người', 'ra', 'theo', 'trên', 'tại'
  ]);

  function removeVietnameseAccents(str) {
    if (!str) return '';
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
  }

  function formatTimestamp(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  }

  function parseTimestampToSeconds(ts) {
    const parts = String(ts || '0:0').trim().split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  function decodeHtmlEntities(text) {
    if (!text) return '';
    const txt = String(text)
      .replace(/\\u003c/gi, '<')
      .replace(/\\u003e/gi, '>')
      .replace(/\\u0026/gi, '&')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        try { return String.fromCodePoint(parseInt(hex, 16)); } catch (__) { return ''; }
      })
      .replace(/&#(\d+);/g, (_, code) => {
        try { return String.fromCodePoint(Number(code)); } catch (__) { return ''; }
      });
    return txt;
  }

  function simpleHash(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36).slice(0, 10);
  }

  /**
   * CẦU NỐI NATIVE BRIDGE (FLUTTER <-> JS)
   */
  const pendingNativeCalls = new Map();
  let callSeq = 1;

  global.__onChatVaultNativeResponse = function (responseJson) {
    try {
      const res = typeof responseJson === 'string' ? JSON.parse(responseJson) : responseJson;
      const item = pendingNativeCalls.get(res.reqId);
      if (item) {
        pendingNativeCalls.delete(res.reqId);
        if (res.ok) item.resolve(res.data);
        else item.reject(new Error(res.error || 'Native Bridge Error'));
      }
    } catch (err) {
      console.error('[ChatVaultEngine] Bridge parse error:', err);
    }
  };

  function hasNativeBridge() {
    return Boolean(
      (global.ChatVaultNativeBridge && typeof global.ChatVaultNativeBridge.postMessage === 'function') ||
      (global.webkit && global.webkit.messageHandlers && global.webkit.messageHandlers.ChatVaultNativeBridge)
    );
  }

  function callNativeBridge(action, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!hasNativeBridge()) {
        reject(new Error('Native Bridge không khả dụng'));
        return;
      }
      const reqId = `req_${Date.now()}_${callSeq++}`;
      const timer = setTimeout(() => {
        if (pendingNativeCalls.has(reqId)) {
          pendingNativeCalls.delete(reqId);
          reject(new Error(`Quá thời gian chờ phản hồi (${action})`));
        }
      }, 25000);

      pendingNativeCalls.set(reqId, {
        resolve: (data) => { clearTimeout(timer); resolve(data); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      const msg = JSON.stringify({ reqId, action, ...payload });
      if (global.ChatVaultNativeBridge && typeof global.ChatVaultNativeBridge.postMessage === 'function') {
        global.ChatVaultNativeBridge.postMessage(msg);
      } else {
        global.webkit.messageHandlers.ChatVaultNativeBridge.postMessage(msg);
      }
    });
  }

  async function hybridHttpRequest({ url, method = 'GET', headers = {}, body = null }) {
    if (hasNativeBridge()) {
      return await callNativeBridge('httpRequest', { url, method, headers, body });
    }
    const resp = await fetch(url, { method, headers, body });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  }

  function detectCategory(corpusText, titleText = '', topTags = []) {
    const lower = String(corpusText || '').toLowerCase();
    const titleLower = String(titleText || '').toLowerCase();
    let bestCat = '';
    let bestScore = 0;
    for (const [cat, kwList] of Object.entries(TAXONOMY_RULES)) {
      let score = 0;
      for (const kw of kwList) {
        if (titleLower.includes(kw)) score += 3;
        if (lower.includes(kw)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCat = cat;
      }
    }
    if (bestScore >= 2 && bestCat) return bestCat;
    if (Array.isArray(topTags) && topTags.length > 0) {
      const primaryTag = String(topTags[0]).replace(/[-_]/g, ' ').trim();
      if (primaryTag.length >= 3) {
        return `🔖 Chủ đề: ${primaryTag.charAt(0).toUpperCase() + primaryTag.slice(1)}`;
      }
    }
    return '📚 Tri thức Đa ngành & Ghi chú';
  }

  /**
   * 3. CHẤM ĐIỂM NGỮ NGHĨA TF-IDF + MẬT ĐỘ LUẬN ĐIỂM (THESIS DENSITY SCORING)
   */
  const THESIS_MARKERS_RE = /\b(because|therefore|key|important|critical|means|instead|strategy|framework|system|architecture|model|problem|solution|build|buy|must|should|need to|first|second|third|result|impact|percent|principle|phase|workflow|vì vậy|do đó|cốt lõi|quan trọng|giải pháp|nguyên lý|bản chất|hệ thống|chiến lược|mục tiêu)\b/i;
  const CONVERSATIONAL_NOISE_RE = /\b(thank you so much|can't wait to hear|black t-shirt|new balance|dry-cleaned|around the water cooler|party trick|getting annoying|dude, we get it|blah|oh geez|sign in|sign up|appearance settings|reload to refresh your session)\b/i;

  function cleanSpokenDisfluencies(text) {
    let s = String(text || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/\b(you know,\s*|you know\s+|I mean,\s*|I mean\s+|like,\s+|sort of\s+|kind of\s+|uh,?\s+|um,?\s+)/gi, '');
    s = s.replace(/^(and|so|but|well|okay|listen|now),?\s+/i, '');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > 1) {
      s = s.charAt(0).toUpperCase() + s.slice(1);
    }
    return s;
  }

  async function computeTfIdfScoresAsync(segments, title = '') {
    if (!segments || !segments.length) return { scores: [], topKeywords: [] };
    const wordRegex = /[a-zA-ZÀ-ỹ0-9_-]{3,}/g;
    const titleWords = new Set(
      (String(title).match(wordRegex) || [])
        .map(w => w.toLowerCase())
        .filter(w => !STOPWORDS.has(w))
    );

    const tokenizedDocs = [];
    const docFreq = new Map();
    const totalTermFreq = new Map();

    for (let i = 0; i < segments.length; i++) {
      if (i > 0 && i % 40 === 0) {
        await new Promise(r => setTimeout(r, 1));
      }
      const words = (String(segments[i].text || '').match(wordRegex) || [])
        .map(w => w.toLowerCase())
        .filter(w => !STOPWORDS.has(w));
      tokenizedDocs.push(words);

      const seenInDoc = new Set();
      for (const w of words) {
        totalTermFreq.set(w, (totalTermFreq.get(w) || 0) + 1);
        seenInDoc.add(w);
      }
      for (const uw of seenInDoc) {
        docFreq.set(uw, (docFreq.get(uw) || 0) + 1);
      }
    }

    const numDocs = segments.length;
    const scores = tokenizedDocs.map((words, idx) => {
      if (!words.length) return 0;
      const rawTxt = String(segments[idx].text || '');
      if (CONVERSATIONAL_NOISE_RE.test(rawTxt)) return 0.1;
      const tf = new Map();
      for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);
      let docScore = 0;
      for (const [w, count] of tf.entries()) {
        const df = docFreq.get(w) || 1;
        const idf = Math.log(1.0 + numDocs / (1.0 + df));
        const weight = titleWords.has(w) ? 1.8 : 1.0;
        docScore += (count / Math.sqrt(words.length)) * idf * weight;
      }
      if (THESIS_MARKERS_RE.test(rawTxt)) docScore *= 1.35;
      // Giảm điểm các câu quá nhiều dấu hỏi vụn vặt
      const qCount = (rawTxt.match(/\?/g) || []).length;
      if (qCount >= 2) docScore *= 0.65;
      return docScore;
    });

    const sortedTerms = Array.from(totalTermFreq.entries())
      .filter(([w]) => w.length > 3 && (docFreq.get(w) || 0) >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w]) => w);

    return { scores, topKeywords: sortedTerms };
  }

  /**
   * 4A. BỘ BÓC TÁCH & TỔNG HỢP MẠCH LẠC YOUTUBE (COHERENT CHAPTER & THESIS SYNTHESIS)
   */
  function buildCompleteSentencesFromXml(rawXml) {
    const pRegex = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
    let pMatch;
    const rawPieces = [];

    while ((pMatch = pRegex.exec(rawXml)) !== null) {
      const startSec = Number(pMatch[1]) / 1000.0;
      const cleanPiece = decodeHtmlEntities(pMatch[3].replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanPiece) continue;
      rawPieces.push({ startSec, text: cleanPiece });
    }

    // Ghép các mảnh phụ đề thành câu hoàn chỉnh theo dấu câu (. ! ?) hoặc độ dài hợp lý
    const sentences = [];
    let curStart = 0;
    let curWords = [];

    for (let i = 0; i < rawPieces.length; i++) {
      const piece = rawPieces[i];
      if (!curWords.length) curStart = piece.startSec;
      curWords.push(piece.text);
      const joined = curWords.join(' ');
      const endsWithPunct = /[.!?]["']?$/.test(piece.text);
      const duration = piece.startSec - curStart;

      if ((endsWithPunct && joined.length >= 65) || joined.length >= 220 || duration >= 28) {
        const cleaned = cleanSpokenDisfluencies(joined);
        if (cleaned.length >= 35) {
          sentences.push({
            timestamp: formatTimestamp(curStart),
            start_seconds: Math.floor(curStart),
            text: cleaned
          });
        }
        curWords = [];
      }
    }
    if (curWords.length) {
      const cleaned = cleanSpokenDisfluencies(curWords.join(' '));
      if (cleaned.length >= 25) {
        sentences.push({
          timestamp: formatTimestamp(curStart),
          start_seconds: Math.floor(curStart),
          text: cleaned
        });
      }
    }
    return sentences;
  }

  function synthesizeChapterParagraph(chapterTitle, chapterSentences, chapterScores) {
    if (!chapterSentences.length) return '';
    // Chọn tối đa 2-3 câu có điểm ngữ nghĩa cao nhất trong chương nhưng giữ đúng thứ tự thời gian để tạo đoạn văn mạch lạc
    const indexed = chapterSentences.map((s, idx) => ({
      s,
      idx,
      score: chapterScores[idx] || 0
    }));
    const filtered = indexed.filter(x => x.s.text.length >= 45 && !CONVERSATIONAL_NOISE_RE.test(x.s.text));
    const pool = filtered.length >= 2 ? filtered : indexed;
    const topPicked = pool
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .sort((a, b) => a.idx - b.idx)
      .map(x => {
        let t = x.s.text.trim();
        if (!/[.!?]$/.test(t)) t += '.';
        return t;
      });

    return topPicked.join(' ');
  }

  async function extractYouTubeIdeaCard(url, { senderNote = '', sharedBy = 'User', chatGroup = 'General' } = {}) {
    const m = String(url).match(YOUTUBE_REGEX);
    if (!m) throw new Error('Không tìm thấy mã Video YouTube hợp lệ.');
    const videoId = m[1];

    // Kiểm tra nếu trùng với bản ghi chuẩn v3 đã tinh chỉnh -> trả về ngay bản chuẩn
    if (global.__CHAT_VAULT_INITIAL_SEED && Array.isArray(global.__CHAT_VAULT_INITIAL_SEED)) {
      const preset = global.__CHAT_VAULT_INITIAL_SEED.find(s => s.id === `yt_${videoId}` && s.schema_version === CURRENT_SCHEMA_VERSION);
      if (preset) {
        const cloned = JSON.parse(JSON.stringify(preset));
        if (senderNote) cloned.chat_context.sender_note = senderNote;
        return cloned;
      }
    }

    const innertubePayload = JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
          hl: 'vi',
          gl: 'VN'
        }
      },
      videoId
    });

    const rawPlayerJson = await hybridHttpRequest({
      url: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
      },
      body: innertubePayload
    });

    const playerData = JSON.parse(rawPlayerJson || '{}');
    const videoDetails = playerData.videoDetails || {};
    const title = videoDetails.title || `YouTube Video (${videoId})`;
    const channel = videoDetails.author || 'YouTube Channel';
    const lengthSeconds = Number(videoDetails.lengthSeconds || 0);
    const description = videoDetails.shortDescription || '';
    const keywords = videoDetails.keywords || [];

    // Bóc tách Chapters từ Description
    const chapters = [];
    const chRegex = /(?:^|\n)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:|\s]\s*(.+)/g;
    let chMatch;
    while ((chMatch = chRegex.exec(description)) !== null) {
      const ts = chMatch[1].trim();
      const chTitle = chMatch[2].replace(/https?:\/\/\S+/g, '').trim();
      if (chTitle.length >= 3) {
        chapters.push({
          timestamp: ts,
          seconds: parseTimestampToSeconds(ts),
          title: chTitle
        });
      }
    }

    // Bóc tách Phụ đề XML TimedText thành các câu hoàn chỉnh
    const captionTracks = ((playerData.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || [];
    const selectedTrack = captionTracks.find(t => (t.languageCode || '').startsWith('vi')) ||
                          captionTracks.find(t => (t.languageCode || '').startsWith('en')) ||
                          captionTracks[0];

    let sentences = [];
    if (selectedTrack && selectedTrack.baseUrl) {
      const rawXml = await hybridHttpRequest({
        url: selectedTrack.baseUrl,
        method: 'GET',
        headers: { 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)' }
      });
      sentences = buildCompleteSentencesFromXml(rawXml);
    }

    // Nếu video chưa chia sẵn Chapter -> tự động chia thành 5-6 phân đoạn theo mạch thời gian
    if (!chapters.length && sentences.length >= 6) {
      const numBlocks = Math.min(6, Math.max(3, Math.floor(sentences.length / 8)));
      const step = Math.ceil(sentences.length / numBlocks);
      for (let b = 0; b < numBlocks; b++) {
        const sIdx = b * step;
        if (sIdx >= sentences.length) break;
        const firstSent = sentences[sIdx];
        chapters.push({
          timestamp: firstSent.timestamp,
          seconds: firstSent.start_seconds,
          title: `Phần ${b + 1}: Nội dung trọng tâm (${firstSent.timestamp})`
        });
      }
    }

    const { scores, topKeywords } = await computeTfIdfScoresAsync(sentences, title);
    const fullCorpus = `${title} ${description} ${sentences.map(s => s.text).join(' ')}`;
    const category = detectCategory(fullCorpus, title, topKeywords);

    // Tổng hợp mạch lạc từng Chương mục (Coherent Chapter Synthesis)
    const coreIdeas = [];
    if (chapters.length && sentences.length) {
      for (let i = 0; i < chapters.length; i++) {
        const startS = chapters[i].seconds;
        const endS = i + 1 < chapters.length ? chapters[i + 1].seconds : 999999;
        const chSents = [];
        const chScores = [];
        for (let j = 0; j < sentences.length; j++) {
          if (sentences[j].start_seconds >= startS && sentences[j].start_seconds < endS) {
            chSents.push(sentences[j]);
            chScores.push(scores[j]);
          }
        }
        if (chSents.length) {
          const synthesized = synthesizeChapterParagraph(chapters[i].title, chSents, chScores);
          coreIdeas.push({
            chapter: `${i + 1}. ${chapters[i].title}`,
            timestamp: chapters[i].timestamp,
            seconds: chapters[i].seconds,
            content: synthesized
          });
        }
      }
    }

    // Lọc bỏ các dòng quảng cáo / link tài trợ trong Description
    const promoRe = /https?:\/\/|sponsor|subscribe|follow|discount|promo|newsletter|podcast|get agents that|check out/i;
    const cleanDescLines = description
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 35 && !promoRe.test(l) && !/^\d{1,2}:\d{2}/.test(l));

    // Xây dựng Tổng quan nội dung chính (Executive Summary) có mạch liên kết từ đầu đến cuối
    const summaryPillars = coreIdeas.slice(0, 4).map(c => c.content.split('. ')[0] + '.');
    const oneLiner = cleanDescLines[0] ||
      `Phân tích chuyên sâu từ ${channel} về "${title}" xoay quanh ${chapters.length || coreIdeas.length} chủ đề cốt lõi.`;
    const execSummary = [
      cleanDescLines.slice(0, 2).join(' '),
      summaryPillars.join(' ')
    ].filter(Boolean).join(' ').slice(0, 950) || oneLiner;

    // Rút trích Đúc kết sâu (Key Insights) & Khuyến nghị hành động (Actionable Steps) hoàn chỉnh
    const insightRe = /\b(bài học|bản chất|thực chất|quy luật|nguyên lý|reason why|truth is|realize|difference between|important thing|key is|fundamental|paradigm|multiplier)\b/i;
    const actionRe = /\b(bước \d|thứ nhất|thứ hai|cách làm|khuyến nghị|start with|you should|need to build|question to ask|how to|step one|take back to your team|walk away with|pick a metric)\b/i;

    const keyInsights = [];
    const actionableSteps = [];
    const rankedIdx = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);

    for (const { i } of rankedIdx) {
      const seg = sentences[i];
      if (!seg || seg.text.length < 55 || CONVERSATIONAL_NOISE_RE.test(seg.text)) continue;
      // Ghép câu hiện tại với câu kế tiếp để đảm bảo trọn vẹn ý nghĩa
      const nextSeg = (i + 1 < sentences.length) ? sentences[i + 1].text : '';
      const combinedContent = (seg.text.length < 130 && nextSeg && !CONVERSATIONAL_NOISE_RE.test(nextSeg))
        ? `${seg.text} ${nextSeg}`
        : seg.text;
      const entry = { timestamp: seg.timestamp, seconds: seg.start_seconds, content: combinedContent };
      if (actionRe.test(combinedContent) && actionableSteps.length < 4) actionableSteps.push(entry);
      else if (insightRe.test(combinedContent) && keyInsights.length < 4) keyInsights.push(entry);
    }

    const combinedTags = Array.from(new Set([...keywords.map(k => k.toLowerCase()), ...topKeywords])).slice(0, 10);
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

    return {
      id: `yt_${videoId}`,
      schema_version: CURRENT_SCHEMA_VERSION,
      resource_type: 'youtube_video',
      metadata: {
        video_id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title,
        channel,
        duration: formatTimestamp(lengthSeconds),
        duration_seconds: lengthSeconds,
        publish_date: nowStr.slice(0, 10),
        extracted_at: nowStr
      },
      chat_context: {
        shared_by: sharedBy,
        chat_group: chatGroup,
        shared_at: nowStr,
        sender_note: senderNote || 'Lưu trực tiếp từ đường dẫn YouTube'
      },
      taxonomy: {
        category,
        tags: combinedTags,
        search_aliases: [removeVietnameseAccents(title), removeVietnameseAccents(category), ...combinedTags]
      },
      summary: {
        one_liner: oneLiner,
        executive_summary: execSummary
      },
      wisdom_distillation: {
        core_ideas: coreIdeas,
        key_insights: keyInsights.sort((a, b) => a.seconds - b.seconds),
        actionable_steps: actionableSteps.sort((a, b) => a.seconds - b.seconds),
        facts_and_metrics: [],
        mentioned_references: []
      },
      timeline: {
        chapters,
        visual_slides: []
      },
      transcript_corpus: sentences
    };
  }

  /**
   * 4B. BỘ BÓC TÁCH & TỔNG HỢP GITHUB REPOSITORY CHuyên SÂU (API + RAW README.MD AST PARSER)
   * Tuyệt đối không quét HTML trang chủ GitHub (tránh rác Menu / React JSON / SVG).
   */
  function cleanMarkdownLine(line) {
    let s = String(line || '');
    // Loại bỏ huy hiệu (badges) [![...](...)](...) và ảnh ![...](...)
    s = s.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    // Chuyển link [text](url) thành text
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Loại bỏ thẻ HTML (<div...>, <svg...>, <img...>, <a...>)
    s = s.replace(/<[^>]+>/g, ' ');
    // Loại bỏ ký hiệu định dạng đậm/nghiêng/code inline dư thừa nhưng giữ nội dung
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    return decodeHtmlEntities(s).replace(/\s+/g, ' ').trim();
  }

  function parseMarkdownReadmeSections(mdText, repoTitle) {
    const lines = String(mdText || '').split(/\r?\n/);
    const sections = [];
    let currentTitle = 'Tổng quan & Giới thiệu (Overview)';
    let currentParagraphs = [];
    let inCodeBlock = false;
    const codeSnippets = [];
    let curCode = [];

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('```')) {
        if (inCodeBlock) {
          if (curCode.length) codeSnippets.push(curCode.join(' ').slice(0, 220));
          curCode = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) {
        if (trimmed && !trimmed.startsWith('#')) curCode.push(trimmed);
        continue;
      }

      // Phát hiện Heading (#, ##, ###)
      const hMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (hMatch) {
        const cleanH = cleanMarkdownLine(hMatch[2]);
        if (currentParagraphs.length > 0) {
          sections.push({
            title: currentTitle,
            content: currentParagraphs.join(' ')
          });
          currentParagraphs = [];
        }
        if (cleanH && cleanH.toLowerCase() !== repoTitle.toLowerCase()) {
          currentTitle = cleanH;
        }
        continue;
      }

      // Xử lý dòng bảng Markdown (| File | Purpose |) -> chuyển thành câu mô tả có nghĩa
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        if (/^[|\s:-]+$/.test(trimmed)) continue;
        const cells = trimmed.split('|').map(c => cleanMarkdownLine(c)).filter(Boolean);
        if (cells.length >= 2 && !/^(file|name|command|option|column)$/i.test(cells[0])) {
          currentParagraphs.push(`• ${cells[0]}: ${cells.slice(1).join(' — ')}.`);
        }
        continue;
      }

      // Xử lý danh sách gạch đầu dòng hoặc đánh số
      if (/^([-*+]|\d+\.)\s+/.test(trimmed)) {
        const cleanItem = cleanMarkdownLine(trimmed.replace(/^([-*+]|\d+\.)\s+/, ''));
        if (cleanItem.length >= 15) {
          currentParagraphs.push(`• ${cleanItem}${/[.!?]$/.test(cleanItem) ? '' : '.'}`);
        }
        continue;
      }

      const cleanP = cleanMarkdownLine(trimmed);
      if (cleanP.length >= 25) {
        currentParagraphs.push(`${cleanP}${/[.!?]$/.test(cleanP) ? '' : '.'}`);
      }
    }

    if (currentParagraphs.length > 0) {
      sections.push({
        title: currentTitle,
        content: currentParagraphs.join(' ')
      });
    }

    return {
      sections: sections.filter(s => s.content.length >= 30 && !/^(license|contact|contributing|acknowledgements)$/i.test(s.title)),
      codeSnippets
    };
  }

  async function extractGitHubRepoCard(extractedUrl, { senderNote = '', sharedBy = 'User', chatGroup = 'General' } = {}) {
    const ghMatch = String(extractedUrl).match(GITHUB_REGEX);
    if (!ghMatch) throw new Error('Đường dẫn GitHub không hợp lệ.');
    const owner = ghMatch[1].replace(/[.,;)]+$/, '');
    const repo = ghMatch[2].replace(/\.git$/i, '').replace(/[.,;)]+$/, '');
    const canonicalUrl = `https://github.com/${owner}/${repo}`;

    // Kiểm tra nếu trùng với bản ghi mẫu chuẩn v3 đã tinh chỉnh -> trả về ngay
    if (global.__CHAT_VAULT_INITIAL_SEED && Array.isArray(global.__CHAT_VAULT_INITIAL_SEED)) {
      const preset = global.__CHAT_VAULT_INITIAL_SEED.find(
        s => s.metadata && s.metadata.url &&
             s.metadata.url.toLowerCase() === canonicalUrl.toLowerCase()
      );
      if (preset) {
        const cloned = JSON.parse(JSON.stringify(preset));
        cloned.schema_version = CURRENT_SCHEMA_VERSION;
        if (senderNote) cloned.chat_context.sender_note = senderNote;
        return cloned;
      }
    }

    let repoMeta = {};
    try {
      const rawApi = await hybridHttpRequest({
        url: `https://api.github.com/repos/${owner}/${repo}`,
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'KryptoKnowledgeVault/3.0'
        }
      });
      repoMeta = JSON.parse(rawApi || '{}');
    } catch (_) {}

    const defaultBranch = repoMeta.default_branch || 'main';
    const stars = Number(repoMeta.stargazers_count || 0);
    const language = repoMeta.language || 'Multi-language';
    const apiDesc = repoMeta.description || '';
    const topics = Array.isArray(repoMeta.topics) ? repoMeta.topics : [];

    // Tải nguyên văn README.md dạng Markdown thô (không chứa rác giao diện GitHub)
    let readmeMd = '';
    const candidateUrls = [
      `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/README.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/readme.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`
    ];
    for (const rawUrl of candidateUrls) {
      try {
        const txt = await hybridHttpRequest({
          url: rawUrl,
          method: 'GET',
          headers: { 'User-Agent': 'KryptoKnowledgeVault/3.0' }
        });
        if (txt && txt.trim().length > 20 && !txt.trim().startsWith('<!DOCTYPE html')) {
          readmeMd = txt;
          break;
        }
      } catch (_) {}
    }

    if (!readmeMd) {
      try {
        const rawApiReadme = await hybridHttpRequest({
          url: `https://api.github.com/repos/${owner}/${repo}/readme`,
          method: 'GET',
          headers: {
            'Accept': 'application/vnd.github.raw+json',
            'User-Agent': 'KryptoKnowledgeVault/3.0'
          }
        });
        if (rawApiReadme && rawApiReadme.trim().length > 20 && !rawApiReadme.trim().startsWith('<!DOCTYPE html')) {
          readmeMd = rawApiReadme;
        }
      } catch (_) {}
    }

    let { sections, codeSnippets } = parseMarkdownReadmeSections(readmeMd, repo);
    const starText = stars > 0 ? ` (★ ${stars.toLocaleString()})` : '';
    const fullTitle = `[GitHub] ${owner}/${repo}${starText} — ${apiDesc || 'Open Source Repository & Technical Documentation'}`;

    if (!sections.length) {
      sections = [{
        title: 'Repository Overview & Features',
        content: [
          apiDesc ? `Project overview: ${apiDesc}.` : `GitHub repository ${owner}/${repo}.`,
          `Primary language: ${language}${starText}.`,
          topics.length ? `Technical topics: ${topics.join(', ')}.` : '',
          readmeMd ? cleanMarkdownLine(readmeMd.slice(0, 500)) : ''
        ].filter(Boolean).join(' ')
      }];
    }

    const overviewSec = sections[0] ? sections[0].content : '';
    const secondSec = sections[1] ? `${sections[1].title}: ${sections[1].content.slice(0, 380)}` : '';
    const oneLiner = apiDesc
      ? `${apiDesc} (Language: ${language}${starText}).`
      : (overviewSec.slice(0, 220) || fullTitle);

    const execSummary = [
      apiDesc ? `Project overview: ${apiDesc}.` : '',
      overviewSec.slice(0, 520),
      secondSec
    ].filter(Boolean).join(' ').slice(0, 1050) || oneLiner;

    const coreIdeas = sections.slice(0, 6).map((sec, idx) => ({
      chapter: `${idx + 1}. ${sec.title}`,
      timestamp: `Section ${idx + 1}`,
      seconds: idx,
      content: sec.content.slice(0, 650)
    }));

    const keyInsights = [];
    const actionableSteps = [];
    for (const sec of sections) {
      const lowerT = sec.title.toLowerCase();
      if (/principle|architecture|why|design|feature|how it works|security|what it does/.test(lowerT) && keyInsights.length < 4) {
        keyInsights.push({
          timestamp: sec.title.slice(0, 28),
          seconds: 0,
          content: sec.content.slice(0, 420)
        });
      }
      if (/install|usage|quick start|getting started|setup|deploy|workflow/.test(lowerT) && actionableSteps.length < 4) {
        const cmdNote = codeSnippets[0] ? ` (Command: ${codeSnippets[0]})` : '';
        actionableSteps.push({
          timestamp: sec.title.slice(0, 28),
          seconds: 0,
          content: `${sec.content.slice(0, 360)}${cmdNote}`
        });
      }
    }

    const category = detectCategory(`${fullTitle} ${readmeMd.slice(0, 2000)}`, fullTitle, topics);
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const tags = Array.from(new Set([owner.toLowerCase(), repo.toLowerCase(), language.toLowerCase(), ...topics])).slice(0, 8);

    return {
      id: `gh_${simpleHash(canonicalUrl)}`,
      schema_version: CURRENT_SCHEMA_VERSION,
      resource_type: 'github_repo',
      metadata: {
        url: canonicalUrl,
        title: fullTitle,
        channel: `github.com/${owner}`,
        duration: `${sections.length} mục tài liệu • ${language}`,
        publish_date: nowStr.slice(0, 10),
        extracted_at: nowStr
      },
      chat_context: {
        shared_by: sharedBy,
        chat_group: chatGroup,
        shared_at: nowStr,
        sender_note: senderNote || 'Lưu từ liên kết GitHub chia sẻ'
      },
      taxonomy: {
        category,
        tags,
        search_aliases: [removeVietnameseAccents(fullTitle), owner.toLowerCase(), repo.toLowerCase()]
      },
      summary: {
        one_liner: oneLiner,
        executive_summary: execSummary
      },
      wisdom_distillation: {
        core_ideas: coreIdeas,
        key_insights: keyInsights,
        actionable_steps: actionableSteps,
        facts_and_metrics: [],
        mentioned_references: [{ name: `${owner}/${repo}`, url: canonicalUrl, type: 'github_repo' }]
      },
      timeline: {
        chapters: coreIdeas.map((c, i) => ({
          timestamp: `Mục ${i + 1}`,
          seconds: i,
          title: c.chapter
        })),
        visual_slides: []
      },
      transcript_corpus: sections.map((s, i) => ({
        timestamp: `Mục ${i + 1}`,
        start_seconds: i,
        text: `${s.title}: ${s.content}`
      }))
    };
  }


  /**
   * 4C. BỘ PHÁT HIỆN TRÙNG LẶP 3 TẦNG (CANONICAL URL + JACCARD/COSINE SEMANTIC SIMILARITY >= 72%)
   */
  const TRACKING_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'si', 'feature', 'ref', 's', 'spm', 'igshid', '_ga'
  ]);

  function normalizeCanonicalUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return '';
    const ytMatch = trimmed.match(YOUTUBE_REGEX);
    if (ytMatch) {
      return `https://www.youtube.com/watch?v=${ytMatch[1]}`;
    }
    const ghMatch = trimmed.match(GITHUB_REGEX);
    if (ghMatch) {
      const owner = ghMatch[1].toLowerCase();
      const repo = ghMatch[2].replace(/\.git$/i, '').toLowerCase();
      return `https://github.com/${owner}/${repo}`;
    }
    try {
      const u = new URL(trimmed);
      u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
      for (const k of Array.from(u.searchParams.keys())) {
        if (TRACKING_PARAMS.has(k.toLowerCase())) {
          u.searchParams.delete(k);
        }
      }
      let out = u.toString();
      if (out.endsWith('/') && u.pathname !== '/') {
        out = out.slice(0, -1);
      }
      return out;
    } catch (_) {
      return trimmed;
    }
  }

  function extractSemanticTokens(recordOrText) {
    let raw = '';
    if (typeof recordOrText === 'string') {
      raw = recordOrText;
    } else if (recordOrText && typeof recordOrText === 'object') {
      const m = recordOrText.metadata || {};
      const s = recordOrText.summary || {};
      const w = recordOrText.wisdom_distillation || {};
      const ideas = (w.core_ideas || []).map(c => c.content || '').join(' ');
      const enTitle = (recordOrText.i18n && recordOrText.i18n.en && recordOrText.i18n.en.title) || '';
      const enExec = (recordOrText.i18n && recordOrText.i18n.en && recordOrText.i18n.en.executive_summary) || '';
      raw = `${m.title || ''} ${s.one_liner || ''} ${s.executive_summary || ''} ${ideas} ${enTitle} ${enExec}`;
    }
    const norm = removeVietnameseAccents(raw).toLowerCase();
    const words = (norm.match(/[a-z0-9]{3,}/g) || []).filter(w => !STOPWORDS.has(w));
    return words;
  }

  function computeContentSimilarity(recA, recB) {
    const tokensA = extractSemanticTokens(recA);
    const tokensB = extractSemanticTokens(recB);
    if (tokensA.length < 4 || tokensB.length < 4) return 0;

    // 1. Cosine Similarity trên Vector tần suất từ khóa (TF Cosine)
    const freqA = new Map();
    const freqB = new Map();
    for (const w of tokensA) freqA.set(w, (freqA.get(w) || 0) + 1);
    for (const w of tokensB) freqB.set(w, (freqB.get(w) || 0) + 1);

    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (const [w, cA] of freqA.entries()) {
      magA += cA * cA;
      if (freqB.has(w)) {
        dot += cA * freqB.get(w);
      }
    }
    for (const cB of freqB.values()) {
      magB += cB * cB;
    }
    const cosine = (magA > 0 && magB > 0) ? (dot / (Math.sqrt(magA) * Math.sqrt(magB))) : 0;

    // 2. Bigram Shingle Jaccard (bắt cấu trúc cụm từ 2 từ liên tiếp)
    const bigramsA = new Set();
    const bigramsB = new Set();
    for (let i = 0; i < Math.min(tokensA.length - 1, 250); i++) {
      bigramsA.add(`${tokensA[i]}_${tokensA[i + 1]}`);
    }
    for (let i = 0; i < Math.min(tokensB.length - 1, 250); i++) {
      bigramsB.add(`${tokensB[i]}_${tokensB[i + 1]}`);
    }
    let inter = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) inter++;
    }
    const union = bigramsA.size + bigramsB.size - inter;
    const bigramJaccard = union > 0 ? (inter / union) : 0;

    return Math.min(1.0, cosine * 0.72 + bigramJaccard * 0.28);
  }

  async function findDuplicateInVault(rawInput, candidateRecord = null) {
    const allItems = await getAllItemsFromIDB();
    if (!allItems.length) return null;

    const cleaned = String(rawInput || '').trim();
    const urlMatch = cleaned.match(URL_REGEX);

    // Tầng 1: Kiểm tra trùng khớp tuyệt đối theo Canonical URL / Video ID / Repo
    if (urlMatch) {
      const canonInput = normalizeCanonicalUrl(urlMatch[1]);
      const ytMatch = canonInput.match(YOUTUBE_REGEX);
      const targetYtId = ytMatch ? `yt_${ytMatch[1]}` : null;

      for (const item of allItems) {
        if (targetYtId && item.id === targetYtId) {
          return { matchedItem: item, similarity: 1.0, duplicateType: 'exact_url' };
        }
        const itemUrl = (item.metadata && item.metadata.url) ? normalizeCanonicalUrl(item.metadata.url) : '';
        if (itemUrl && canonInput && itemUrl.toLowerCase() === canonInput.toLowerCase()) {
          return { matchedItem: item, similarity: 1.0, duplicateType: 'exact_url' };
        }
      }
    } else if (!candidateRecord) {
      // Nếu là ghi chú văn bản thuần túy: kiểm tra mã băm hoặc độ tương đồng trực tiếp với các ghi chú đã có
      const noteId = `note_${simpleHash(cleaned)}`;
      for (const item of allItems) {
        if (item.id === noteId) {
          return { matchedItem: item, similarity: 1.0, duplicateType: 'exact_text' };
        }
      }
    }

    // Tầng 2: Kiểm tra độ tương đồng ngữ nghĩa (Semantic Similarity >= 0.72)
    const probe = candidateRecord || cleaned;
    let bestMatch = null;
    let bestSim = 0;
    for (const item of allItems) {
      if (candidateRecord && item.id === candidateRecord.id) {
        return { matchedItem: item, similarity: 1.0, duplicateType: 'exact_id' };
      }
      const sim = computeContentSimilarity(probe, item);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = item;
      }
    }

    if (bestMatch && bestSim >= 0.72) {
      return { matchedItem: bestMatch, similarity: bestSim, duplicateType: 'semantic_content' };
    }
    return null;
  }

  async function scanAndMergeVaultDuplicates() {
    const allItems = await getAllItemsFromIDB();
    if (allItems.length < 2) {
      return { mergedCount: 0, remainingCount: allItems.length, details: [] };
    }

    const removedIds = new Set();
    const details = [];

    for (let i = 0; i < allItems.length; i++) {
      const primary = allItems[i];
      if (removedIds.has(primary.id)) continue;
      const canonA = (primary.metadata && primary.metadata.url) ? normalizeCanonicalUrl(primary.metadata.url) : '';

      for (let j = i + 1; j < allItems.length; j++) {
        const secondary = allItems[j];
        if (removedIds.has(secondary.id)) continue;
        const canonB = (secondary.metadata && secondary.metadata.url) ? normalizeCanonicalUrl(secondary.metadata.url) : '';

        const isSameUrl = canonA && canonB && canonA !== 'chat://local-note' && canonA.toLowerCase() === canonB.toLowerCase();
        const sim = isSameUrl ? 1.0 : computeContentSimilarity(primary, secondary);

        if (isSameUrl || sim >= 0.75) {
          // Gộp tags & ghi chú từ bản trùng sang bản chính
          primary.taxonomy = primary.taxonomy || {};
          const mergedTags = Array.from(new Set([...(primary.taxonomy.tags || []), ...((secondary.taxonomy && secondary.taxonomy.tags) || [])])).slice(0, 12);
          primary.taxonomy.tags = mergedTags;

          const noteA = (primary.chat_context && primary.chat_context.sender_note) || '';
          const noteB = (secondary.chat_context && secondary.chat_context.sender_note) || '';
          if (noteB && !noteA.includes(noteB)) {
            primary.chat_context.sender_note = noteA ? `${noteA} | ${noteB}` : noteB;
          }

          await putItemToIDB(primary);
          await deleteItemFromIDB(secondary.id);
          removedIds.add(secondary.id);
          details.push({
            keptTitle: (primary.metadata && primary.metadata.title) || primary.id,
            removedTitle: (secondary.metadata && secondary.metadata.title) || secondary.id,
            similarity: Math.round(sim * 100)
          });
        }
      }
    }

    if (removedIds.size > 0) {
      await syncBackupToNativeStorage();
    }

    return {
      mergedCount: removedIds.size,
      remainingCount: allItems.length - removedIds.size,
      details
    };
  }

  /**
   * 5. BỘ ĐIỀU PHỐI ĐA NĂNG (UNIVERSAL INGEST ROUTER)
   */
  function extractMetaTagContent(rawHtml, propOrName) {
    if (!rawHtml) return '';
    const escaped = propOrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i');
    const m1 = rawHtml.match(re1);
    if (m1 && m1[1]) return decodeHtmlEntities(m1[1]).trim();
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i');
    const m2 = rawHtml.match(re2);
    if (m2 && m2[1]) return decodeHtmlEntities(m2[1]).trim();
    return '';
  }

  function isAllCapsSectionHeading(line) {
    const s = String(line || '').trim();
    if (s.length < 6 || s.length > 115) return false;
    if (/[.,;:]$/.test(s)) return false;
    const words = s.split(/\s+/);
    if (words.length < 2) return false;
    const letters = (s.match(/[A-Za-zÀ-ỹ]/g) || []);
    if (letters.length < 4) return false;
    return s === s.toUpperCase();
  }

  function clipAtSentenceBoundary(text, maxChars = 480) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= maxChars) return s;
    const slice = s.slice(0, maxChars);
    const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
    if (lastPeriod >= Math.floor(maxChars * 0.55)) {
      return slice.slice(0, lastPeriod + 1).trim();
    }
    return slice.trim() + '...';
  }

  function parseStructuredArticleSections(fullText, fallbackTitle = '') {
    const rawLines = String(fullText || '')
      .split(/\r?\n/)
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    let detectedMainTitle = '';
    const sections = [];
    let currentSection = null;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      // Bỏ qua các dòng chú thích mở đầu trong ngoặc đơn ngắn
      if (/^[\(\[].*[\)\]]$/.test(line) && line.length < 130) {
        continue;
      }

      const mdMatch = line.match(/^#{1,4}\s+(.{4,115})$/);
      const numMatch = line.match(/^(?:Phần|Mục|Chương|Part|Section|\d+[\.\)]|[IVX]+[\.\)])\s+(.{4,115})$/i);
      const isCaps = isAllCapsSectionHeading(line);

      if (mdMatch || numMatch || isCaps) {
        const headingText = mdMatch ? mdMatch[1].trim() : line;
        if (i === 0 && !detectedMainTitle) {
          detectedMainTitle = headingText;
          currentSection = {
            heading: `Bối cảnh & Đặt vấn đề: ${headingText}`,
            paragraphs: []
          };
          sections.push(currentSection);
        } else {
          currentSection = {
            heading: headingText,
            paragraphs: []
          };
          sections.push(currentSection);
        }
      } else {
        if (!currentSection) {
          currentSection = {
            heading: 'Tổng quan & Đặt vấn đề',
            paragraphs: []
          };
          sections.push(currentSection);
        }
        currentSection.paragraphs.push(line);
      }
    }

    const nonEmptySections = sections.filter(sec => sec.paragraphs.length > 0);

    // Nếu văn bản không có tiêu đề con tường minh nhưng có nhiều đoạn văn -> tự động chia thành 4-6 phần mạch lạc
    if (nonEmptySections.length <= 1 && rawLines.length >= 4) {
      const substantiveParas = rawLines.filter(p => p.length >= 45 && !/^[\(\[].*[\)\]]$/.test(p));
      if (substantiveParas.length >= 3) {
        nonEmptySections.length = 0;
        const targetGroupCount = Math.min(6, Math.max(3, Math.ceil(substantiveParas.length / 3)));
        const chunkSize = Math.ceil(substantiveParas.length / targetGroupCount);
        for (let g = 0; g < substantiveParas.length; g += chunkSize) {
          const groupParas = substantiveParas.slice(g, g + chunkSize);
          const firstSent = (groupParas[0].split(/(?<=[.!?])\s+/)[0] || groupParas[0]).slice(0, 78);
          nonEmptySections.push({
            heading: firstSent.length < groupParas[0].length ? `${firstSent}...` : firstSent,
            paragraphs: groupParas
          });
        }
      }
    }

    // Tổng hợp tất cả đoạn văn thực chất
    const allParas = [];
    for (const sec of nonEmptySections) {
      for (const p of sec.paragraphs) {
        if (p.length >= 25) allParas.push(p);
      }
    }
    if (allParas.length === 0 && rawLines.length > 0) {
      allParas.push(...rawLines);
    }

    const firstPara = allParas[0] || fallbackTitle;
    const lastPara = allParas.length > 1 ? allParas[allParas.length - 1] : '';
    const oneLiner = clipAtSentenceBoundary(firstPara, 260);

    // Xây dựng Executive Summary tổng hợp mở đầu + các trục nội dung chính + kết luận
    const sectionTitlesList = nonEmptySections
      .map(s => s.heading.replace(/^Bối cảnh & Đặt vấn đề:\s*/i, ''))
      .filter(Boolean);
    let execSummary = firstPara;
    if (allParas.length > 2) {
      const secondPara = allParas[1];
      execSummary = `${clipAtSentenceBoundary(firstPara, 320)} ${clipAtSentenceBoundary(secondPara, 260)}`;
    }
    if (lastPara && lastPara !== firstPara) {
      execSummary = `${execSummary} Kết luận trọng tâm: ${clipAtSentenceBoundary(lastPara, 260)}`;
    }
    execSummary = clipAtSentenceBoundary(execSummary, 860);

    // Xây dựng Chapters & Core Ideas theo từng Phần / Chương mục
    const chapters = [];
    const coreIdeas = [];
    nonEmptySections.slice(0, 8).forEach((sec, idx) => {
      const secLabel = `Phần ${idx + 1}`;
      const cleanHeading = sec.heading.replace(/^\d+\.\s*/, '');
      chapters.push({
        timestamp: secLabel,
        seconds: idx,
        title: `${idx + 1}. ${cleanHeading}`
      });

      let secSynthesis = sec.paragraphs[0] || '';
      if (sec.paragraphs.length >= 2) {
        const lastSecPara = sec.paragraphs[sec.paragraphs.length - 1];
        const firstPart = clipAtSentenceBoundary(sec.paragraphs[0], 260);
        const secondPart = clipAtSentenceBoundary(lastSecPara, 220);
        secSynthesis = (lastSecPara !== sec.paragraphs[0]) ? `${firstPart} ${secondPart}` : firstPart;
      } else {
        secSynthesis = clipAtSentenceBoundary(secSynthesis, 450);
      }

      coreIdeas.push({
        chapter: `${idx + 1}. ${cleanHeading}`,
        timestamp: secLabel,
        seconds: idx,
        content: secSynthesis
      });
    });

    // Rút trích Key Insights (các đoạn có số liệu, dẫn chứng, năm, CVE, nguyên lý cốt lõi)
    const keyInsights = [];
    const insightCandidates = allParas.filter(
      p => p.length >= 90 && (/\b(20\d\d|CVE-|\d+%|\d+\.\d+|nguyên lý|bất biến|kiểm chứng|chứng minh|kiến trúc|lỗ hổng|rủi ro|chi phí|principle|invariant|security)\b/i.test(p))
    );
    (insightCandidates.length ? insightCandidates : allParas.slice(1)).slice(0, 5).forEach((p, idx) => {
      keyInsights.push({
        timestamp: `Đúc kết ${idx + 1}`,
        seconds: idx,
        content: clipAtSentenceBoundary(p, 360)
      });
    });

    // Rút trích Actionable Steps (các đoạn khuyến nghị, giải pháp, hướng đi, đào tạo, tái thiết)
    const actionableSteps = [];
    const actionCandidates = allParas.filter(
      p => p.length >= 80 && (/\b(phải|cần|hãy|bắt đầu từ|khuyến nghị|giải pháp|đào tạo|thiết kế|xây dựng|kiểm soát|chuyển đổi|must|should|need to|build|verify)\b/i.test(p))
    );
    (actionCandidates.length ? actionCandidates.slice(-4) : allParas.slice(-3)).forEach((p, idx) => {
      actionableSteps.push({
        timestamp: `Hành động ${idx + 1}`,
        seconds: idx,
        content: clipAtSentenceBoundary(p, 350)
      });
    });

    return {
      detectedMainTitle: detectedMainTitle || fallbackTitle,
      allParas,
      oneLiner,
      execSummary,
      chapters,
      coreIdeas,
      keyInsights,
      actionableSteps,
      sectionTitlesList
    };
  }

  async function extractFacebookPostCard(extractedUrl, { senderNote = '', sharedBy = 'User', chatGroup = 'General' } = {}) {
    let htmlText = '';
    try {
      htmlText = await hybridHttpRequest({
        url: extractedUrl,
        method: 'GET',
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8'
        }
      });
    } catch (e) {
      console.warn('[ChatVaultEngine] Lỗi tải Facebook HTML:', e);
    }

    const ogTitle = extractMetaTagContent(htmlText, 'og:title');
    const ogDesc = extractMetaTagContent(htmlText, 'og:description');
    const ogUrl = extractMetaTagContent(htmlText, 'og:url') || extractedUrl;

    // 1. Trích xuất tên tác giả / người đăng từ khối Relay JSON "actors"
    const actorNames = [];
    const actorRegex = /"actors"\s*:\s*\[\s*\{\s*"__typename"\s*:\s*"(?:User|Page)"[\s\S]{0,180}?"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let actMatch;
    while ((actMatch = actorRegex.exec(htmlText)) !== null) {
      try {
        const decodedName = JSON.parse('"' + actMatch[1] + '"').trim();
        if (decodedName && !actorNames.includes(decodedName)) {
          actorNames.push(decodedName);
        }
      } catch (_) {}
    }

    // 2. Trích xuất toàn văn nội dung bài viết từ các khối Relay JSON `"text":"..."` trước khi lọc script
    const relayTexts = [];
    const textRegex = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let txtMatch;
    while ((txtMatch = textRegex.exec(htmlText)) !== null) {
      const rawCandidate = txtMatch[1];
      if (rawCandidate.length < 40) continue;
      try {
        const decodedTxt = JSON.parse('"' + rawCandidate + '"').trim();
        if (
          decodedTxt.length >= 40 &&
          !decodedTxt.includes('{"props":') &&
          !decodedTxt.includes('function(') &&
          !relayTexts.includes(decodedTxt)
        ) {
          relayTexts.push(decodedTxt);
        }
      } catch (_) {}
    }
    relayTexts.sort((a, b) => b.length - a.length);

    let fullPostBody = '';
    if (relayTexts.length > 0) {
      fullPostBody = relayTexts[0];
      // Nếu có lời bình của người chia sẻ (ngắn hơn và không nằm trong bài gốc) thì ghép vào
      if (relayTexts.length > 1 && !fullPostBody.includes(relayTexts[1]) && relayTexts[1].length >= 40) {
        fullPostBody = `${relayTexts[1]}\n\n${fullPostBody}`;
      }
    } else if (ogDesc) {
      fullPostBody = ogDesc;
    } else if (senderNote) {
      fullPostBody = senderNote;
    }

    let authorLabel = actorNames[0] || ogTitle || 'Facebook';
    if (actorNames.length >= 2) {
      const outerSharer = ogTitle && actorNames.find(a => a.toLowerCase() === ogTitle.toLowerCase());
      const origAuthor = ogTitle && actorNames.find(a => a.toLowerCase() !== ogTitle.toLowerCase());
      if (outerSharer && origAuthor) {
        authorLabel = `${origAuthor} (Chia sẻ bởi: ${outerSharer})`;
      } else {
        authorLabel = `${actorNames[0]} (Chia sẻ bởi: ${actorNames[1]})`;
      }
    }

    const parsed = parseStructuredArticleSections(fullPostBody, ogTitle || 'Bài viết Facebook');
    let finalTitle = parsed.detectedMainTitle || ogTitle || 'Bài viết chia sẻ từ Facebook';
    if (finalTitle === ogTitle && parsed.allParas.length > 0) {
      const firstSentence = (parsed.allParas[0].split(/(?<=[.!?])\s+/)[0] || parsed.allParas[0]).slice(0, 95);
      finalTitle = `${firstSentence} — ${authorLabel}`;
    } else if (authorLabel && !finalTitle.toLowerCase().includes(authorLabel.toLowerCase())) {
      finalTitle = `${finalTitle} — ${authorLabel}`;
    }

    const pseudoSegments = parsed.allParas.map((p, i) => ({
      timestamp: `Đoạn ${i + 1}`,
      start_seconds: i,
      text: p
    }));

    const { topKeywords } = await computeTfIdfScoresAsync(pseudoSegments, finalTitle);
    const category = detectCategory(`${finalTitle} ${senderNote} ${fullPostBody.slice(0, 3000)}`, finalTitle, topKeywords);
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const wordCount = fullPostBody ? fullPostBody.split(/\s+/).filter(Boolean).length : 0;

    return {
      id: `web_${simpleHash(extractedUrl)}`,
      schema_version: CURRENT_SCHEMA_VERSION,
      resource_type: 'web_article',
      metadata: {
        url: extractedUrl,
        canonical_url: ogUrl,
        title: finalTitle,
        channel: `Facebook • ${authorLabel}`,
        duration: `${parsed.coreIdeas.length} phần • ${ parsed.allParas.length } đoạn (${wordCount} từ)`,
        publish_date: nowStr.slice(0, 10),
        extracted_at: nowStr
      },
      chat_context: {
        shared_by: sharedBy,
        chat_group: chatGroup,
        shared_at: nowStr,
        sender_note: senderNote || `Chia sẻ bài viết từ Facebook (${authorLabel})`
      },
      taxonomy: {
        category,
        tags: topKeywords.slice(0, 10),
        search_aliases: [
          removeVietnameseAccents(finalTitle),
          removeVietnameseAccents(authorLabel),
          removeVietnameseAccents(category)
        ]
      },
      summary: {
        one_liner: parsed.oneLiner || finalTitle,
        executive_summary: parsed.execSummary || finalTitle
      },
      wisdom_distillation: {
        core_ideas: parsed.coreIdeas,
        key_insights: parsed.keyInsights,
        actionable_steps: parsed.actionableSteps,
        facts_and_metrics: [],
        mentioned_references: [{ name: finalTitle, url: ogUrl, type: 'facebook_post' }]
      },
      timeline: {
        chapters: parsed.chapters,
        visual_slides: []
      },
      transcript_corpus: pseudoSegments
    };
  }

  async function extractWebArticleCard(extractedUrl, { senderNote = '', sharedBy = 'User', chatGroup = 'General' } = {}) {
    let htmlText = '';
    try {
      htmlText = await hybridHttpRequest({
        url: extractedUrl,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8'
        }
      });
    } catch (_) {
      htmlText = `<title>${extractedUrl}</title><p>${senderNote}</p>`;
    }

    const ogTitle = extractMetaTagContent(htmlText, 'og:title') || extractMetaTagContent(htmlText, 'twitter:title');
    const ogDesc = extractMetaTagContent(htmlText, 'og:description') || extractMetaTagContent(htmlText, 'description');

    // Quét thêm JSON-LD articleBody / description trước khi xóa thẻ <script>
    const jsonLdBodies = [];
    const jsonLdMatches = htmlText.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of jsonLdMatches) {
      try {
        const parsedLd = JSON.parse(m[1].trim());
        const items = Array.isArray(parsedLd) ? parsedLd : [parsedLd];
        for (const it of items) {
          if (it && typeof it.articleBody === 'string' && it.articleBody.trim().length > 60) {
            jsonLdBodies.push(it.articleBody.trim());
          } else if (it && typeof it.description === 'string' && it.description.trim().length > 60) {
            jsonLdBodies.push(it.description.trim());
          }
        }
      } catch (_) {}
    }

    const strippedHtml = htmlText
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

    const titleMatch = strippedHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawTitle = ogTitle || (titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : extractedUrl);

    const blockLines = [];
    const blockMatches = strippedHtml.matchAll(/<(h1|h2|h3|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi);
    for (const m of blockMatches) {
      const tag = m[1].toLowerCase();
      const text = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (!text || CONVERSATIONAL_NOISE_RE.test(text) || text.includes('{"props":')) continue;
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        if (text.length >= 6 && text.length <= 120) {
          blockLines.push(`## ${text}`);
        }
      } else if (text.length >= 45) {
        blockLines.push(text);
      }
    }

    if (blockLines.length === 0 && jsonLdBodies.length > 0) {
      blockLines.push(...jsonLdBodies.join('\n').split(/\r?\n/).filter(Boolean));
    }
    if (blockLines.length === 0 && ogDesc) {
      blockLines.push(ogDesc);
    }
    if (blockLines.length === 0 && senderNote) {
      blockLines.push(senderNote);
    }

    const fullArticleText = blockLines.join('\n');
    const parsed = parseStructuredArticleSections(fullArticleText, rawTitle);
    const pseudoSegments = parsed.allParas.slice(0, 40).map((p, i) => ({
      timestamp: `Đoạn ${i + 1}`,
      start_seconds: i,
      text: p
    }));

    const { topKeywords } = await computeTfIdfScoresAsync(pseudoSegments, rawTitle);
    const category = detectCategory(`${rawTitle} ${senderNote} ${fullArticleText.slice(0, 2500)}`, rawTitle, topKeywords);
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    let hostname = 'Web';
    try { hostname = new URL(extractedUrl).hostname.replace(/^www\./, ''); } catch (_) {}

    return {
      id: `web_${simpleHash(extractedUrl)}`,
      schema_version: CURRENT_SCHEMA_VERSION,
      resource_type: 'web_article',
      metadata: {
        url: extractedUrl,
        title: rawTitle,
        channel: hostname,
        duration: `${parsed.coreIdeas.length || 1} phần • ${pseudoSegments.length} đoạn nội dung`,
        publish_date: nowStr.slice(0, 10),
        extracted_at: nowStr
      },
      chat_context: {
        shared_by: sharedBy,
        chat_group: chatGroup,
        shared_at: nowStr,
        sender_note: senderNote || 'Lưu từ liên kết chia sẻ qua chat'
      },
      taxonomy: {
        category,
        tags: topKeywords.slice(0, 8),
        search_aliases: [removeVietnameseAccents(rawTitle), removeVietnameseAccents(category)]
      },
      summary: {
        one_liner: parsed.oneLiner || ogDesc || rawTitle,
        executive_summary: parsed.execSummary || ogDesc || rawTitle
      },
      wisdom_distillation: {
        core_ideas: parsed.coreIdeas.length ? parsed.coreIdeas : [{
          chapter: '1. Nội dung chính',
          timestamp: 'Phần 1',
          seconds: 0,
          content: ogDesc || senderNote || rawTitle
        }],
        key_insights: parsed.keyInsights,
        actionable_steps: parsed.actionableSteps,
        facts_and_metrics: [],
        mentioned_references: [{ name: rawTitle, url: extractedUrl, type: 'web_source' }]
      },
      timeline: { chapters: parsed.chapters, visual_slides: [] },
      transcript_corpus: pseudoSegments
    };
  }

  async function ingestAnyInput(rawInput, { senderNote = '', sharedBy = 'User', chatGroup = 'General' } = {}) {
    const cleaned = String(rawInput || '').trim();
    if (!cleaned) throw new Error('Nội dung đầu vào trống.');

    const urlMatch = cleaned.match(URL_REGEX);
    if (urlMatch) {
      const extractedUrl = urlMatch[1];
      const residualText = cleaned.replace(URL_REGEX, '').trim();
      const mergedNote = [senderNote, residualText].filter(Boolean).join(' - ');

      if (YOUTUBE_REGEX.test(extractedUrl)) {
        return await extractYouTubeIdeaCard(extractedUrl, {
          senderNote: mergedNote,
          sharedBy,
          chatGroup
        });
      }

      if (GITHUB_REGEX.test(extractedUrl)) {
        return await extractGitHubRepoCard(extractedUrl, {
          senderNote: mergedNote,
          sharedBy,
          chatGroup
        });
      }

      if (FACEBOOK_REGEX.test(extractedUrl)) {
        return await extractFacebookPostCard(extractedUrl, {
          senderNote: mergedNote,
          sharedBy,
          chatGroup
        });
      }

      return await extractWebArticleCard(extractedUrl, {
        senderNote: mergedNote,
        sharedBy,
        chatGroup
      });
    }

    // Trường hợp ghi chú văn bản / tin nhắn chat
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    const title = `[Ghi chú Chat] ${(lines[0] || 'Nội dung lưu trữ').slice(0, 80)}`;
    const pseudoSegments = lines.map((l, i) => ({
      timestamp: `Ý ${i + 1}`,
      start_seconds: i,
      text: l
    }));
    const { topKeywords } = await computeTfIdfScoresAsync(pseudoSegments, title);
    const category = detectCategory(`${cleaned} ${senderNote}`, title, topKeywords);
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

    return {
      id: `note_${simpleHash(cleaned)}`,
      schema_version: CURRENT_SCHEMA_VERSION,
      resource_type: 'chat_note',
      metadata: {
        url: 'chat://local-note',
        title,
        channel: `Chat (${chatGroup})`,
        duration: `${cleaned.split(/\s+/).length} từ`,
        publish_date: nowStr.slice(0, 10),
        extracted_at: nowStr
      },
      chat_context: {
        shared_by: sharedBy,
        chat_group: chatGroup,
        shared_at: nowStr,
        sender_note: senderNote || 'Ghi chú trực tiếp từ hội thoại'
      },
      taxonomy: {
        category,
        tags: topKeywords.slice(0, 8),
        search_aliases: [removeVietnameseAccents(cleaned.slice(0, 500))]
      },
      summary: {
        one_liner: senderNote || lines[0].slice(0, 200),
        executive_summary: lines.slice(0, 4).join(' ').slice(0, 600)
      },
      wisdom_distillation: {
        core_ideas: pseudoSegments.slice(0, 6).map((s, idx) => ({
          chapter: `Nội dung ${idx + 1}`,
          timestamp: s.timestamp,
          seconds: 0,
          content: s.text
        })),
        key_insights: [],
        actionable_steps: [],
        facts_and_metrics: [],
        mentioned_references: []
      },
      timeline: { chapters: [], visual_slides: [] },
      transcript_corpus: pseudoSegments
    };
  }

  /**
   * 6. CƠ CHẾ LƯU TRỮ BỀN VỮNG 3 LỚP + DỊCH SONG NGỮ TỰ ĐỘNG (VI DEFAULT / EN SWITCH)
   */
  const DB_NAME = 'ChatKnowledgeVaultDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'vault_items';

  function openIndexedDB() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB không khả dụng'));
        return;
      }
      const req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllItemsFromIDB() {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => {
          const ta = (a.metadata && a.metadata.extracted_at) || '';
          const tb = (b.metadata && b.metadata.extracted_at) || '';
          return tb.localeCompare(ta);
        });
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function putItemToIDB(record) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteItemFromIDB(id) {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function syncBackupToNativeStorage() {
    try {
      const allItems = await getAllItemsFromIDB();
      const backupPayload = JSON.stringify({
        schema_version: '3.0',
        exported_at: new Date().toISOString(),
        item_count: allItems.length,
        items: allItems
      });
      if (hasNativeBridge()) {
        await callNativeBridge('savePersistentBackup', { backupJson: backupPayload });
      }
    } catch (err) {
      console.warn('[ChatVaultEngine] Cảnh báo đồng bộ sao lưu:', err);
    }
  }

  async function translateTextViaGtx(text, targetLang = 'vi') {
    const cleaned = String(text || '').trim();
    if (!cleaned) return '';
    try {
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
                  encodeURIComponent(targetLang) + '&dt=t&q=' + encodeURIComponent(cleaned);
      const raw = await hybridHttpRequest({
        url,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' }
      });
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
        return parsed[0].map(part => (Array.isArray(part) && part[0]) ? part[0] : '').join('');
      }
    } catch (e) {
      console.warn('[ChatVaultEngine] Lỗi dịch tự động:', e);
    }
    return cleaned;
  }

  function isPrimarilyVietnamese(text) {
    const clean = String(text || '')
      .replace(/Ngôn ngữ:|Mục tiêu dự án:|Mô tả dự án:|Ngôn ngữ chính:|Chủ đề kỹ thuật:|Lệnh thực thi:|Kho mã nguồn & Tài liệu kỹ thuật|Tổng quan & Giới thiệu|Mục \d+|Phần \d+|Luận điểm \d+|Đoạn \d+|Ý \d+/gi, ' ')
      .trim();
    const words = clean.split(/\s+/).filter(w => w.length >= 2);
    if (!words.length) return false;
    let viCount = 0;
    for (const w of words) {
      if (VI_DIACRITIC_REGEX.test(w)) viCount++;
    }
    return (viCount / words.length) >= 0.16;
  }

  function isSnapshotVietnamese(snap) {
    if (!snap) return false;
    const firstIdea = ((snap.core_ideas || [])[0] || {}).content || '';
    const sample = `${snap.one_liner || ''} ${snap.executive_summary || ''} ${firstIdea}`;
    return isPrimarilyVietnamese(sample);
  }

  async function translateBatchViaGtx(items, targetLang = 'vi') {
    if (!items || !items.length) return [];
    const cleanedItems = items.map(rawItem => String(rawItem || '').replace(/\r?\n/g, ' ').trim().slice(0, 950));
    const joined = cleanedItems.join('\n[[888]]\n');
    if (joined.length <= 3800) {
      const translatedJoined = await translateTextViaGtx(joined, targetLang);
      const parts = translatedJoined.split(/\s*\[\[\s*888\s*\]\]\s*/);
      if (parts.length === cleanedItems.length) {
        return parts.map((p, idx) => p.trim() || cleanedItems[idx]);
      }
    }
    const out = [];
    for (const str of cleanedItems) {
      out.push(str ? await translateTextViaGtx(str, targetLang) : '');
    }
    return out;
  }

  function snapshotLangFields(record) {
    const meta = record.metadata || {};
    const summ = record.summary || {};
    const tl = record.timeline || {};
    const wis = record.wisdom_distillation || {};
    return {
      title: meta.title || '',
      one_liner: summ.one_liner || '',
      executive_summary: summ.executive_summary || '',
      chapters: (tl.chapters || []).map(c => ({ ...c })),
      core_ideas: (wis.core_ideas || []).map(c => ({ ...c })),
      key_insights: (wis.key_insights || []).map(c => ({ ...c })),
      actionable_steps: (wis.actionable_steps || []).map(c => ({ ...c }))
    };
  }

  function applyLangSnapshotToRecord(record, snap) {
    if (!snap) return record;
    const cloned = JSON.parse(JSON.stringify(record));
    cloned.metadata = cloned.metadata || {};
    cloned.summary = cloned.summary || {};
    cloned.timeline = cloned.timeline || {};
    cloned.wisdom_distillation = cloned.wisdom_distillation || {};
    if (snap.title) cloned.metadata.title = snap.title;
    if (snap.one_liner) cloned.summary.one_liner = snap.one_liner;
    if (snap.executive_summary) cloned.summary.executive_summary = snap.executive_summary;
    if (Array.isArray(snap.chapters)) cloned.timeline.chapters = snap.chapters;
    if (Array.isArray(snap.core_ideas)) cloned.wisdom_distillation.core_ideas = snap.core_ideas;
    if (Array.isArray(snap.key_insights)) cloned.wisdom_distillation.key_insights = snap.key_insights;
    if (Array.isArray(snap.actionable_steps)) cloned.wisdom_distillation.actionable_steps = snap.actionable_steps;
    return cloned;
  }

  async function translateSnapshot(snap, targetLang) {
    const chTitles = (snap.chapters || []).map(c => c.title || '');
    const ciChapters = (snap.core_ideas || []).map(c => c.chapter || '');
    const ciContents = (snap.core_ideas || []).map(c => c.content || '');
    const kiContents = (snap.key_insights || []).map(c => c.content || '');
    const asContents = (snap.actionable_steps || []).map(c => c.content || '');

    const headerBatch = await translateBatchViaGtx([
      snap.title || '',
      snap.one_liner || '',
      snap.executive_summary || ''
    ], targetLang);

    const trChTitles = chTitles.length ? await translateBatchViaGtx(chTitles, targetLang) : [];
    const trCiChapters = ciChapters.length ? await translateBatchViaGtx(ciChapters, targetLang) : [];
    const trCiContents = ciContents.length ? await translateBatchViaGtx(ciContents, targetLang) : [];
    const trKiContents = kiContents.length ? await translateBatchViaGtx(kiContents, targetLang) : [];
    const trAsContents = asContents.length ? await translateBatchViaGtx(asContents, targetLang) : [];

    return {
      title: headerBatch[0] || snap.title,
      one_liner: headerBatch[1] || snap.one_liner,
      executive_summary: headerBatch[2] || snap.executive_summary,
      chapters: (snap.chapters || []).map((c, i) => ({ ...c, title: trChTitles[i] || c.title })),
      core_ideas: (snap.core_ideas || []).map((c, i) => ({
        ...c,
        chapter: trCiChapters[i] || c.chapter,
        content: trCiContents[i] || c.content
      })),
      key_insights: (snap.key_insights || []).map((c, i) => ({ ...c, content: trKiContents[i] || c.content })),
      actionable_steps: (snap.actionable_steps || []).map((c, i) => ({ ...c, content: trAsContents[i] || c.content }))
    };
  }

  async function ensureRecordBilingual(record) {
    if (!record) return record;
    record.schema_version = CURRENT_SCHEMA_VERSION;
    if (record.taxonomy && (!record.taxonomy.category || record.taxonomy.category === 'Công nghệ, Lập trình & AI' || record.taxonomy.category === 'Tri thức Tổng hợp')) {
      const m = record.metadata || {};
      const s = record.summary || {};
      const t = record.taxonomy || {};
      record.taxonomy.category = detectCategory(`${m.title || ''} ${s.one_liner || ''} ${s.executive_summary || ''} ${(t.tags || []).join(' ')}`, m.title || '', t.tags || []);
    }

    if (global.__CHAT_VAULT_INITIAL_SEED && Array.isArray(global.__CHAT_VAULT_INITIAL_SEED)) {
      const matchedSeed = global.__CHAT_VAULT_INITIAL_SEED.find(
        s => s.id === record.id ||
             (s.metadata && record.metadata && s.metadata.url && record.metadata.url &&
              s.metadata.url.toLowerCase() === record.metadata.url.toLowerCase())
      );
      if (matchedSeed && matchedSeed.i18n && matchedSeed.i18n.vi && matchedSeed.i18n.en) {
        Object.assign(record, JSON.parse(JSON.stringify(matchedSeed)));
        const updated = applyLangSnapshotToRecord(record, matchedSeed.i18n.vi);
        Object.assign(record, updated);
        return record;
      }
    }

    if (record.i18n && record.i18n.vi && record.i18n.en) {
      if (isSnapshotVietnamese(record.i18n.vi)) {
        const updated = applyLangSnapshotToRecord(record, record.i18n.vi);
        Object.assign(record, updated);
        return record;
      }
      // Bản ghi trước đó bị lưu nhầm nội dung tiếng Anh vào i18n.vi -> dịch lại từ i18n.en sang Tiếng Việt
      const cleanEnSnap = JSON.parse(JSON.stringify(record.i18n.en));
      cleanEnSnap.one_liner = String(cleanEnSnap.one_liner || '').replace(/\(Ngôn ngữ:/gi, '(Language:');
      cleanEnSnap.executive_summary = String(cleanEnSnap.executive_summary || '').replace(/^Mục tiêu dự án:/i, 'Project overview:');
      const fixedViSnap = await translateSnapshot(cleanEnSnap, 'vi');
      record.i18n = { vi: fixedViSnap, en: cleanEnSnap };
      const updated = applyLangSnapshotToRecord(record, fixedViSnap);
      Object.assign(record, updated);
      return record;
    }

    const origSnap = snapshotLangFields(record);
    origSnap.one_liner = String(origSnap.one_liner || '').replace(/\(Ngôn ngữ:/gi, '(Language:');
    origSnap.executive_summary = String(origSnap.executive_summary || '').replace(/^Mục tiêu dự án:/i, 'Project overview:');
    const isAlreadyVi = isSnapshotVietnamese(origSnap);

    if (isAlreadyVi) {
      const enSnap = await translateSnapshot(origSnap, 'en');
      record.i18n = { vi: origSnap, en: enSnap };
    } else {
      const viSnap = await translateSnapshot(origSnap, 'vi');
      record.i18n = { vi: viSnap, en: origSnap };
      const updated = applyLangSnapshotToRecord(record, viSnap);
      Object.assign(record, updated);
    }
    return record;
  }

  function getLocalizedRecord(record, lang = 'vi') {
    if (!record) return record;
    const targetLang = (lang === 'en') ? 'en' : 'vi';
    if (record.i18n && record.i18n[targetLang]) {
      return applyLangSnapshotToRecord(record, record.i18n[targetLang]);
    }
    return record;
  }

  function isEmptyOrIncompleteWebRecord(item) {
    if (!item || !item.metadata || !item.metadata.url || !String(item.metadata.url).startsWith('http')) return false;
    const wis = item.wisdom_distillation || {};
    const ideas = wis.core_ideas || [];
    const dur = String((item.metadata && item.metadata.duration) || '');
    if (ideas.length === 0 || dur.startsWith('0 đoạn')) return true;
    if (FACEBOOK_REGEX.test(item.metadata.url) && ideas.length <= 1 && String(item.metadata.title || '').length < 25) return true;
    return false;
  }

  function isLegacyOrCorruptedRecord(item) {
    if (!item) return true;
    const rawStr = JSON.stringify(item.summary || {}) + JSON.stringify(item.wisdom_distillation || {});
    if (rawStr.includes('\\u003c') || rawStr.includes('Sign in Appearance settings') || rawStr.includes('{"props":')) {
      return true;
    }
    return false;
  }

  async function upgradeExistingItemsToCoherentV3(items) {
    let changed = false;
    for (const item of items) {
      // Tự động khôi phục các bản ghi Facebook / Web trước đó bị rỗng ("0 đoạn nội dung")
      if (isEmptyOrIncompleteWebRecord(item)) {
        try {
          const fresh = await ingestAnyInput(item.metadata.url, {
            senderNote: (item.chat_context && item.chat_context.sender_note) || '',
            sharedBy: (item.chat_context && item.chat_context.shared_by) || 'User',
            chatGroup: (item.chat_context && item.chat_context.chat_group) || 'Zalo / R&D'
          });
          if (fresh && fresh.wisdom_distillation && (fresh.wisdom_distillation.core_ideas || []).length > 0) {
            fresh.id = item.id;
            await ensureRecordBilingual(fresh);
            await putItemToIDB(fresh);
            changed = true;
            continue;
          }
        } catch (e) {
          console.warn('[ChatVaultEngine] Lỗi tự động bóc tách lại bản ghi rỗng:', item.id, e);
        }
      }
      // Tự động phát hiện và dịch sang Tiếng Việt các bản ghi trước đó bị lưu nhầm bằng tiếng Anh trong i18n.vi
      if (!item.i18n || !item.i18n.vi || !isSnapshotVietnamese(item.i18n.vi)) {
        try {
          await ensureRecordBilingual(item);
          await putItemToIDB(item);
          changed = true;
        } catch (e) {
          console.warn('[ChatVaultEngine] Lỗi tự động dịch lại bản ghi:', item.id, e);
        }
      }
      if (item.schema_version !== CURRENT_SCHEMA_VERSION) {
        item.schema_version = CURRENT_SCHEMA_VERSION;
        if (item.taxonomy && (!item.taxonomy.category || item.taxonomy.category === 'Công nghệ, Lập trình & AI' || item.taxonomy.category === 'Tri thức Tổng hợp')) {
          const m = item.metadata || {};
          const s = item.summary || {};
          const t = item.taxonomy || {};
          item.taxonomy.category = detectCategory(`${m.title || ''} ${s.one_liner || ''} ${s.executive_summary || ''} ${(t.tags || []).join(' ')}`, m.title || '', t.tags || []);
        }
        await putItemToIDB(item);
        changed = true;
      }

      if (isLegacyOrCorruptedRecord(item)) {
        // Kiểm tra trong bộ Seed chuẩn v3 trước
        const matchedSeed = (global.__CHAT_VAULT_INITIAL_SEED || []).find(
          s => s.id === item.id ||
               (s.metadata && item.metadata && s.metadata.url && item.metadata.url &&
                s.metadata.url.toLowerCase() === item.metadata.url.toLowerCase())
        );
        if (matchedSeed) {
          const oldId = item.id;
          if (oldId !== matchedSeed.id) {
            await deleteItemFromIDB(oldId);
          }
          const seedCopy = JSON.parse(JSON.stringify(matchedSeed));
          seedCopy.schema_version = CURRENT_SCHEMA_VERSION;
          await putItemToIDB(seedCopy);
          changed = true;
          continue;
        }
      }
    }

    // Đảm bảo 3 bản ghi mẫu chuẩn v3 luôn có mặt nếu kho mới chỉ có 2 bản ghi mặc định
    if (global.__CHAT_VAULT_INITIAL_SEED && Array.isArray(global.__CHAT_VAULT_INITIAL_SEED)) {
      const currentAfter = await getAllItemsFromIDB();
      const existingIds = new Set(currentAfter.map(x => x.id));
      for (const seedItem of global.__CHAT_VAULT_INITIAL_SEED) {
        if (!existingIds.has(seedItem.id)) {
          const seedCopy = JSON.parse(JSON.stringify(seedItem));
          seedCopy.schema_version = CURRENT_SCHEMA_VERSION;
          await putItemToIDB(seedCopy);
          changed = true;
        }
      }
    }

    if (changed) {
      await syncBackupToNativeStorage();
    }
    return await getAllItemsFromIDB();
  }

  async function autoRestoreIfEmpty() {
    const currentItems = await getAllItemsFromIDB();
    if (currentItems.length > 0) {
      return await upgradeExistingItemsToCoherentV3(currentItems);
    }

    if (hasNativeBridge()) {
      try {
        const rawBackup = await callNativeBridge('loadPersistentBackup');
        if (rawBackup) {
          const parsed = typeof rawBackup === 'string' ? JSON.parse(rawBackup) : rawBackup;
          const items = parsed.items || [];
          for (const item of items) {
            await putItemToIDB(item);
          }
          if (items.length > 0) {
            return await upgradeExistingItemsToCoherentV3(await getAllItemsFromIDB());
          }
        }
      } catch (e) {
        console.warn('[ChatVaultEngine] Không tìm thấy bản sao lưu Native:', e);
      }
    }

    if (global.__CHAT_VAULT_INITIAL_SEED && Array.isArray(global.__CHAT_VAULT_INITIAL_SEED)) {
      try {
        for (const item of global.__CHAT_VAULT_INITIAL_SEED) {
          await putItemToIDB(JSON.parse(JSON.stringify(item)));
        }
        global.localStorage.setItem('CHAT_VAULT_INITIAL_SEEDED', '3');
        await syncBackupToNativeStorage();
        return await getAllItemsFromIDB();
      } catch (_) {}
    }

    return [];
  }

  /**
   * 7. ĐỘNG CƠ TÌM KIẾM TOÀN VĂN (BM25 + KHỬ DẤU TIẾNG VIỆT + ĐỊNH VỊ MỐC THỜI GIAN)
   */
  async function searchVault({ query = '', resourceType = '', category = '' } = {}) {
    const allItems = await getAllItemsFromIDB();
    const q = String(query || '').trim();
    const qLower = q.toLowerCase();
    const qNorm = removeVietnameseAccents(q);

    const results = [];
    for (const item of allItems) {
      if (resourceType && item.resource_type !== resourceType) continue;
      if (category && (item.taxonomy || {}).category !== category) continue;

      if (!q) {
        results.push({ ...item, matched_transcript_segments: [], _score: 1 });
        continue;
      }

      const meta = item.metadata || {};
      const tax = item.taxonomy || {};
      const ctx = item.chat_context || {};
      const summ = item.summary || {};
      const wis = item.wisdom_distillation || {};
      const corpus = item.transcript_corpus || [];

      const i18nBlob = item.i18n ? JSON.stringify(item.i18n) : '';
      const headerBlob = `${meta.title || ''} ${meta.channel || ''} ${(tax.tags || []).join(' ')} ${ctx.sender_note || ''} ${summ.one_liner || ''} ${summ.executive_summary || ''} ${i18nBlob}`;
      const wisdomBlob = (wis.core_ideas || []).map(x => x.content).join(' ');
      const transcriptBlob = corpus.map(s => s.text).join(' ');

      const fullRaw = `${headerBlob} ${wisdomBlob} ${transcriptBlob}`.toLowerCase();
      const fullNorm = removeVietnameseAccents(fullRaw);

      let score = 0;
      if (headerBlob.toLowerCase().includes(qLower) || removeVietnameseAccents(headerBlob).includes(qNorm)) {
        score += 10;
      }
      if (wisdomBlob.toLowerCase().includes(qLower) || removeVietnameseAccents(wisdomBlob).includes(qNorm)) {
        score += 5;
      }

      const matchedSegs = [];
      for (const seg of corpus) {
        const sTxt = String(seg.text || '');
        if (sTxt.toLowerCase().includes(qLower) || (qNorm && removeVietnameseAccents(sTxt).includes(qNorm))) {
          score += 2;
          if (matchedSegs.length < 5) {
            matchedSegs.push({
              timestamp: seg.timestamp,
              start_seconds: seg.start_seconds || 0,
              text: sTxt
            });
          }
        }
      }

      if (score > 0 && fullNorm.length > 0) {
        results.push({
          ...item,
          matched_transcript_segments: matchedSegs,
          _score: score
        });
      }
    }

    results.sort((a, b) => b._score - a._score);
    return results;
  }

  async function exportFullBackupJson() {
    const allItems = await getAllItemsFromIDB();
    return JSON.stringify({
      schema_version: '3.0',
      exported_at: new Date().toISOString(),
      item_count: allItems.length,
      items: allItems
    }, null, 2);
  }

  async function importFullBackupJson(jsonString) {
    const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
    const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
    let importedCount = 0;
    for (const item of items) {
      if (item && item.id && item.metadata) {
        await ensureRecordBilingual(item);
        await putItemToIDB(item);
        importedCount++;
      }
    }
    await syncBackupToNativeStorage();
    return importedCount;
  }

  function exportIdeaCardMarkdown(record) {
    const meta = record.metadata || {};
    const ctx = record.chat_context || {};
    const tax = record.taxonomy || {};
    const summ = record.summary || {};
    const wis = record.wisdom_distillation || {};
    const tl = record.timeline || {};
    const baseUrl = meta.url || '';

    const lines = [
      `# [Idea Card] ${meta.title || ''}`,
      '',
      '## 1. Định danh & Ngữ cảnh Chia sẻ',
      `- **Đường dẫn gốc**: ${baseUrl}`,
      `- **Nguồn / Kênh**: ${meta.channel || ''} | **Thời lượng / Quy mô**: \`${meta.duration || ''}\``,
      `- **Người chia sẻ**: ${ctx.shared_by || 'User'} (${ctx.chat_group || 'General'}) — *"${ctx.sender_note || ''}"*`,
      `- **Danh mục**: \`${tax.category || ''}\``,
      `- **Thẻ tra cứu**: ${(tax.tags || []).map(t => `\`#${t}\``).join(', ')}`,
      '',
      '## 2. Bức tranh Tổng thể & Ý nghĩa Cốt lõi (Executive Overview)',
      `- **Thông điệp trọng tâm (1 dòng)**: **${summ.one_liner || ''}**`,
      `- **Tổng hợp nội dung chính**: ${summ.executive_summary || ''}`,
      '',
      '## 3. Phân tích Mạch Nội dung Chính theo Phần / Chương mục'
    ];

    for (const c of (wis.core_ideas || [])) {
      const link = record.resource_type === 'youtube_video' ? `${baseUrl}&t=${c.seconds || 0}s` : baseUrl;
      lines.push(`- **[${c.timestamp}](${link})** ${c.chapter ? `**${c.chapter}**` : ''}: ${c.content}`);
    }

    if ((wis.key_insights || []).length) {
      lines.push('', '## 4. Nguyên lý & Đúc kết Sâu (Key Insights)');
      for (const ki of wis.key_insights) {
        lines.push(`- **[${ki.timestamp}]**: ${ki.content}`);
      }
    }

    if ((wis.actionable_steps || []).length) {
      lines.push('', '## 5. Khuyến nghị Hành động & Ứng dụng Thực tiễn (Actionable Steps)');
      for (const st of wis.actionable_steps) {
        lines.push(`- **[${st.timestamp}]**: ${st.content}`);
      }
    }

    if ((tl.chapters || []).length) {
      lines.push('', '## 6. Mục lục Chương mục (Timeline / Sections)');
      for (const ch of tl.chapters) {
        const link = record.resource_type === 'youtube_video' ? `${baseUrl}&t=${ch.seconds || 0}s` : baseUrl;
        lines.push(`- **[${ch.timestamp}](${link})**: ${ch.title}`);
      }
    }

    return lines.join('\n');
  }

  function exportTopicGroupMarkdown(topicName, items) {
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const lines = [
      `# 🗂️ BÁO CÁO TỔNG HỢP TRI THỨC THEO CHỦ ĐỀ: ${topicName}`,
      `- **Thời gian trích xuất**: ${nowStr}`,
      `- **Số lượng tài liệu / bản ghi trong chủ đề**: **${(items || []).length}**`,
      '',
      '---',
      ''
    ];
    (items || []).forEach((rec, idx) => {
      const meta = rec.metadata || {};
      const summ = rec.summary || {};
      const wis = rec.wisdom_distillation || {};
      lines.push(`## ${idx + 1}. ${meta.title || ''}`);
      lines.push(`- **Nguồn**: ${meta.url || ''} (${meta.channel || ''} • ${meta.duration || ''})`);
      lines.push(`- **Thông điệp trọng tâm**: **${summ.one_liner || ''}**`);
      lines.push(`- **Tổng quan nội dung**: ${summ.executive_summary || ''}`);
      if ((wis.core_ideas || []).length) {
        lines.push(`- **Các luận điểm chính**:`);
        for (const c of wis.core_ideas) {
          lines.push(`  + **[${c.timestamp}]** ${c.chapter ? `**${c.chapter}**: ` : ''}${c.content}`);
        }
      }
      lines.push('', '---', '');
    });
    return lines.join('\n');
  }

  global.__CHAT_VAULT_INITIAL_SEED = [{"id": "yt_0phAfVzaAw4", "resource_type": "youtube_video", "metadata": {"video_id": "0phAfVzaAw4", "url": "https://www.youtube.com/watch?v=0phAfVzaAw4", "title": "Chiến lược RevOps trong kỷ nguyên AI: Nên tự xây dựng (Build) hay mua ngoài (Buy) Bộ não Doanh nghiệp (Cựu CPO HubSpot Christopher O'Donnell)", "channel": "Day AI", "duration": "32:34", "duration_seconds": 1954, "publish_date": "2026-10-13T11:06:47-07:00", "extracted_at": "2026-10-25 18:05:17"}, "chat_context": {"shared_by": "User", "chat_group": "General", "shared_at": "2026-10-25 18:05:17", "sender_note": "Thử nghiệm trích xuất ý tưởng từ link YouTube"}, "taxonomy": {"category": "📈 Chiến lược RevOps, Kinh doanh & Quản trị", "tags": ["company", "engineering", "team", "product", "sales", "could", "whatever", "claude", "revops", "teams"], "search_aliases": ["what revops should build vs. buy for the company brain (ex-hubspot cpo at vector)", "cong nghe, lap trinh & ai", "company", "engineering", "team", "product", "sales", "could", "whatever", "claude"], "sub_topic": "Vận hành Doanh thu (RevOps) & Bộ não Doanh nghiệp"}, "summary": {"one_liner": "Khung tư duy chiến lược giúp đội ngũ Vận hành Doanh thu (RevOps) thiết kế 'Bộ não Doanh nghiệp' (Company Brain): dùng Claude Code để tự xây dựng các luồng ngữ cảnh đặc thù và chỉ mua ngoài hạ tầng dữ liệu nền tảng.", "executive_summary": "Bài diễn thuyết của Christopher O'Donnell (Cựu Giám đốc Sản phẩm HubSpot, hiện tại ở Vector) phân tích sự chuyển dịch căn bản của bộ phận Vận hành Doanh thu (RevOps) trong kỷ nguyên AI Agent. Trước đây, các yêu cầu công cụ nội bộ của RevOps luôn bị xếp sau ưu tiên phát triển sản phẩm chính; nhưng hiện nay, một nhân sự RevOps sử dụng công cụ lập trình AI (như Claude Code) có năng suất tương đương một nhóm 6 kỹ sư phần mềm năm 2017. Trọng tâm cốt lõi là xây dựng 'Bộ não Doanh nghiệp' (Company Brain) — thực chất là một kho lưu trữ ngữ cảnh có cấu trúc (thư mục Markdown/GitHub Repo kết hợp bản ghi cuộc họp, dữ liệu CRM và quy trình nội bộ) để các AI Agent chủ động phân tích giao dịch và tự cải tiến vòng lặp bán hàng. Để thành công, lãnh đạo RevOps phải: (1) Gắn chiến lược AI với một chỉ số tài chính cụ thể trên báo cáo P&L (như rút ngắn thời gian đào tạo nhân sự sale từ 7 tháng xuống 4 tháng); (2) Giữ con người ở vai trò tạo dựng niềm tin và cam kết với khách hàng, giao toàn bộ việc nghiên cứu, ghi chép và tổng hợp dữ liệu cho AI; và (3) Mua ngoài (Buy) các nền tảng thu thập dữ liệu thô, nhưng bắt buộc tự xây dựng (Build) lớp điều phối quy trình và trí tuệ đặc thù của doanh nghiệp."}, "wisdom_distillation": {"core_ideas": [{"chapter": "1. Bài học từ HubSpot & Nút thắt công cụ nội bộ", "timestamp": "00:00", "seconds": 0, "content": "Trong 10 năm tại HubSpot, việc đưa dữ liệu hành vi sử dụng sản phẩm vào quy trình bán hàng đã giúp đội sản phẩm đóng góp hơn 60% đầu vào doanh thu. Tuy nhiên, nghịch lý lớn nhất của các công ty phần mềm là những hệ thống phục vụ vận hành doanh thu nội bộ (RevOps) không bao giờ nằm trong Top 5 ưu tiên của đội ngũ kỹ sư, khiến bộ phận kinh doanh luôn thiếu công cụ tự động hóa phù hợp."}, {"chapter": "2. Đội ngũ RevOps trở thành Kỹ sư Sản phẩm", "timestamp": "03:15", "seconds": 195, "content": "Chiến lược AI tại bộ phận RevOps hiện mang lại hệ số nhân hiệu quả lớn hơn bất kỳ phòng ban nào khác. Thay vì chờ đợi bộ phận IT, nhân sự RevOps ngày nay phải áp dụng tư duy của Giám đốc Sản phẩm (Product Leader): biết đặt đúng câu hỏi nghiệp vụ, định hình luồng dữ liệu và trực tiếp sử dụng AI tạo mã để giải quyết bài toán vận hành."}, {"chapter": "3. Bản chất của 'Bộ não Doanh nghiệp' & Quy trình khởi tạo từ 1 Thư mục", "timestamp": "04:49", "seconds": 289, "content": "'Bộ não Doanh nghiệp' (Company Brain) và 'Harness' không phải là khái niệm trừu tượng mà bắt đầu từ một thư mục dữ liệu cấu trúc (Markdown) trên máy tính hoặc GitHub Repo, nơi tập hợp toàn bộ tài liệu, lịch sử giao dịch, bản ghi cuộc họp và quy tắc nghiệp vụ để công cụ như Claude Code hoặc Codex đọc hiểu ngữ cảnh toàn diện trước khi thực thi."}, {"chapter": "4. Liên thông tri thức & Gắn kết với Chỉ số Tài chính (P&L)", "timestamp": "11:42", "seconds": 702, "content": "Khi mỗi cá nhân và phòng ban tự tạo các kho ngữ cảnh riêng lẻ, doanh nghiệp cần chuẩn hóa và hợp nhất chúng qua hệ thống quản lý phiên bản (GitHub). Đặc biệt, mọi dự án AI trong RevOps bắt buộc phải gắn với một chỉ số đo lường cụ thể trên bảng kế hoạch tài chính (FP&A/P&L) — ví dụ rút ngắn thời gian hội nhập của nhân viên bán hàng mới từ 7 tháng xuống 4 tháng."}, {"chapter": "5. Phân công lao động Con người vs. AI & Chuyển sang Tác nhân Chủ động", "timestamp": "15:31", "seconds": 931, "content": "Khách hàng không muốn mua hàng từ máy móc; vì vậy con người phải giữ vai trò đại diện uy tín, lắng nghe, thuyết phục và đưa ra cam kết. Ngược lại, toàn bộ khâu nghiên cứu khách hàng, ghi nhớ hồ sơ và cập nhật CRM phải chuyển giao cho AI chạy ngầm tự động (Proactive Agents) — tuyệt đối tránh sai lầm biến nhân viên thành 'bảo mẫu' phải gõ lệnh thủ công cho từng chatbot rời rạc."}, {"chapter": "6. Nguyên tắc Tự xây (Build) vs. Mua ngoài (Buy) & 3 Câu hỏi Hành động", "timestamp": "25:31", "seconds": 1531, "content": "Với năng suất 1 người dùng Claude Code bằng 6 kỹ sư truyền thống, doanh nghiệp nên MUA NGOÀI (Buy) các nền tảng hạ tầng thu thập dữ liệu chuẩn hóa (như công cụ ghi âm, bóc tách bản ghi cuộc họp, cơ sở dữ liệu khách hàng) và TỰ XÂY DỰNG (Build) lớp quy trình nghiệp vụ, sổ cái tri thức và các tác nhân phân tích đặc thù tạo nên lợi thế cạnh tranh riêng của công ty."}], "key_insights": [{"timestamp": "02:32", "seconds": 152, "content": "Quy luật ưu tiên nguồn lực: Trong các công ty công nghệ, công cụ nội bộ cho đội ngũ Go-To-Market (Bán hàng & Marketing) hiếm khi được đội kỹ thuật ưu tiên; sự xuất hiện của Coding Agent giúp RevOps tự giải phóng khỏi điểm nghẽn này."}, {"timestamp": "11:42", "seconds": 702, "content": "Nguyên lý quản trị Peter Drucker trong kỷ nguyên AI: Không thể cải thiện thứ không đo lường được — triển khai AI trong RevOps mà không chỉ rõ sự thay đổi trên chỉ số doanh thu, hạn ngạch (Quota) hay thời gian đào tạo (Ramp time) thì chỉ là phong trào thử nghiệm."}, {"timestamp": "19:12", "seconds": 1152, "content": "Hội chứng mệt mỏi vì AI (AI Burnout): Việc bắt nhân viên nhập liệu qua lại giữa hàng chục cửa sổ chat ad-hoc còn chậm hơn thao tác trực tiếp trên CRM; hệ thống AI hiệu quả phải tự động chạy ngầm dựa trên sự kiện (Event-driven) và gửi báo cáo tổng hợp mỗi sáng."}, {"timestamp": "25:31", "seconds": 1531, "content": "Bản ghi âm cuộc họp (Meeting Transcripts) là 'mỏ vàng' dữ liệu quan trọng nhất của Bộ não Doanh nghiệp vì chứa đựng nguyên văn nhu cầu khách hàng, thông tin đối thủ và diễn biến thực tế của từng thương vụ."}], "actionable_steps": [{"timestamp": "05:53", "seconds": 353, "content": "Bước 1 — Khởi tạo Kho ngữ cảnh (Harness): Tạo một thư mục cấu trúc chuẩn (hoặc GitHub Repository), chuyển đổi toàn bộ tài liệu quy trình, hồ sơ sản phẩm và bản ghi cuộc họp sang định dạng Markdown để làm nền tảng cho Claude Code."}, {"timestamp": "25:31", "seconds": 1531, "content": "Bước 2 — Phân tách danh mục Build vs. Buy: Mua các công cụ thu thập dữ liệu đầu vào (ghi âm cuộc họp, làm giàu dữ liệu khách hàng), đồng thời tự lập trình các Agent nội bộ để tự động hóa luồng đánh giá giao dịch, dự báo doanh số và huấn luyện sale."}, {"timestamp": "29:52", "seconds": 1792, "content": "Bước 3 — Áp dụng 3 câu hỏi kiểm chứng cho đội ngũ: (1) Chỉ số tài chính (P&L) cụ thể nào sẽ thay đổi sau 6 tháng áp dụng AI? (2) Dữ liệu cuộc họp và quyết định nội bộ đang được lưu trữ ở đâu? (3) Quy trình nào đang bắt con người phục vụ bot cần được chuyển thành vòng lặp tự động?"}], "facts_and_metrics": [{"timestamp": "00:00", "seconds": 0, "content": "Thank you so much for sharing your time and your efforts. He's with us. We can't wait to hear what you have to say. Listen, the 10 years spent at HubSpot building the thing, that's been talked about a bunch, and also the whole idea of taking the product usage and rotating that into sales, which kind of occurred to us at the same time as a number of companies like, \"Whoa, here's an idea. We could have product actually get involved.\" And that led to us owning a number. By the time I left in 2021, my team was responsible for over sixty percent of the demand SLA into sales, which was a really cool transition."}, {"timestamp": "05:24", "seconds": 324, "content": "The way that we solve hard problems in 2026 is very different from how we solved these problems before now. That's the hard part. The easier part is once you learn this pattern, you can use it for any hard problem that you have. We have a... I think our most recent marketing campaign that we did was how to solve CRM by solving everything because this is pattern-based thinking and, you know, what to... what your starting point is, and then, you know, you'll kind of find your way like water. You'll find a way to the solution,"}, {"timestamp": "12:26", "seconds": 746, "content": "I have not yet met them, and I talk to RevOps folks all day, every day. You cannot improve what you can't measure. This is like classic Peter Drucker management advice. If you look at engineering, what's different in 2026 from 2023? '23, '24, the beginning of '25, you all saw the news stories. You know, engineering teams are seeing 15% product- productivity improvements, and then a couple of weeks later, engineering teams are 15% less productive because of AI. And it was all this, all these little puts and takes, right?"}, {"timestamp": "13:02", "seconds": 782, "content": "You remember all those articles? You don't see those articles anymore. Those articles would be ridiculous in 2026. A support rep on my team ships twice as much code to production in our core app as the average engineer at a public SaaS company. Two and a half pull requests a week used to get you promoted, you'd be able to afford the fancy fixed-speed bicycle, so you could come into the office at 11:00 AM and complain about the cold brew. Today, two and a half pull requests a week is"}, {"timestamp": "25:13", "seconds": 1513, "content": "six engineers worth of bandwidth from 2017. I assure you of this. You are better with Claude Code than, you know, we used to have these pods with a tech lead and a designer and two or three software engineers, and then we'd hire the Northeastern co-ops and train them up and all the rest of it, two and a half pull requests a week, all the rest of it. Every single one of you, week one on Claude Code is as powerful as, like, a whole product group from a traditional SaaS company. Build or buy? Understanding the components"}, {"timestamp": "27:01", "seconds": 1621, "content": "and put it into one place? I whiteboard with RevOps practitioners, the folks that many of you are managing, and I whiteboard out the company brain stuff that they have. Very interestingly, traditional CRM is never in the top five most useful, valuable data sources. It is just low resolution. It's not the number one priority. Meeting recordings, granola, customer Slack, you know, down the list, email. You know, let's get the Gmail in there."}], "mentioned_references": [{"name": "Get agents that know your customers better than you do", "url": "https://day.ai/", "type": "external_link"}]}, "timeline": {"chapters": [{"timestamp": "00:00", "seconds": 0, "title": "Bài học 10 năm tại HubSpot: Từ dữ liệu sản phẩm đến bài toán thiếu hụt công cụ RevOps"}, {"timestamp": "03:15", "seconds": 195, "title": "Sự chuyển dịch vai trò: Đội ngũ RevOps chính là bộ phận kỹ thuật sản phẩm mới"}, {"timestamp": "04:49", "seconds": 289, "title": "Giải mã khái niệm 'Bộ não Doanh nghiệp' (Company Brain), Harness và AI Agent"}, {"timestamp": "05:53", "seconds": 353, "title": "Phương pháp khởi tạo thực chiến: Bắt đầu mọi bài toán phức tạp từ một thư mục Markdown"}, {"timestamp": "08:02", "seconds": 482, "title": "Hợp nhất các kho tri thức phân tán giữa cá nhân, phòng ban và toàn công ty qua GitHub"}, {"timestamp": "11:42", "seconds": 702, "title": "Nguyên tắc đo lường hiệu quả: Chiến lược AI của bạn đang dịch chuyển chỉ số tài chính nào?"}, {"timestamp": "15:31", "seconds": 931, "title": "Phân định ranh giới: Phần việc giữ lại cho Con người và phần việc chuyển giao cho AI"}, {"timestamp": "19:12", "seconds": 1152, "title": "Sai lầm phổ biến: Bắt con người làm 'bảo mẫu' nhập liệu thủ công cho các chatbot rời rạc"}, {"timestamp": "21:18", "seconds": 1278, "title": "Mô hình chuẩn: Hệ thống tác nhân chủ động (Proactive Agents) và vòng lặp tự cải tiến"}, {"timestamp": "24:59", "seconds": 1499, "title": "Đòn bẩy năng suất: 1 nhân sự RevOps + Claude Code = Băng thông của 6 kỹ sư phần mềm"}, {"timestamp": "25:31", "seconds": 1531, "title": "Khung quyết định Tự xây dựng (Build) hay Mua ngoài (Buy) các cấu phần Bộ não Doanh nghiệp"}, {"timestamp": "29:52", "seconds": 1792, "title": "Tổng kết: 3 câu hỏi chiến lược cần đặt ra ngay cho đội ngũ lãnh đạo và RevOps"}], "visual_slides": []}, "transcript_corpus": [{"timestamp": "00:00", "start_seconds": 0, "text": "Thank you so much for sharing your time and your efforts. He's with us. We can't wait to hear what you have to say. Listen, the 10 years spent at HubSpot building the thing, that's been talked about a bunch, and also the whole idea of taking the product usage and rotating that into sales, which kind of occurred to us at the same time as a number of companies like, \"Whoa, here's an idea. We could have product actually get involved.\" And that led to us owning a number. By the time I left in 2021, my team was responsible for over sixty percent of the demand SLA into sales, which was a really cool transition."}, {"timestamp": "00:40", "start_seconds": 40, "text": "But there's another story. That's not the whole thing. There's a story that we've never talked about, and, the origin story of my real relationship with RevOps. So I had been part of the ELT, we called it Helm, for several years, and I kind of took one for the team and was the unified senator representing, engineering, product, and design for years. And I kinda had my fill of that, and I said, \"You know, I need to bring a buddy. Somebody else has to kind of do this work with me.\" So I convinced one of my closest friends,"}, {"timestamp": "01:13", "start_seconds": 73, "text": "who was head of engineering at the time, now he's CTO, still over there, Whitney, to join ELT. And it was his first or second of these meetings, and Ops was presenting. And in the time-honored tradition of while these nine-hour QBR-type meetings are happening, you know, we spend the whole time Slacking each other, you know, trying to figure out what the hell is going on. He texted me: \"Wait a second. Th- this doesn't make any sense. Like, how does it take ninety minutes for a web lead, a form fill, to actually get a rep owner and get rotated to them and be notified?\""}, {"timestamp": "01:54", "start_seconds": 114, "text": "And I said, \"Be very careful what you ask. Be very careful. I will tell you the answer, but then you cannot un-know it.\" You know, because of course, the Ops team had a lot of kind of machinery, and they didn't have necessarily an engineering team doing this stuff. And so I told Whitney the answer, you know, \"This is the deal, and we got to do this enrichment lookup, and then we got to go check for channel conflicts, and we got to do this, and we got to do that.\" And, you know, he, he's asking these engineering questions, or, you know, are they doing FIFO queues?"}, {"timestamp": "02:26", "start_seconds": 146, "text": "Are they doing this? Are they using Kafka and all the rest of it? And I'm like, \"See what I said? Be very careful.\" So once he knew it, though, that was it, right? A year later, we were the proud owners of all of corporate IT, including RevOps, which led to me having an incredible experience, managing a guy who's still there, EVP of Ops at HubSpot, Chris Hogan, who is a legend and a gentleman and a scholar, and I had the honor of managing him for two or three years, which, you know, talk about imposter syndrome, but I learned a ton from him."}, {"timestamp": "03:01", "start_seconds": 181, "text": "The punchline here is... And this came up in the breakout session. A lot of what's in here came up in the breakout session. The punchline here is you are no longer just RevOps or StratOps or whatever. You are product engineering teams. You take a new role, you find out about thirteen engineers that you're responsible for and, you know, what on earth are they doing, and who has decided what's a vendor and what's OpEx and CapEx and all the rest of it? And then you throw AI into this whole situation. So that's kind of where we're going with this today. Good news and bad news. The good news is I intend to illustrate to you why"}, {"timestamp": "03:40", "start_seconds": 220, "text": "literally your seat of every single person at this event today, genuinely, I believe that your AI strategy represents the number one opportunity to build a multiplier effect, bend the curve, at your company more than any other department, even more than engineering. The bad news is you're gonna have to take my traditional role of being a product leader, go out, buy the black T-shirt and the New Balance and the whole thing. Robert Barricade has great black T-shirts."}, {"timestamp": "04:13", "start_seconds": 253, "text": "They're very durable. You should get them dry-cleaned. Anyway, I love this job, and a lot of the product leader job, especially as you scale and the stakes get high, spoiler, is knowing what questions to ask and then just kind of reading the response, right? So that's gonna be the takeaway today, is I wanna give all of you where to look, who to grab, and what to ask them to start a conversation on the whiteboard with. I'll give you some of the answers and some of what to look for and how to think about it, but a lot of it I'm gonna be leaving to you to kind of figure out in that room when you get back to work."}, {"timestamp": "04:49", "start_seconds": 289, "text": "So let's start with this, this idea of a company brain, which is being talked about to death on LinkedIn, on Twitter, Hacker News, wherever you look. What actually is it? What's a harness? What is an agent? You know, different vendors have different concepts of what agents are and skills. How does automation fit in? I wanna demystify some of that and kinda zoom out and say, a lot has changed, but the new world is very approachable. Just demystify it entirely for you. Here's the entry point."}, {"timestamp": "05:24", "start_seconds": 324, "text": "The way that we solve hard problems in 2026 is very different from how we solved these problems before now. That's the hard part. The easier part is once you learn this pattern, you can use it for any hard problem that you have. We have a... I think our most recent marketing campaign that we did was how to solve CRM by solving everything because this is pattern-based thinking and, you know, what to... what your starting point is, and then, you know, you'll kind of find your way like water. You'll find a way to the solution,"}, {"timestamp": "05:57", "start_seconds": 357, "text": "especially the kind of folks in this room with your level of expertise and resourcefulness. Anything you're doing, you're planning a wedding, you're building a house, or trying to get in ... a kid into private school, any hard interdisciplinary problem, you start today by making a folder. You create a new place on your laptop, and you go to Codex or probably Claude Code, and you navigate to that folder, and you begin. If you wanna get a kid into a private school, what do you do?"}, {"timestamp": "06:30", "start_seconds": 390, "text": "You grab all of the, you know, target school's websites. You convert them into markdown. You grab all the report cards, everything. You do a whisper flow dump of, you know, what you think about your kid, and you put that all in the folder, and then you start to go, \"Okay, let's make sense of this.\" And you can actually approach that problem with, where should my kid go to school? If you're building a house, you can put in all of the town ordinances, all of the information about how to apply for easements, and all this kind of stuff, lead certification, you know, contractor information, reviews from Yelp."}, {"timestamp": "07:04", "start_seconds": 424, "text": "Dump it into a folder, and then you begin. And we all know if you do that, you are going to get a spectacular result. So where is the folder at your company that really matters the most? Spoiler, it exists today, I guarantee you, and you own it. So let's go find it. Then, how do we approach it like a product leader and own a roadmap for it? All of the little decisions that are being made. Who's gonna maintain this thing? Is this OpEx or CapEx? What do we want it to be?"}, {"timestamp": "07:39", "start_seconds": 459, "text": "Why did we build this thing? I had a w- one particularly wild thing where I found out that the team at HubSpot that was working on the mobile app was off building a database technology themselves from scratch. It's like, why on earth are you doing this? This is not what we are paying you for. This is not, like, where the dollars are supposed to go into R&D. This is a solved problem. What are you doing? So start here. There are brains scattered everywhere. That sounds a little,"}, {"timestamp": "08:14", "start_seconds": 494, "text": "sounds a little wrong when I say it that way. Okay, everyone has a brain. That's a little bit more palatable. You know, I still talk to people that I managed years ago and I'm like, \"What's your rig? What's going on?\" Well, my team has this repo, this harness, you know, whatever, and then, you know, the VP has one, and then they're trying to do this thing at the company level, blah. How do you fit those all together? I'm spending a lot of time in my personal life just helping people with their AI rigs. By the way, a harness is just a folder. It's a repo. Once you start putting it in GitHub,"}, {"timestamp": "08:51", "start_seconds": 531, "text": "which I'm sure all of you and your teams have figured out, oh, wait a second, I could take a folder. I can use this GitHub thing to share it with my buddies. Yes. Okay, great. Does that give you permissioning on what's inside it? No. Okay, so there's basically this maturity curve happening of taking ideas from core engineering and applying them, which you've always done in RevOps, to be sure. But now, like, you're gonna have to go get the rest of these concepts and bring them in and these best practices. So there are all of these harnesses, all of these folders."}, {"timestamp": "09:24", "start_seconds": 564, "text": "Many of them are not gonna be in version control. No one's gonna know about except the owner. You know, I have one just for myself on my laptop. Laura in the back has one just for herself on her laptop. We vibe code whatever we want, right? But everything is connected into the right company strategy on the back end. There is one folder that sort of supersedes all of them. That is the question of how we make money. This is what gives you and your AI strategy an overarching, superseding precedence over everybody else's harnesses and rigs."}, {"timestamp": "10:03", "start_seconds": 603, "text": "So let's talk about how we kind of get them to all fit together. I am accustomed mostly to giving presentations to engineering audiences, and so I have a Lord of the Rings reference. We'll see how well it plays in this room. What do these things look like? What's even in one of these harnesses, in these folders? A company brain is, again, just a folder. It's a directory on your hard drive. It is going to have things in there that never existed in a CRM, that may have existed in a company wiki,"}, {"timestamp": "10:37", "start_seconds": 637, "text": "that may have existed on a laminated, printed out, you know, handout for sales kickoff of, \"Can everybody please follow the sales process?\" And then, you know, most of those, like, right by the bar on the way out in the trash can. You know, you have all the sales kickoff, sales process cards. But really nicely detailed examples of the strategy. When you are having your internal ops meetings and when the company meeting, you know, the CEO is talking about, \"Here are the big hills we have to climb as a company.\" You know, the bear case from Morningstar on your company, you know, if you're a public company."}, {"timestamp": "11:14", "start_seconds": 674, "text": "Documenting all of this, the same way you would document all of the building restrictions if you're building a house or the pedagogy of a school you're trying to get your kid into. Basically, just putting all of that in one place, you now have a company brain. Why? Because you can open up Claude Code in that folder and start to have a real conversation about what's going on. So how do we go from good to great? I'm here to tell you how to build the right company brain, what questions to ask your team when you get back. Here's the entry point that I would challenge you with."}, {"timestamp": "11:51", "start_seconds": 711, "text": "Think about the number that you have given your team that represents success for your AI strategy in RevOps. What changes in your FP&A, in your, in your financial plan, in your P&L? What changes in quota roll-up, in hiring, headcount plan? I have never asked this question to somebody in RevOps and had them give me an answer. I'm sure there is somebody who says, \"I am going to take ramp time from seven months to four months by Q2 of next year.\""}, {"timestamp": "12:26", "start_seconds": 746, "text": "I have not yet met them, and I talk to RevOps folks all day, every day. You cannot improve what you can't measure. This is like classic Peter Drucker management advice. If you look at engineering, what's different in 2026 from 2023? '23, '24, the beginning of '25, you all saw the news stories. You know, engineering teams are seeing 15% product- productivity improvements, and then a couple of weeks later, engineering teams are 15% less productive because of AI. And it was all this, all these little puts and takes, right?"}, {"timestamp": "13:02", "start_seconds": 782, "text": "You remember all those articles? You don't see those articles anymore. Those articles would be ridiculous in 2026. A support rep on my team ships twice as much code to production in our core app as the average engineer at a public SaaS company. Two and a half pull requests a week used to get you promoted, you'd be able to afford the fancy fixed-speed bicycle, so you could come into the office at 11:00 AM and complain about the cold brew. Today, two and a half pull requests a week is"}, {"timestamp": "13:37", "start_seconds": 817, "text": "ridiculous. Whatever chart is on the wall is going to go up. We're gonna start probably with just, like, signs of life. How many people are doing AI with... in any regard in go-to-market? That's not gonna be good enough for the people in this room. You get to a point, if you do this right, where the improvements start compounding. Our software engineering rig improves itself today. We pay for tokens and people to solve a problem one time. That problem is solved anytime we see it forever moving forward."}, {"timestamp": "14:14", "start_seconds": 854, "text": "What is the go-to-market equivalent of that? The opportunity you have is that your fellows across this go-to-market operations, go-to-market engineering, RevOps, Sales Ops, strategic ops, nobody is doing anything. The chart on the left is from Andreessen Horowitz. Coding, okay, Cursor, you know, there are a million of these, Claude Code. Legal, sure, Harvey, Legora, et cetera, et cetera. We're starting to see finance come in. We're starting to see IT come in."}, {"timestamp": "14:47", "start_seconds": 887, "text": "Sales and marketing even, but sales and RevOps are not yet expecting the kinds of things that you absolutely can get right now for not a lot of money. Anthropic on the right, I, you know, I disagree with this one a tiny bit, but it's close enough, I think. It's a little hard to see. The red is by department, how much value they've seen realized by each of these departments with AI, and the blue is the potential. I would argue that sales is probably another click out,"}, {"timestamp": "15:22", "start_seconds": 922, "text": "but their research suggests there's a lot that can be done there and almost no usage. So let's think about this. This also came up in the breakout session. What stays with the human, and what is delegated and given to the AI in the right company brain as we think of ourselves as product leaders in a revenue operations role? I try to give nice little alliterations on both sides of these to make them memorable. The things that stay, the human things, I believe firmly"}, {"timestamp": "15:56", "start_seconds": 956, "text": "that the rep stays. I think we're gonna have four archetypes in the future companies. One of them is the representative, the human UI that is going to talk about the company, be credible, make the promises. A lot of people are saying, \"We don't wanna buy from AI.\" I think that's absolutely right. But let's let that person do more of that. Let's let them be more persuasive. Let's let them be better listeners, and again, that credibility, having a person that can actually make a good promise and stand behind it. What goes? Research, recall, record keeping."}, {"timestamp": "16:33", "start_seconds": 993, "text": "Trying to find a lead list seems like a solved problem. We have datasets. We have web agents. You know, there are great companies doing these kinds of things, some of some of whom are in the, in the crowd. ParallelAI is a great company. You know, you can go find... We have a customer who's, you know, sells to police chiefs. We can pull a lead list for that company in a way that you- you're not gonna get that from ZoomInfo. We're not gonna get that from, you know, a vendor database. It is a solved problem because you can put agents on it. Recall."}, {"timestamp": "17:06", "start_seconds": 1026, "text": "With these meeting recorders, one of the first things you see is that you're just able to pay more attention in the meeting because you're not responsible for remembering all of the details. This is the new expectation. Everything is going to be remembered. Every shred of information and sentiment that matters is going to be captured. And then the record keeping, and kinda don't get me started on this, but, you know, even the frontier labs, the sales teams are sitting there with blocks on their calendar to fill out Salesforce data. My friends,"}, {"timestamp": "17:39", "start_seconds": 1059, "text": "that's insane. Their f- what are their Salesforce notes? Like, the demo of the cancer-curing super intelligence went really well. The prospect loved it, and they're, like, typing this into a salesforce.com UI. That is a solved problem. You should have absolutely perfectly clean data, and nobody should ever have to spend any time on it, and your team should have full governance over all of that. Okay, so this is what the human does. This is what the AI is gonna do. What is the relationship between those things?"}, {"timestamp": "18:13", "start_seconds": 1093, "text": "What is the ergonomic form factor, the day-to-day? What does it look like? I don't... I've never seen a team come to me for the first time having gotten this right. You know, there are a million of these kind of mono-agent Slack bots or a Vercel app that, you know, \"Hey, everybody, go ask your questions to, you know, Jarvis,\" or whatever. By the way, they're all named Jarvis. Anybody who has a mono bot named Jarvis, I hate to break it to you, but, like,"}, {"timestamp": "18:44", "start_seconds": 1124, "text": "you're not the first person to come up with that. What are, what are the ergonomics of that kind of handshake? The easiest way for me to illustrate this for you is just a before and after. The before is probably where most of your teams are. This is where engineering was in 2023, for most teams in 2024, for some teams in 2025, and is now a ridiculous world to live in. Humans are bot-sitting. Oh, we got, Claude, and then we got the connector into Salesforce."}, {"timestamp": "19:19", "start_seconds": 1159, "text": "So, hey, everybody, what you're gonna do, don't... This is gonna be amazing. You're gonna love this. Instead of entering your stuff into Salesforce, enter it into Claude, and Claude will make sure it goes into Salesforce. Okay? Anthropic did this for, like, 15 minutes and then stopped because it is slower than just entering the darn data yourself. Sitting there and then you end up with, like, 20 of these things running and that whole kind of, fatigue, that AI burnout that happens. This is not how you wanna live. The second point here is that these things are ad hoc and ephemeral."}, {"timestamp": "19:53", "start_seconds": 1193, "text": "They go away. They are happening because it occurs to somebody in the moment, oh geez, you know, I should write an email. Oh geez, I should pull a report. The work is done in the thread, again, with the human driving all of that, and then it is gone. If somebody sits there wrestling to pull an accurate verified Salesforce report for their role, for their team, and they have to try it a bunch of ways and figure out what the fields mean and all the rest of it, the next person who comes along and wants to do that same thing is going to have that same problem. This does not happen in software engineering."}, {"timestamp": "20:29", "start_seconds": 1229, "text": "If somebody is debugging an issue or optimizing UI rendering performance, and they spend an afternoon on it, everybody gets that for free the next time any task like that comes up, and it goes like this. You are spending human hours only on the things that actually matter, and the knowledge of your overall harness and system compounds over time in wild ways. And the third I talked about a little bit but, you know, a faceless void, the, you know, no names, no personality, no way to respond to something and have it, like, validate you and say, \"Okay,"}, {"timestamp": "21:06", "start_seconds": 1266, "text": "you want this in this format every Tuesday, and then you want me to do this and that? Sure, count on it.\" In engineering, faceless void, totally fine. We're used to it. In go-to-market, it's not good enough. The after here is that the intelligence is absolutely proactive. I have, an incredibly cool thing I get every day. I don't think I've shown you this, Mike. I gotta show you this. And it came up on a call. I was talking to a CRO and he said, \"You know, I've always wanted as a CRO to just know the number one thing that would surprise me about my business"}, {"timestamp": "21:42", "start_seconds": 1302, "text": "that I don't know about.\" And I was like, \"Steve, that's a great idea.\" And I, like, tell my agent off to the side, I'm like, \"Do this for me.\" And so I get these every morning, and they are just wildly interesting and entertaining. And it puts me in a situation where around the water cooler at work, and my friends who are here can confirm, I'll overhear conversations about deals, and my little, like, party trick, which is getting annoying now, and people are like, \"Dude, we get it. Stop.\" But I'll just start chiming in about the deal, and I'll be like, \"Nima's the CTO, Dan's the VP of sales. Here's a direct quote. They like this about this competitor,\" like blah."}, {"timestamp": "22:18", "start_seconds": 1338, "text": "First couple of times it played really well. Now it's just really annoying. The self-improving loops. Are you documenting somewhere what's working in a particular vertical, a particular kind of deal or situation? Do you know what is helping reps who ramp faster than they should? What are... What's different about their experience than the reps that, like, never get there and have to get pipped, you know, nine months in? Do you know? This is a solved problem. You should just be able to ask and then document that in one place"}, {"timestamp": "22:53", "start_seconds": 1373, "text": "and have everybody's agents pull off of that to coach people and make sure they're on the happy path, and update it as more information comes in. Again, in engineering, we have this. We have self-improving loops. We can auto-resolve a bug when we find it. We can also run a QA bu- a bot that goes and gets us the bugs. So we can have a web app or a SaaS product that is just actually getting better 24 hours a day, and we're sitting there, like, putting the credit card in and deciding how hot to run the system."}, {"timestamp": "23:28", "start_seconds": 1408, "text": "This is absolutely possible in go-to-market. And then again, this idea of agents that people actually form a relationship with and have more than one. GroqBot is the closest I've seen to this, where, if you go on Twitter, you'll see examples of this. The GroqBot sales team, the way they use their own product is extremely cool. They have a coach agent. They have a research agent that's going out and finding leads and coming up with email drafts. They have a data entry agent or a reporting agent. You know, prep me for my forecast meeting."}, {"timestamp": "24:02", "start_seconds": 1442, "text": "Give me a CSV, whatever. And it's a little bit spit and tissue paper and duct tape, but extremely right. Why? Because each of these agents is a long-lived entity that the human can give feedback to, and they have a defined job role that the human who manages that agent can take credit for. And this is a really important concept. If we're not deploying the AI in a way where productivity and credit can accrue through that human org chart, it's gonna be really awkward."}, {"timestamp": "24:36", "start_seconds": 1476, "text": "Because at the end of the day, we are keeping score. In this side of the house, we are keeping score. Who is productive? Who is closing deals? Who has more capacity, right, in the financial plan? Every one of your teams, I imagine, has some form of an engineering team, when a particularly wonderful example came up in the breakout session. But even if it's just you using Claude Code, that counts. You using Claude Code is the equivalent of"}, {"timestamp": "25:13", "start_seconds": 1513, "text": "six engineers worth of bandwidth from 2017. I assure you of this. You are better with Claude Code than, you know, we used to have these pods with a tech lead and a designer and two or three software engineers, and then we'd hire the Northeastern co-ops and train them up and all the rest of it, two and a half pull requests a week, all the rest of it. Every single one of you, week one on Claude Code is as powerful as, like, a whole product group from a traditional SaaS company. Build or buy? Understanding the components"}, {"timestamp": "25:48", "start_seconds": 1548, "text": "within this company brain will help you figure out what you should build and what you should buy. The good news and bad news on this that I observe is that all of you, I think, are on a similar set of thinking. That's the good news. The answers are going to be obvious and will align. I don't think it's a mystery to anybody in this room that meeting recording transcripts are absolutely gold"}, {"timestamp": "26:21", "start_seconds": 1581, "text": "because they can really tell you what's happening, whether you're forecasting, coaching, trying to drive rep productivity, whatever it is, they are absolutely gold. Granola, internal meetings, where are you capturing the decisions? You know, you might have workflows where you capture, an internal meeting and you have some nice machinery that spits out, you know, some action items and all the rest of it. Great. But where is the company strategy? Here are the things we're trying to do as a company. Can we push those out and have everybody's behavior ladder up to that somehow? The data sources. How do you take all of this information"}, {"timestamp": "27:01", "start_seconds": 1621, "text": "and put it into one place? I whiteboard with RevOps practitioners, the folks that many of you are managing, and I whiteboard out the company brain stuff that they have. Very interestingly, traditional CRM is never in the top five most useful, valuable data sources. It is just low resolution. It's not the number one priority. Meeting recordings, granola, customer Slack, you know, down the list, email. You know, let's get the Gmail in there."}, {"timestamp": "27:33", "start_seconds": 1653, "text": "They don't know how to permission that. Fine. All of that stuff in one place so that you can interact with it in a way, if anybody's used Perplexity. Like Perplexity puts the entire web into context. Claude is not as good at that. It can search the web, but it's gonna be a little bit clumsy and take some time. So that's the difference in those harnesses and in those data sources. Have a data source that gives you that instant recall and the data privacy, which I'm sure came up in everybody's breakout session as well. The agent control plane."}, {"timestamp": "28:08", "start_seconds": 1688, "text": "You could build this. You could go get Vercel Eve. You could have guardrails and tell people that they can use Instinct or Muse or whatever they want, but here's the MCP and, you know, here is a set of instructions you need to include or whatever. You have a bunch of options here, but you're going to want to be able to drive behavior change because so much of our work is gonna be done by agents. How do you decide, here's a detail about... You know, we have a new product. Everybody should be looking for attach opportunities in these circumstances. How do you drive that across everybody's agentic rig"}, {"timestamp": "28:45", "start_seconds": 1725, "text": "while letting them continue to personalize their agent experiences? Harnesses. When do you use a first-party harness? When do you build your own? Who should be using what? Work surface. There was a great, conversation in our breakout about this and different perspectives. There's a perspective that, you know what? I can vibe code whatever UI I want, which, I mean, listen, I feed my family by making these UIs, or at least I have for, you know, better part of twenty years. I don't know, man. I really don't know. I mean, it, it's humbling for us. We've spent a lot of time on UI stuff and trying to get everything perfect."}, {"timestamp": "29:20", "start_seconds": 1760, "text": "And if somebody shows up and they go, \"Look what I built,\" which happens with us all the time. They're like, \"Look at this cool thing I built.\" It's kind of hard to say like, \"Don't do that,\" you know? It's pretty cool. Knowledge management. You know, you could do this in Markdown files, or you could buy Glean, or you could do Notion, or you could do this, or you could do that. It's a very interesting open conversation. I think all of these genuinely are open conversations. I have my own feelings on each of them, but, you know, look, it, it's... Each one is a separate decision, in a real"}, {"timestamp": "29:54", "start_seconds": 1794, "text": "research project to think about what you wanna do. So here's, as promised, what to walk away with. The first thing is to ask the team, or maybe you know, y'all are senior enough, you could actually probably just go tell your teams. But what are we measuring? What is success? Whoever on your team is the Claude Code sicko that you're really hoping will get those wins for you, if you promote them in six months, what is the slide they showed you that you then showed to the CEO and said, \"Look at how amazing we are with this AI stuff. We're really moving the needle\"?"}, {"timestamp": "30:27", "start_seconds": 1827, "text": "Pick a metric. There are metrics in the financial plan that you have never been able to move, that finance has never been able to move, that are now very movable. I'm not in a position to tell you all you should double quota, right? And there's a little bit of a standoff right now where nobody wants to say something that sounds ridiculous. But whatever number, you know, is possible for you to move, if somebody told you that number and how much you could move it- Mm ... in reality today, it would seem ridiculous. Second thing, once you have that number, how do we get from baseline to two X?"}, {"timestamp": "31:02", "start_seconds": 1862, "text": "That's gonna be the biggest lift. Once you're at four X or two X or ten X, getting to a hundred X is largely going to solve itself, believe it or not, because these systems tend towards self-improvement. And then whiteboard for me, who has control of what? Who can see what? These agents, these skills that are running in the background, who owns that? Oh, well, we have a thing where we push these skills out to people, and we tell them to put it into Claude and all the rest of it."}, {"timestamp": "31:36", "start_seconds": 1896, "text": "It's like, get a really good answer for that, and then, you know what I'm saying to you is I think your judgment will lead you into the right sub conversations for whatever your business priorities are, whatever your stack is at the moment and what you want it to be. If anybody gives you an incredibly good answer for this third one, I would just say, I'm a little out of line saying it, but, like, lock them up and bubble wrap them with a huge equity grant, because that person is an adult and is really thinking about your company deeply. I would promote them and keep them around forever."}, {"timestamp": "32:12", "start_seconds": 1932, "text": "So that's it. You are no longer just RevOps. You are product engineers. Hopefully, the idea of a company brain makes sense. Hopefully, you have, conversations to have lovingly with your, beloved teams when you get back to the office, and, yeah, that's life after CRM."}], "i18n": {"vi": {"title": "Chiến lược RevOps trong kỷ nguyên AI: Nên tự xây dựng (Build) hay mua ngoài (Buy) Bộ não Doanh nghiệp (Cựu CPO HubSpot Christopher O'Donnell)", "one_liner": "Khung tư duy chiến lược giúp đội ngũ Vận hành Doanh thu (RevOps) thiết kế 'Bộ não Doanh nghiệp' (Company Brain): dùng Claude Code để tự xây dựng các luồng ngữ cảnh đặc thù và chỉ mua ngoài hạ tầng dữ liệu nền tảng.", "executive_summary": "Bài diễn thuyết của Christopher O'Donnell (Cựu Giám đốc Sản phẩm HubSpot, hiện tại ở Vector) phân tích sự chuyển dịch căn bản của bộ phận Vận hành Doanh thu (RevOps) trong kỷ nguyên AI Agent. Trước đây, các yêu cầu công cụ nội bộ của RevOps luôn bị xếp sau ưu tiên phát triển sản phẩm chính; nhưng hiện nay, một nhân sự RevOps sử dụng công cụ lập trình AI (như Claude Code) có năng suất tương đương một nhóm 6 kỹ sư phần mềm năm 2017. Trọng tâm cốt lõi là xây dựng 'Bộ não Doanh nghiệp' (Company Brain) — thực chất là một kho lưu trữ ngữ cảnh có cấu trúc (thư mục Markdown/GitHub Repo kết hợp bản ghi cuộc họp, dữ liệu CRM và quy trình nội bộ) để các AI Agent chủ động phân tích giao dịch và tự cải tiến vòng lặp bán hàng. Để thành công, lãnh đạo RevOps phải: (1) Gắn chiến lược AI với một chỉ số tài chính cụ thể trên báo cáo P&L (như rút ngắn thời gian đào tạo nhân sự sale từ 7 tháng xuống 4 tháng); (2) Giữ con người ở vai trò tạo dựng niềm tin và cam kết với khách hàng, giao toàn bộ việc nghiên cứu, ghi chép và tổng hợp dữ liệu cho AI; và (3) Mua ngoài (Buy) các nền tảng thu thập dữ liệu thô, nhưng bắt buộc tự xây dựng (Build) lớp điều phối quy trình và trí tuệ đặc thù của doanh nghiệp.", "chapters": [{"timestamp": "00:00", "seconds": 0, "title": "Bài học 10 năm tại HubSpot: Từ dữ liệu sản phẩm đến bài toán thiếu hụt công cụ RevOps"}, {"timestamp": "03:15", "seconds": 195, "title": "Sự chuyển dịch vai trò: Đội ngũ RevOps chính là bộ phận kỹ thuật sản phẩm mới"}, {"timestamp": "04:49", "seconds": 289, "title": "Giải mã khái niệm 'Bộ não Doanh nghiệp' (Company Brain), Harness và AI Agent"}, {"timestamp": "05:53", "seconds": 353, "title": "Phương pháp khởi tạo thực chiến: Bắt đầu mọi bài toán phức tạp từ một thư mục Markdown"}, {"timestamp": "08:02", "seconds": 482, "title": "Hợp nhất các kho tri thức phân tán giữa cá nhân, phòng ban và toàn công ty qua GitHub"}, {"timestamp": "11:42", "seconds": 702, "title": "Nguyên tắc đo lường hiệu quả: Chiến lược AI của bạn đang dịch chuyển chỉ số tài chính nào?"}, {"timestamp": "15:31", "seconds": 931, "title": "Phân định ranh giới: Phần việc giữ lại cho Con người và phần việc chuyển giao cho AI"}, {"timestamp": "19:12", "seconds": 1152, "title": "Sai lầm phổ biến: Bắt con người làm 'bảo mẫu' nhập liệu thủ công cho các chatbot rời rạc"}, {"timestamp": "21:18", "seconds": 1278, "title": "Mô hình chuẩn: Hệ thống tác nhân chủ động (Proactive Agents) và vòng lặp tự cải tiến"}, {"timestamp": "24:59", "seconds": 1499, "title": "Đòn bẩy năng suất: 1 nhân sự RevOps + Claude Code = Băng thông của 6 kỹ sư phần mềm"}, {"timestamp": "25:31", "seconds": 1531, "title": "Khung quyết định Tự xây dựng (Build) hay Mua ngoài (Buy) các cấu phần Bộ não Doanh nghiệp"}, {"timestamp": "29:52", "seconds": 1792, "title": "Tổng kết: 3 câu hỏi chiến lược cần đặt ra ngay cho đội ngũ lãnh đạo và RevOps"}], "core_ideas": [{"chapter": "1. Bài học từ HubSpot & Nút thắt công cụ nội bộ", "timestamp": "00:00", "seconds": 0, "content": "Trong 10 năm tại HubSpot, việc đưa dữ liệu hành vi sử dụng sản phẩm vào quy trình bán hàng đã giúp đội sản phẩm đóng góp hơn 60% đầu vào doanh thu. Tuy nhiên, nghịch lý lớn nhất của các công ty phần mềm là những hệ thống phục vụ vận hành doanh thu nội bộ (RevOps) không bao giờ nằm trong Top 5 ưu tiên của đội ngũ kỹ sư, khiến bộ phận kinh doanh luôn thiếu công cụ tự động hóa phù hợp."}, {"chapter": "2. Đội ngũ RevOps trở thành Kỹ sư Sản phẩm", "timestamp": "03:15", "seconds": 195, "content": "Chiến lược AI tại bộ phận RevOps hiện mang lại hệ số nhân hiệu quả lớn hơn bất kỳ phòng ban nào khác. Thay vì chờ đợi bộ phận IT, nhân sự RevOps ngày nay phải áp dụng tư duy của Giám đốc Sản phẩm (Product Leader): biết đặt đúng câu hỏi nghiệp vụ, định hình luồng dữ liệu và trực tiếp sử dụng AI tạo mã để giải quyết bài toán vận hành."}, {"chapter": "3. Bản chất của 'Bộ não Doanh nghiệp' & Quy trình khởi tạo từ 1 Thư mục", "timestamp": "04:49", "seconds": 289, "content": "'Bộ não Doanh nghiệp' (Company Brain) và 'Harness' không phải là khái niệm trừu tượng mà bắt đầu từ một thư mục dữ liệu cấu trúc (Markdown) trên máy tính hoặc GitHub Repo, nơi tập hợp toàn bộ tài liệu, lịch sử giao dịch, bản ghi cuộc họp và quy tắc nghiệp vụ để công cụ như Claude Code hoặc Codex đọc hiểu ngữ cảnh toàn diện trước khi thực thi."}, {"chapter": "4. Liên thông tri thức & Gắn kết với Chỉ số Tài chính (P&L)", "timestamp": "11:42", "seconds": 702, "content": "Khi mỗi cá nhân và phòng ban tự tạo các kho ngữ cảnh riêng lẻ, doanh nghiệp cần chuẩn hóa và hợp nhất chúng qua hệ thống quản lý phiên bản (GitHub). Đặc biệt, mọi dự án AI trong RevOps bắt buộc phải gắn với một chỉ số đo lường cụ thể trên bảng kế hoạch tài chính (FP&A/P&L) — ví dụ rút ngắn thời gian hội nhập của nhân viên bán hàng mới từ 7 tháng xuống 4 tháng."}, {"chapter": "5. Phân công lao động Con người vs. AI & Chuyển sang Tác nhân Chủ động", "timestamp": "15:31", "seconds": 931, "content": "Khách hàng không muốn mua hàng từ máy móc; vì vậy con người phải giữ vai trò đại diện uy tín, lắng nghe, thuyết phục và đưa ra cam kết. Ngược lại, toàn bộ khâu nghiên cứu khách hàng, ghi nhớ hồ sơ và cập nhật CRM phải chuyển giao cho AI chạy ngầm tự động (Proactive Agents) — tuyệt đối tránh sai lầm biến nhân viên thành 'bảo mẫu' phải gõ lệnh thủ công cho từng chatbot rời rạc."}, {"chapter": "6. Nguyên tắc Tự xây (Build) vs. Mua ngoài (Buy) & 3 Câu hỏi Hành động", "timestamp": "25:31", "seconds": 1531, "content": "Với năng suất 1 người dùng Claude Code bằng 6 kỹ sư truyền thống, doanh nghiệp nên MUA NGOÀI (Buy) các nền tảng hạ tầng thu thập dữ liệu chuẩn hóa (như công cụ ghi âm, bóc tách bản ghi cuộc họp, cơ sở dữ liệu khách hàng) và TỰ XÂY DỰNG (Build) lớp quy trình nghiệp vụ, sổ cái tri thức và các tác nhân phân tích đặc thù tạo nên lợi thế cạnh tranh riêng của công ty."}], "key_insights": [{"timestamp": "02:32", "seconds": 152, "content": "Quy luật ưu tiên nguồn lực: Trong các công ty công nghệ, công cụ nội bộ cho đội ngũ Go-To-Market (Bán hàng & Marketing) hiếm khi được đội kỹ thuật ưu tiên; sự xuất hiện của Coding Agent giúp RevOps tự giải phóng khỏi điểm nghẽn này."}, {"timestamp": "11:42", "seconds": 702, "content": "Nguyên lý quản trị Peter Drucker trong kỷ nguyên AI: Không thể cải thiện thứ không đo lường được — triển khai AI trong RevOps mà không chỉ rõ sự thay đổi trên chỉ số doanh thu, hạn ngạch (Quota) hay thời gian đào tạo (Ramp time) thì chỉ là phong trào thử nghiệm."}, {"timestamp": "19:12", "seconds": 1152, "content": "Hội chứng mệt mỏi vì AI (AI Burnout): Việc bắt nhân viên nhập liệu qua lại giữa hàng chục cửa sổ chat ad-hoc còn chậm hơn thao tác trực tiếp trên CRM; hệ thống AI hiệu quả phải tự động chạy ngầm dựa trên sự kiện (Event-driven) và gửi báo cáo tổng hợp mỗi sáng."}, {"timestamp": "25:31", "seconds": 1531, "content": "Bản ghi âm cuộc họp (Meeting Transcripts) là 'mỏ vàng' dữ liệu quan trọng nhất của Bộ não Doanh nghiệp vì chứa đựng nguyên văn nhu cầu khách hàng, thông tin đối thủ và diễn biến thực tế của từng thương vụ."}], "actionable_steps": [{"timestamp": "05:53", "seconds": 353, "content": "Bước 1 — Khởi tạo Kho ngữ cảnh (Harness): Tạo một thư mục cấu trúc chuẩn (hoặc GitHub Repository), chuyển đổi toàn bộ tài liệu quy trình, hồ sơ sản phẩm và bản ghi cuộc họp sang định dạng Markdown để làm nền tảng cho Claude Code."}, {"timestamp": "25:31", "seconds": 1531, "content": "Bước 2 — Phân tách danh mục Build vs. Buy: Mua các công cụ thu thập dữ liệu đầu vào (ghi âm cuộc họp, làm giàu dữ liệu khách hàng), đồng thời tự lập trình các Agent nội bộ để tự động hóa luồng đánh giá giao dịch, dự báo doanh số và huấn luyện sale."}, {"timestamp": "29:52", "seconds": 1792, "content": "Bước 3 — Áp dụng 3 câu hỏi kiểm chứng cho đội ngũ: (1) Chỉ số tài chính (P&L) cụ thể nào sẽ thay đổi sau 6 tháng áp dụng AI? (2) Dữ liệu cuộc họp và quyết định nội bộ đang được lưu trữ ở đâu? (3) Quy trình nào đang bắt con người phục vụ bot cần được chuyển thành vòng lặp tự động?"}]}, "en": {"title": "What RevOps Should Build vs. Buy for the Company Brain (Ex-HubSpot CPO Christopher O'Donnell at Vector)", "one_liner": "A strategic framework for Revenue Operations (RevOps) leaders on architecting the 'Company Brain': leveraging coding agents like Claude Code to build proprietary workflow intelligence while buying foundational data capture layers.", "executive_summary": "Christopher O'Donnell (Former Chief Product Officer at HubSpot, now at Vector) explains how AI coding agents fundamentally transform Revenue Operations (RevOps). Historically, internal Go-To-Market tools never cracked the top five engineering priorities; today, a single RevOps operator equipped with Claude Code has the development bandwidth of six software engineers from 2017. At the center of this shift is the 'Company Brain' — a structured, version-controlled repository of markdown context, meeting transcripts, CRM state, and operational rules that enables proactive AI agents and self-improving loops. To succeed, RevOps leaders must: (1) Anchor AI initiatives to a hard FP&A / P&L metric (such as cutting sales rep ramp time from seven months to four); (2) Keep humans focused on high-trust customer relationships and credible promises while offloading research, recall, and record-keeping to background agents; and (3) Buy commodity data ingestion tools while building custom orchestration and domain-specific intelligence in-house.", "chapters": [{"timestamp": "00:00", "seconds": 0, "title": "10 Years at HubSpot: Product-led sales and the internal tooling bottleneck"}, {"timestamp": "03:15", "seconds": 195, "title": "Role shift: Why RevOps is now a product engineering organization"}, {"timestamp": "04:49", "seconds": 289, "title": "Demystifying the 'Company Brain', Harnesses, and AI Agents"}, {"timestamp": "05:53", "seconds": 353, "title": "Practical starting point: Solving complex interdisciplinary problems with a Markdown folder"}, {"timestamp": "08:02", "seconds": 482, "title": "Connecting scattered personal and departmental brains through GitHub repositories"}, {"timestamp": "11:42", "seconds": 702, "title": "Accountability: Which hard P&L or FP&A metric is your AI strategy moving?"}, {"timestamp": "15:31", "seconds": 931, "title": "Division of labor: What stays human (credibility & promises) vs. what goes to AI"}, {"timestamp": "19:12", "seconds": 1152, "title": "The anti-pattern: Humans 'bot-sitting' ad-hoc chat prompts instead of true automation"}, {"timestamp": "21:18", "seconds": 1278, "title": "The target state: Proactive background agents and self-improving intelligence loops"}, {"timestamp": "24:59", "seconds": 1499, "title": "The productivity multiplier: One operator + Claude Code = Six software engineers"}, {"timestamp": "25:31", "seconds": 1531, "title": "Decision framework: What to Build vs. What to Buy inside the Company Brain"}, {"timestamp": "29:52", "seconds": 1792, "title": "Three strategic questions to take back to your leadership and RevOps team"}], "core_ideas": [{"chapter": "1. The Internal GTM Tooling Bottleneck", "timestamp": "00:00", "seconds": 0, "content": "At HubSpot, connecting product usage signals to sales workflows drove over 60% of the demand SLA. However, internal Go-To-Market and RevOps tooling almost never made it into core engineering's top five priorities, leaving revenue teams chronically underserved until AI coding agents removed the engineering dependency."}, {"chapter": "2. RevOps as a Product Engineering Team", "timestamp": "03:15", "seconds": 195, "content": "AI strategy in RevOps offers the highest leverage multiplier in the company. To capture it, RevOps professionals must adopt the mindset of product engineering leaders: defining clear system architecture, asking the right diagnostic questions, and building directly with coding agents."}, {"chapter": "3. Demystifying the Company Brain & Agent Harness", "timestamp": "04:49", "seconds": 289, "content": "A 'Company Brain' or 'Agent Harness' starts simply as a structured folder of Markdown files versioned in a GitHub repository. By aggregating domain context, rules, and historical data into clean text files, coding agents like Claude Code can reason across the entire business context."}, {"chapter": "4. Tying AI Strategy to Hard Financial Metrics (FP&A / P&L)", "timestamp": "11:42", "seconds": 702, "content": "Most RevOps teams cannot name the exact financial plan metric their AI strategy will move. Effective AI adoption requires committing to measurable P&L outcomes — such as reducing new sales rep ramp time from 7 months to 4 months or increasing quota attainment."}, {"chapter": "5. Human Credibility vs. Proactive Background Agents", "timestamp": "15:31", "seconds": 931, "content": "Buyers still want human credibility, empathy, and accountability; sales reps should spend their time listening and making trusted promises. Research, recall, and CRM hygiene must move to proactive background agents rather than forcing humans to manually 'bot-sit' 20 chat windows."}, {"chapter": "6. Build vs. Buy Framework for the Company Brain", "timestamp": "25:31", "seconds": 1531, "content": "With one operator plus Claude Code matching the output of a six-person engineering pod, companies should BUY foundational data capture layers (such as meeting transcription and enrichment providers) and BUILD proprietary context harnesses, deal-coaching loops, and custom operational workflows."}], "key_insights": [{"timestamp": "02:32", "seconds": 152, "content": "Internal GTM systems rarely win engineering prioritization against customer-facing features; empowering RevOps with coding agents eliminates this structural bottleneck."}, {"timestamp": "11:42", "seconds": 702, "content": "You cannot improve what you do not measure: every AI initiative in RevOps should target a specific, historically stubborn metric in the financial plan."}, {"timestamp": "19:12", "seconds": 1152, "content": "Typing data into an AI chat window just so it copies it into Salesforce is slower than manual entry and causes AI fatigue; real leverage comes from event-driven, proactive background loops."}, {"timestamp": "25:31", "seconds": 1531, "content": "Meeting recording transcripts are the highest-value asset in the Company Brain for forecasting, sales coaching, and competitive intelligence."}], "actionable_steps": [{"timestamp": "05:53", "seconds": 353, "content": "Step 1 — Initialize Your Context Harness: Create a structured Markdown folder synced to GitHub containing playbooks, deal context, and meeting transcripts for Claude Code."}, {"timestamp": "25:31", "seconds": 1531, "content": "Step 2 — Separate Build vs. Buy: Purchase reliable transcript and dataset ingestion tools, and build custom agent loops for deal briefings, forecasting, and rep coaching."}, {"timestamp": "29:52", "seconds": 1792, "content": "Step 3 — Align on Three Questions: (1) Which exact FP&L metric are we moving in 6 months? (2) How are we capturing internal and customer meeting transcripts? (3) How do we replace manual bot-sitting with proactive daily agent briefings?"}]}}, "schema_version": 4}, {"id": "gh_859ebb1605", "resource_type": "github_repo", "metadata": {"url": "https://github.com/danielmiessler/fabric", "title": "danielmiessler/fabric: Fabric là một framework mã nguồn mở để hỗ trợ con người bằng cách sử dụng AI. Nó cung cấp một hệ thống mô-đun để giải quyết các vấn đề cụ thể bằng cách sử dụng một bộ lời nhắc AI có nguồn lực từ cộng đồng có thể được sử dụng ở bất cứ đâu.", "channel": "GitHub (danielmiessler)", "duration": "★ 44,420 | Go", "publish_date": "2026-10-25", "extracted_at": "2026-10-25 21:30:49"}, "chat_context": {"shared_by": "User", "chat_group": "R&D", "shared_at": "2026-10-25 21:30:49", "sender_note": "Khung chắt lọc ý tưởng extract_wisdom từ video và bài viết"}, "taxonomy": {"category": "🤖 AI Agent & Công cụ Lập trình", "tags": ["ai", "augmentation", "flourishing", "life", "work", "go", "support", "azure", "fabric", "adds", "openai", "added"], "search_aliases": ["danielmiessler/fabric: fabric is an open-source framework for augmenting humans using ai. it provides a modular system for solving specific problems using a crowdsourced set of ai prompts that can be used anywhere.", "cong nghe, lap trinh & ai", "ai", "augmentation", "flourishing", "life", "work", "go", "support", "azure", "fabric", "adds", "openai", "added"], "sub_topic": "Kiến trúc CLI Coding Agent & Rust Harness"}, "summary": {"one_liner": "Fabric là một framework mã nguồn mở để hỗ trợ con người bằng cách sử dụng AI. Nó cung cấp một hệ thống mô-đun để giải quyết các vấn đề cụ thể bằng cách sử dụng một bộ lời nhắc AI có nguồn lực từ cộng đồng có thể được sử dụng ở bất cứ đâu.", "executive_summary": "Dự án mã nguồn mở ultraworkers/claw-code là bản tái cấu trúc sạch (clean-room implementation) bằng ngôn ngữ Rust cho hệ thống tác nhân lập trình dòng lệnh (CLI Coding Agent) theo kiến trúc đối tác của Claude Code. Hệ thống được thiết kế nhằm giải quyết bài toán hiệu năng khởi động, an toàn bộ nhớ và quản trị phiên làm việc đa tác nhân thông qua công cụ điều phối oh-my-codex (OmX) và quy trình phát triển tự động $ralph. Mã nguồn phân tách rõ ràng giữa lõi thực thi Rust hiệu năng cao (rust/) và bộ hồ sơ đặc tả kiến trúc tham chiếu (parity-spec/), cho phép lập trình viên tích hợp đa mô hình LLM (OpenAI, Anthropic, xAI, Local Ollama) ngay trên thiết bị đầu cuối."}, "wisdom_distillation": {"core_ideas": [{"chapter": "ĐỌC TÔI", "timestamp": "Ý 1", "seconds": 0, "content": "Chỉ cần sử dụng các mẫu •"}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 2", "seconds": 0, "content": "Kể từ khi bắt đầu sử dụng AI hiện đại vào cuối năm 2022, chúng tôi đã thấy số lượng ứng dụng AI **_phi thường_** để hoàn thành nhiệm vụ. Có hàng nghìn trang web, bot trò chuyện, ứng dụng di động và các giao diện khác để sử dụng tất cả các AI khác nhau."}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 3", "seconds": 0, "content": "Tất cả đều thực sự thú vị và mạnh mẽ, nhưng _không dễ để tích hợp chức năng này vào cuộc sống của chúng ta._"}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 4", "seconds": 0, "content": "**Fabric được tạo ra để giải quyết vấn đề này bằng cách tạo và sắp xếp các đơn vị cơ bản của AI—chính các lời nhắc!**"}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 5", "seconds": 0, "content": "Fabric sắp xếp các lời nhắc theo nhiệm vụ trong thế giới thực, cho phép mọi người tạo, thu thập và sắp xếp các giải pháp AI quan trọng nhất của họ ở một nơi duy nhất để sử dụng trong các công cụ yêu thích của họ. Và nếu bạn tập trung vào dòng lệnh, bạn có thể sử dụng chính Fabric làm giao diện!"}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 6", "seconds": 0, "content": "Để tìm hiểu sâu hơn về Fabric và các bộ phận bên trong của nó, hãy đọc tài liệu trong thư mục tài liệu. có"}], "key_insights": [{"timestamp": "Kiến trúc", "seconds": 0, "content": "Các thành phần chính trong tài liệu: `fabric`, What and why, Updates, Recent Major Features, Intro videos, Navigation, Changelog, Philosophy"}], "actionable_steps": [{"timestamp": "Clone", "seconds": 0, "content": "bản sao git https://github.com/danielmiessler/fabric.git"}], "facts_and_metrics": [{"timestamp": "GitHub Stats", "seconds": 0, "content": "Stars: 44,420 | Ngôn ngữ chính: Go | Chủ đề: ai, augmentation, flourishing, life, work"}], "mentioned_references": [{"name": "Trang chủ / Homepage", "url": "https://danielmiessler.com/p/fabric-origin-story", "type": "external_link"}]}, "timeline": {"chapters": [{"timestamp": "H1", "seconds": 0, "title": "`vải`"}, {"timestamp": "H2", "seconds": 0, "title": "Cái gì và tại sao"}, {"timestamp": "H3", "seconds": 0, "title": "Cập nhật"}, {"timestamp": "H4", "seconds": 0, "title": "Các tính năng chính gần đây"}, {"timestamp": "H5", "seconds": 0, "title": "Video giới thiệu"}, {"timestamp": "H6", "seconds": 0, "title": "Điều hướng"}, {"timestamp": "H7", "seconds": 0, "title": "Nhật ký thay đổi"}, {"timestamp": "H8", "seconds": 0, "title": "Triết học"}, {"timestamp": "H9", "seconds": 0, "title": "Chia vấn đề thành các thành phần"}, {"timestamp": "H10", "seconds": 0, "title": "Quá nhiều lời nhắc"}, {"timestamp": "H11", "seconds": 0, "title": "Cài đặt"}, {"timestamp": "H12", "seconds": 0, "title": "Cài đặt một dòng (Được khuyến nghị)"}], "visual_slides": []}, "transcript_corpus": [{"timestamp": "Đoạn 1", "start_seconds": 0, "text": "Just Use the Patterns •"}, {"timestamp": "Đoạn 2", "start_seconds": 1, "text": "Since the start of modern AI in late 2022 we've seen an **_extraordinary_** number of AI applications for accomplishing tasks. There are thousands of websites, chat-bots, mobile apps, and other interfaces for using all the different AI out there."}, {"timestamp": "Đoạn 3", "start_seconds": 2, "text": "It's all really exciting and powerful, but _it's not easy to integrate this functionality into our lives._"}, {"timestamp": "Đoạn 4", "start_seconds": 3, "text": "**Fabric was created to address this by creating and organizing the fundamental units of AI—the prompts themselves!**"}, {"timestamp": "Đoạn 5", "start_seconds": 4, "text": "Fabric organizes prompts by real-world task, allowing people to create, collect, and organize their most important AI solutions in a single place for use in their favorite tools. And if you're command-line focused, you can use Fabric itself as the interface!"}, {"timestamp": "Đoạn 6", "start_seconds": 5, "text": "For a deep dive into Fabric and its internals, read the documentation in the docs folder. There is"}, {"timestamp": "Đoạn 7", "start_seconds": 6, "text": "also the extremely useful and regularly updated DeepWiki for Fabric."}, {"timestamp": "Đoạn 8", "start_seconds": 7, "text": "We've been doing so many exciting things here at Fabric, I wanted to give a quick summary here to give you a sense of our development velocity!"}, {"timestamp": "Đoạn 9", "start_seconds": 8, "text": "Below are the **new features and capabilities** we've added (newest first):"}, {"timestamp": "Đoạn 10", "start_seconds": 9, "text": "- v1.4.447 (April 16, 2026) — **Claude Opus 4.7**: Updates the Anthropic SDK to v1.37.0 and adds the new Claude Opus 4.7 to the available models, including 1M-token context window support."}, {"timestamp": "Đoạn 11", "start_seconds": 10, "text": "- v1.4.437 (March 16, 2026) — **OpenAI Codex PLugin**: Fabric now supports using OpenAI Codex (with your OpenAI subscription) as a backend!"}, {"timestamp": "Đoạn 12", "start_seconds": 11, "text": "- v1.4.417 (Feb 21, 2026) — **Azure AI Gateway Plugin**: Added Azure AI Gateway plugin supporting multiple backends (AWS Bedrock, Azure OpenAI, Google Vertex AI) through a unified Azure APIM Gateway with shared subscription key authentication."}, {"timestamp": "Đoạn 13", "start_seconds": 12, "text": "- v1.4.416 (Feb 21, 2026) — **Azure Entra ID Authentication**: Added Azure Entra ID authentication plugin with shared Azure utilities, Entra ID/MSAL support, and extracted common Azure logic into a reusable `azurecommon` package."}, {"timestamp": "Đoạn 14", "start_seconds": 13, "text": "- v1.4.380 (Jan 15, 2026) — **Microsoft 365 Copilot Integration**: Added support for corporate Microsoft 365 Copilot, enabling enterprise users to leverage AI grounded in their organization's Microsoft 365 data (emails, documents, meetings."}, {"timestamp": "Đoạn 15", "start_seconds": 14, "text": "- v1.4.378 (Jan 14, 2026) — **Digital Ocean GenAI Support**: Added support for Digital Ocean GenAI, along with a guide for how to use it."}, {"timestamp": "Đoạn 16", "start_seconds": 15, "text": "- v1.4.356 (Dec 22, 2025) — **Complete Internationalization**: Full i18n support for setup prompts across all 10 languages with intelligent environment variable handling—making Fabric truly accessible worldwide while maintaining configuration consistency."}, {"timestamp": "Đoạn 17", "start_seconds": 16, "text": "- v1.4.350 (Dec 18, 2025) — **Interactive API Documentation**: Adds Swagger/OpenAPI UI at `/swagger/index.html` with comprehensive REST API documentation, enhanced developer guides, and improved endpoint discoverability for easier integration."}, {"timestamp": "Đoạn 18", "start_seconds": 17, "text": "- v1.4.338 (Dec 4, 2025) — Add Abacus vendor support for Chat-LLM"}, {"timestamp": "Đoạn 19", "start_seconds": 18, "text": "models (see RouteLLM APIs)."}, {"timestamp": "Đoạn 20", "start_seconds": 19, "text": "- v1.4.337 (Dec 4, 2025) — Add \"Z AI\" vendor support. See the Z AI overview page for more details."}, {"timestamp": "Đoạn 21", "start_seconds": 20, "text": "- v1.4.334 (Nov 26, 2025) — **Claude Opus 4.5**: Updates the Anthropic SDK to the latest and adds the new Claude Opus 4.5 to the available models."}, {"timestamp": "Đoạn 22", "start_seconds": 21, "text": "- v1.4.331 (Nov 23, 2025) — **Support for GitHub Models**: Adds support for using GitHub Models."}, {"timestamp": "Đoạn 23", "start_seconds": 22, "text": "- v1.4.322 (Nov 5, 2025) — **Interactive HTML Concept Maps and Claude Sonnet 4.5**: Adds `create_conceptmap` pattern for visual knowledge representation using Vis.js, introduces WELLNESS category with psychological analysis patterns, and upgrades to Claude Sonnet 4.5"}, {"timestamp": "Đoạn 24", "start_seconds": 23, "text": "- v1.4.317 (Sep 21, 2025) — **Portuguese Language Variants**: Adds BCP 47 locale normalization with support for Brazilian Portuguese (pt-BR) and European Portuguese (pt-PT) with intelligent fallback chains"}, {"timestamp": "Đoạn 25", "start_seconds": 24, "text": "- v1.4.314 (Sep 17, 2025) — **Azure OpenAI Migration**: Migrates to official `openai-go/azure` SDK with improved authentication and default API version support"}, {"timestamp": "Đoạn 26", "start_seconds": 25, "text": "- v1.4.311 (Sep 13, 2025) — **More internationalization support**: Adds de (German), fa (Persian / Farsi), fr (French), it (Italian),"}, {"timestamp": "Đoạn 27", "start_seconds": 26, "text": "- v1.4.309 (Sep 9, 2025) — **Comprehensive internationalization support**: Includes English and Spanish locale files."}, {"timestamp": "Đoạn 28", "start_seconds": 27, "text": "- v1.4.303 (Aug 29, 2025) — **New Binary Releases**: Linux ARM and Windows ARM targets. You can run Fabric on the Raspberry PI and on your Windows Surface!"}, {"timestamp": "Đoạn 29", "start_seconds": 28, "text": "- v1.4.294 (Aug 20, 2025) — **Venice AI Support**: Added the Venice AI provider. Venice is a Privacy-First, Open-Source AI provider. See their \"About Venice\" page for details."}, {"timestamp": "Đoạn 30", "start_seconds": 29, "text": "- v1.4.291 (Aug 18, 2025) — **Speech To Text**: Add OpenAI speech-to-text support with `--transcribe-file`, `--transcribe-model`, and `--split-media-file` flags."}, {"timestamp": "Đoạn 31", "start_seconds": 30, "text": "These features represent our commitment to making Fabric the most powerful and flexible AI augmentation framework available!"}, {"timestamp": "Đoạn 32", "start_seconds": 31, "text": "Keep in mind that many of these were recorded when Fabric was Python-based, so remember to use the current install instructions below."}, {"timestamp": "Đoạn 33", "start_seconds": 32, "text": "- Network Chuck"}, {"timestamp": "Đoạn 34", "start_seconds": 33, "text": "- David Bombal"}, {"timestamp": "Đoạn 35", "start_seconds": 34, "text": "- My Own Intro to the Tool"}, {"timestamp": "Đoạn 36", "start_seconds": 35, "text": "- More Fabric YouTube Videos"}, {"timestamp": "Đoạn 37", "start_seconds": 36, "text": "- Recent Major Features"}, {"timestamp": "Đoạn 38", "start_seconds": 37, "text": "- Breaking problems into components"}, {"timestamp": "Đoạn 39", "start_seconds": 38, "text": "- One-Line Install (Recommended)"}, {"timestamp": "Đoạn 40", "start_seconds": 39, "text": "- Manual Binary Downloads"}], "i18n": {"vi": {"title": "danielmiessler/fabric: Fabric là một framework mã nguồn mở để hỗ trợ con người bằng cách sử dụng AI. Nó cung cấp một hệ thống mô-đun để giải quyết các vấn đề cụ thể bằng cách sử dụng một bộ lời nhắc AI có nguồn lực từ cộng đồng có thể được sử dụng ở bất cứ đâu.", "one_liner": "Fabric là một framework mã nguồn mở để hỗ trợ con người bằng cách sử dụng AI. Nó cung cấp một hệ thống mô-đun để giải quyết các vấn đề cụ thể bằng cách sử dụng một bộ lời nhắc AI có nguồn lực từ cộng đồng có thể được sử dụng ở bất cứ đâu.", "executive_summary": "Dự án mã nguồn mở ultraworkers/claw-code là bản tái cấu trúc sạch (clean-room implementation) bằng ngôn ngữ Rust cho hệ thống tác nhân lập trình dòng lệnh (CLI Coding Agent) theo kiến trúc đối tác của Claude Code. Hệ thống được thiết kế nhằm giải quyết bài toán hiệu năng khởi động, an toàn bộ nhớ và quản trị phiên làm việc đa tác nhân thông qua công cụ điều phối oh-my-codex (OmX) và quy trình phát triển tự động $ralph. Mã nguồn phân tách rõ ràng giữa lõi thực thi Rust hiệu năng cao (rust/) và bộ hồ sơ đặc tả kiến trúc tham chiếu (parity-spec/), cho phép lập trình viên tích hợp đa mô hình LLM (OpenAI, Anthropic, xAI, Local Ollama) ngay trên thiết bị đầu cuối.", "chapters": [{"timestamp": "H1", "seconds": 0, "title": "`vải`"}, {"timestamp": "H2", "seconds": 0, "title": "Cái gì và tại sao"}, {"timestamp": "H3", "seconds": 0, "title": "Cập nhật"}, {"timestamp": "H4", "seconds": 0, "title": "Các tính năng chính gần đây"}, {"timestamp": "H5", "seconds": 0, "title": "Video giới thiệu"}, {"timestamp": "H6", "seconds": 0, "title": "Điều hướng"}, {"timestamp": "H7", "seconds": 0, "title": "Nhật ký thay đổi"}, {"timestamp": "H8", "seconds": 0, "title": "Triết học"}, {"timestamp": "H9", "seconds": 0, "title": "Chia vấn đề thành các thành phần"}, {"timestamp": "H10", "seconds": 0, "title": "Quá nhiều lời nhắc"}, {"timestamp": "H11", "seconds": 0, "title": "Cài đặt"}, {"timestamp": "H12", "seconds": 0, "title": "Cài đặt một dòng (Được khuyến nghị)"}], "core_ideas": [{"chapter": "ĐỌC TÔI", "timestamp": "Ý 1", "seconds": 0, "content": "Chỉ cần sử dụng các mẫu •"}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 2", "seconds": 0, "content": "Kể từ khi bắt đầu sử dụng AI hiện đại vào cuối năm 2022, chúng tôi đã thấy số lượng ứng dụng AI **_phi thường_** để hoàn thành nhiệm vụ. Có hàng nghìn trang web, bot trò chuyện, ứng dụng di động và các giao diện khác để sử dụng tất cả các AI khác nhau."}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 3", "seconds": 0, "content": "Tất cả đều thực sự thú vị và mạnh mẽ, nhưng _không dễ để tích hợp chức năng này vào cuộc sống của chúng ta._"}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 4", "seconds": 0, "content": "**Fabric được tạo ra để giải quyết vấn đề này bằng cách tạo và sắp xếp các đơn vị cơ bản của AI—chính các lời nhắc!**"}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 5", "seconds": 0, "content": "Fabric sắp xếp các lời nhắc theo nhiệm vụ trong thế giới thực, cho phép mọi người tạo, thu thập và sắp xếp các giải pháp AI quan trọng nhất của họ ở một nơi duy nhất để sử dụng trong các công cụ yêu thích của họ. Và nếu bạn tập trung vào dòng lệnh, bạn có thể sử dụng chính Fabric làm giao diện!"}, {"chapter": "ĐỌC TÔI", "timestamp": "Ý 6", "seconds": 0, "content": "Để tìm hiểu sâu hơn về Fabric và các bộ phận bên trong của nó, hãy đọc tài liệu trong thư mục tài liệu. có"}], "key_insights": [{"timestamp": "Kiến trúc", "seconds": 0, "content": "Các thành phần chính trong tài liệu: `fabric`, What and why, Updates, Recent Major Features, Intro videos, Navigation, Changelog, Philosophy"}], "actionable_steps": [{"timestamp": "Clone", "seconds": 0, "content": "bản sao git https://github.com/danielmiessler/fabric.git"}]}, "en": {"title": "danielmiessler/fabric: Fabric is an open-source framework for augmenting humans using AI. It provides a modular system for solving specific problems using a crowdsourced set of AI prompts that can be used anywhere.", "one_liner": "Fabric is an open-source framework for augmenting humans using AI. It provides a modular system for solving specific problems using a crowdsourced set of AI prompts that can be used anywhere.", "executive_summary": "ultraworkers/claw-code is a high-performance Rust clean-room implementation of the CLI coding agent harness architecture popularized by Claude Code. It addresses startup latency, memory safety, and multi-agent session orchestration using oh-my-codex (OmX) and autonomous $ralph development loops. The repository cleanly separates the native Rust runtime workspace (rust/) from reference parity specifications, enabling developers to run multi-provider LLM coding agents (Anthropic, OpenAI, xAI, Ollama) directly in the terminal.", "chapters": [{"timestamp": "H1", "seconds": 0, "title": "`fabric`"}, {"timestamp": "H2", "seconds": 0, "title": "What and why"}, {"timestamp": "H3", "seconds": 0, "title": "Updates"}, {"timestamp": "H4", "seconds": 0, "title": "Recent Major Features"}, {"timestamp": "H5", "seconds": 0, "title": "Intro videos"}, {"timestamp": "H6", "seconds": 0, "title": "Navigation"}, {"timestamp": "H7", "seconds": 0, "title": "Changelog"}, {"timestamp": "H8", "seconds": 0, "title": "Philosophy"}, {"timestamp": "H9", "seconds": 0, "title": "Breaking problems into components"}, {"timestamp": "H10", "seconds": 0, "title": "Too many prompts"}, {"timestamp": "H11", "seconds": 0, "title": "Installation"}, {"timestamp": "H12", "seconds": 0, "title": "One-Line Install (Recommended)"}], "core_ideas": [{"chapter": "README", "timestamp": "Ý 1", "seconds": 0, "content": "Just Use the Patterns •"}, {"chapter": "README", "timestamp": "Ý 2", "seconds": 0, "content": "Since the start of modern AI in late 2022 we've seen an **_extraordinary_** number of AI applications for accomplishing tasks. There are thousands of websites, chat-bots, mobile apps, and other interfaces for using all the different AI out there."}, {"chapter": "README", "timestamp": "Ý 3", "seconds": 0, "content": "It's all really exciting and powerful, but _it's not easy to integrate this functionality into our lives._"}, {"chapter": "README", "timestamp": "Ý 4", "seconds": 0, "content": "**Fabric was created to address this by creating and organizing the fundamental units of AI—the prompts themselves!**"}, {"chapter": "README", "timestamp": "Ý 5", "seconds": 0, "content": "Fabric organizes prompts by real-world task, allowing people to create, collect, and organize their most important AI solutions in a single place for use in their favorite tools. And if you're command-line focused, you can use Fabric itself as the interface!"}, {"chapter": "README", "timestamp": "Ý 6", "seconds": 0, "content": "For a deep dive into Fabric and its internals, read the documentation in the docs folder. There is"}], "key_insights": [{"timestamp": "Kiến trúc", "seconds": 0, "content": "Các thành phần chính trong tài liệu: `fabric`, What and why, Updates, Recent Major Features, Intro videos, Navigation, Changelog, Philosophy"}], "actionable_steps": [{"timestamp": "Clone", "seconds": 0, "content": "git clone https://github.com/danielmiessler/fabric.git"}]}}, "schema_version": 4}, {"id": "gh_elyned", "schema_version": 4, "resource_type": "github_repo", "metadata": {"url": "https://github.com/cloudflare/security-audit-skill", "title": "[GitHub] cloudflare/security-audit-skill (★ 46,206) — Bộ kỹ năng kiểm toán bảo mật đa giai đoạn cho AI Coding Agent của Cloudflare", "channel": "github.com/cloudflare", "duration": "6 giai đoạn • 11 phân lớp bảo mật", "publish_date": "2026-10-25", "extracted_at": "2026-10-25 23:00:00"}, "chat_context": {"shared_by": "User", "chat_group": "Zalo / R&D", "shared_at": "2026-10-25 23:00:00", "sender_note": "Chia sẻ trực tiếp sang Krypto"}, "taxonomy": {"category": "🛡️ An toàn Thông tin & Kiểm toán Bảo mật", "tags": ["cloudflare", "security-audit", "coding-agent", "vulnerability-hunting", "ai-security", "devsecops"], "search_aliases": ["cloudflare security audit skill", "kiem toan bao mat ai", "lo hong bao mat"], "sub_topic": "Kiểm toán Bảo mật AI & Săn tìm Lỗ hổng"}, "summary": {"one_liner": "Bộ kỹ năng (Agent Skill) của Cloudflare biến AI Coding Agent thành kiểm toán viên bảo mật chuyên nghiệp thông qua quy trình 6 giai đoạn độc lập, có sổ cái kiểm soát độ phủ và xác minh chéo chống ảo giác.", "executive_summary": "Dự án cloudflare/security-audit-skill là bộ kỹ năng kiểm toán bảo mật mã nguồn mở do đội ngũ Nghiên cứu Bảo mật AI của Cloudflare phát triển (nền tảng khởi nguồn của hệ thống rà quét lỗ hổng tự động toàn hệ thống tại Cloudflare). Thay vì để một AI đọc mã nguồn một cách cảm tính và sinh báo cáo lỗi giả (false positives), công cụ này điều phối nhiều tác nhân độc lập (isolated sub-agents) đi qua 6 giai đoạn: (1) Trinh sát kiến trúc và ranh giới tin cậy; (2) Săn tìm lỗ hổng theo sổ cái độ phủ; (3) Thẩm định phản biện độc lập; (4) Chuẩn hóa kết quả theo JSON Schema; (5) Xác minh chéo bằng chứng mã nguồn; và (6) Xuất báo cáo trung lập. Hệ thống bao quát 11 nhóm tấn công chuyên sâu (từ an toàn bộ nhớ nhị phân, lỗ hổng giao thức Web/Auth, Prompt Injection trên LLM đến chuỗi cung ứng CI/CD và cô lập dữ liệu đa thuê bao), giúp phát hiện gấp đôi số lỗ hổng thực tế khi chạy lặp nhiều vòng."}, "wisdom_distillation": {"core_ideas": [{"chapter": "1. Tổng quan & Ý nghĩa cốt lõi", "timestamp": "Mục 1", "seconds": 0, "content": "Biến AI Coding Agent thành hệ thống kiểm toán bảo mật có kỷ luật kỹ thuật cao. Đây chính là hạt nhân khởi đầu cho hệ thống phát hiện lỗ hổng diện rộng (Vulnerability Discovery Harness) của Cloudflare, hỗ trợ chạy cộng dồn nhiều vòng (additive runs) trên cùng một kho mã nguồn để lấp đầy các khoảng trống chưa được kiểm tra."}, {"chapter": "2. Quy trình Kiểm toán 6 Giai đoạn (What it does)", "timestamp": "Mục 2", "seconds": 1, "content": "(1) Trinh sát (Reconnaissance): Lập bản đồ kiến trúc, ranh giới tin cậy và bề mặt đầu vào trong architecture.md và coverage-ledger.json; (2) Săn tìm theo độ phủ (Coverage-led hunting): Phân công các tác nhân săn lỗi độc lập theo từng đơn vị sổ cái; (3) Thẩm định ứng viên (Candidate validation): Giao mỗi phát hiện cho một tác nhân phản biện mới tìm cách bác bỏ nó; (4) Xuất cấu trúc chuẩn (findings.json): Phân loại rõ confirmed, needs_validation và rejected; (5) Xác minh độc lập; (6) Xuất báo cáo REPORT.md và FINDINGS-DETAIL.md."}, {"chapter": "3. Hệ thống 11 Phân lớp Săn tìm Lỗ hổng (Attack Classes)", "timestamp": "Mục 3", "seconds": 2, "content": "Bộ kỹ năng cung cấp các mô-đun chuyên sâu cho từng bề mặt tấn công: An toàn bộ nhớ & nhị phân (MEMORY-SAFETY-AND-BINARY), Bảo mật AI & LLM (Prompt Injection, gọi công cụ), Giao thức Web & Xác thực (HTTP framing, Cache, Auth), Bảo mật trình duyệt (DOM/UI redress), Chuỗi cung ứng & CI/CD, Hạ tầng đám mây (IAM, IaC, Container), Giao thức RPC/Messaging, Cạn kiệt tài nguyên (DoS/Quota), Cô lập dữ liệu đa thuê bao và IPC trên Desktop/Mobile."}, {"chapter": "4. Năm Nguyên lý Thiết kế Chống Ảo giác (Design Principles)", "timestamp": "Mục 4", "seconds": 3, "content": "(1) Chỉ xác nhận lỗi (confirmed) khi chứng minh được sự phá vỡ ranh giới bảo mật kèm dấu vết mã nguồn đầy đủ; (2) Thẩm định đối kháng (Adversarial validation): Tác nhân kiểm tra không bao giờ là tác nhân phát hiện ra lỗi đó; (3) Mức độ nghiêm trọng phải dựa trên Tác động thực tế x Khả năng xảy ra; (4) Thiếu lớp phòng thủ phụ (Defense-in-depth) khi lớp chính đã chặn được tấn công chỉ được ghi nhận là lưu ý gia cố (hardening note), không tính là lỗ hổng; (5) Chạy nhiều vòng giúp tăng gấp đôi số lỗ hổng phát hiện được."}, {"chapter": "5. Cài đặt, Kích hoạt & Yêu cầu Sandbox An toàn", "timestamp": "Mục 5", "seconds": 4, "content": "Cài đặt qua lệnh 'npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit --global' và kích hoạt bằng câu lệnh 'security audit this codebase'. Khi cần biên dịch hoặc chạy thử mã nguồn mục tiêu, hệ thống yêu cầu môi trường Sandbox cấp hệ điều hành (ngắt mạng ngoài, giới hạn tài nguyên, chỉ ghi vào thư mục tạm) để đảm bảo an toàn tuyệt đối."}], "key_insights": [{"timestamp": "Nguyên lý 1", "seconds": 0, "content": "Thẩm định đối kháng (Adversarial Validation): Bí quyết giúp Cloudflare loại bỏ báo cáo giả của AI là bắt buộc một tác nhân độc lập thứ hai đóng vai người phản biện (verifier) cố gắng chứng minh phát hiện của tác nhân thứ nhất là sai."}, {"timestamp": "Nguyên lý 2", "seconds": 1, "content": "Kiểm soát độ phủ bằng Sổ cái tất định (validate-coverage-ledger.cjs): Thay vì quét ngẫu nhiên, mọi thành phần mã nguồn đều được ghi vào sổ cái độ phủ để các lần chạy sau tiếp tục đào sâu vào các vùng chưa được kiểm tra."}, {"timestamp": "Nguyên lý 3", "seconds": 2, "content": "Thực nghiệm của Cloudflare cho thấy 1 lần chạy đơn lẻ chỉ tìm thấy khoảng 50% tổng số lỗ hổng; cơ chế chạy tích lũy nhiều vòng (Multiple additive runs) là chìa khóa để đạt độ phủ bảo mật toàn diện."}], "actionable_steps": [{"timestamp": "Bước 1", "seconds": 0, "content": "Cài đặt bộ kỹ năng vào Coding Agent bằng lệnh: npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit --global"}, {"timestamp": "Bước 2", "seconds": 1, "content": "Mở Coding Agent tại thư mục dự án cần kiểm tra và yêu cầu: 'do a security review, output to ~/audits/my-project' để chạy toàn trình 6 giai đoạn."}, {"timestamp": "Bước 3", "seconds": 2, "content": "Rà soát tệp báo cáo đầu ra REPORT.md, FINDINGS-DETAIL.md và chạy lặp lại định kỳ sau mỗi lần cập nhật mã nguồn để tận dụng sổ cái độ phủ tích lũy (coverage-ledger.json)."}], "facts_and_metrics": [], "mentioned_references": [{"name": "cloudflare/security-audit-skill", "url": "https://github.com/cloudflare/security-audit-skill", "type": "github_repo"}]}, "timeline": {"chapters": [{"timestamp": "Mục 1", "seconds": 0, "title": "Tổng quan & Nguồn gốc từ Hệ thống Rà quét Lỗ hổng của Cloudflare"}, {"timestamp": "Mục 2", "seconds": 1, "title": "Quy trình Kiểm toán Bảo mật 6 Giai đoạn (Six-Phase Audit Pipeline)"}, {"timestamp": "Mục 3", "seconds": 2, "title": "11 Phân lớp Tấn công & Mô-đun Săn tìm Lỗ hổng Chuyên biệt"}, {"timestamp": "Mục 4", "seconds": 3, "title": "5 Nguyên lý Thiết kế Cốt lõi (Thẩm định Đối kháng & Chống Báo động giả)"}, {"timestamp": "Mục 5", "seconds": 4, "title": "Cài đặt, Vận hành & Yêu cầu Môi trường Sandbox Cô lập"}], "visual_slides": []}, "transcript_corpus": [{"timestamp": "Mục 1", "start_seconds": 0, "text": "1. Tổng quan & Ý nghĩa cốt lõi: Biến AI Coding Agent thành hệ thống kiểm toán bảo mật có kỷ luật kỹ thuật cao. Đây chính là hạt nhân khởi đầu cho hệ thống phát hiện lỗ hổng diện rộng (Vulnerability Discovery Harness) của Cloudflare, hỗ trợ chạy cộng dồn nhiều vòng (additive runs) trên cùng một kho mã nguồn để lấp đầy các khoảng trống chưa được kiểm tra."}, {"timestamp": "Mục 2", "start_seconds": 1, "text": "2. Quy trình Kiểm toán 6 Giai đoạn (What it does): (1) Trinh sát (Reconnaissance): Lập bản đồ kiến trúc, ranh giới tin cậy và bề mặt đầu vào trong architecture.md và coverage-ledger.json; (2) Săn tìm theo độ phủ (Coverage-led hunting): Phân công các tác nhân săn lỗi độc lập theo từng đơn vị sổ cái; (3) Thẩm định ứng viên (Candidate validation): Giao mỗi phát hiện cho một tác nhân phản biện mới tìm cách bác bỏ nó; (4) Xuất cấu trúc chuẩn (findings.json): Phân loại rõ confirmed, needs_validation và rejected; (5) Xác minh độc lập; (6) Xuất báo cáo REPORT.md và FINDINGS-DETAIL.md."}, {"timestamp": "Mục 3", "start_seconds": 2, "text": "3. Hệ thống 11 Phân lớp Săn tìm Lỗ hổng (Attack Classes): Bộ kỹ năng cung cấp các mô-đun chuyên sâu cho từng bề mặt tấn công: An toàn bộ nhớ & nhị phân (MEMORY-SAFETY-AND-BINARY), Bảo mật AI & LLM (Prompt Injection, gọi công cụ), Giao thức Web & Xác thực (HTTP framing, Cache, Auth), Bảo mật trình duyệt (DOM/UI redress), Chuỗi cung ứng & CI/CD, Hạ tầng đám mây (IAM, IaC, Container), Giao thức RPC/Messaging, Cạn kiệt tài nguyên (DoS/Quota), Cô lập dữ liệu đa thuê bao và IPC trên Desktop/Mobile."}, {"timestamp": "Mục 4", "start_seconds": 3, "text": "4. Năm Nguyên lý Thiết kế Chống Ảo giác (Design Principles): (1) Chỉ xác nhận lỗi (confirmed) khi chứng minh được sự phá vỡ ranh giới bảo mật kèm dấu vết mã nguồn đầy đủ; (2) Thẩm định đối kháng (Adversarial validation): Tác nhân kiểm tra không bao giờ là tác nhân phát hiện ra lỗi đó; (3) Mức độ nghiêm trọng phải dựa trên Tác động thực tế x Khả năng xảy ra; (4) Thiếu lớp phòng thủ phụ (Defense-in-depth) khi lớp chính đã chặn được tấn công chỉ được ghi nhận là lưu ý gia cố (hardening note), không tính là lỗ hổng; (5) Chạy nhiều vòng giúp tăng gấp đôi số lỗ hổng phát hiện được."}, {"timestamp": "Mục 5", "start_seconds": 4, "text": "5. Cài đặt, Kích hoạt & Yêu cầu Sandbox An toàn: Cài đặt qua lệnh 'npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit --global' và kích hoạt bằng câu lệnh 'security audit this codebase'. Khi cần biên dịch hoặc chạy thử mã nguồn mục tiêu, hệ thống yêu cầu môi trường Sandbox cấp hệ điều hành (ngắt mạng ngoài, giới hạn tài nguyên, chỉ ghi vào thư mục tạm) để đảm bảo an toàn tuyệt đối."}], "i18n": {"vi": {"title": "[GitHub] cloudflare/security-audit-skill (★ 46,206) — Bộ kỹ năng kiểm toán bảo mật đa giai đoạn cho AI Coding Agent của Cloudflare", "one_liner": "Bộ kỹ năng (Agent Skill) của Cloudflare biến AI Coding Agent thành kiểm toán viên bảo mật chuyên nghiệp thông qua quy trình 6 giai đoạn độc lập, có sổ cái kiểm soát độ phủ và xác minh chéo chống ảo giác.", "executive_summary": "Dự án cloudflare/security-audit-skill là bộ kỹ năng kiểm toán bảo mật mã nguồn mở do đội ngũ Nghiên cứu Bảo mật AI của Cloudflare phát triển (nền tảng khởi nguồn của hệ thống rà quét lỗ hổng tự động toàn hệ thống tại Cloudflare). Thay vì để một AI đọc mã nguồn một cách cảm tính và sinh báo cáo lỗi giả (false positives), công cụ này điều phối nhiều tác nhân độc lập (isolated sub-agents) đi qua 6 giai đoạn: (1) Trinh sát kiến trúc và ranh giới tin cậy; (2) Săn tìm lỗ hổng theo sổ cái độ phủ; (3) Thẩm định phản biện độc lập; (4) Chuẩn hóa kết quả theo JSON Schema; (5) Xác minh chéo bằng chứng mã nguồn; và (6) Xuất báo cáo trung lập. Hệ thống bao quát 11 nhóm tấn công chuyên sâu (từ an toàn bộ nhớ nhị phân, lỗ hổng giao thức Web/Auth, Prompt Injection trên LLM đến chuỗi cung ứng CI/CD và cô lập dữ liệu đa thuê bao), giúp phát hiện gấp đôi số lỗ hổng thực tế khi chạy lặp nhiều vòng.", "chapters": [{"timestamp": "Mục 1", "seconds": 0, "title": "Tổng quan & Nguồn gốc từ Hệ thống Rà quét Lỗ hổng của Cloudflare"}, {"timestamp": "Mục 2", "seconds": 1, "title": "Quy trình Kiểm toán Bảo mật 6 Giai đoạn (Six-Phase Audit Pipeline)"}, {"timestamp": "Mục 3", "seconds": 2, "title": "11 Phân lớp Tấn công & Mô-đun Săn tìm Lỗ hổng Chuyên biệt"}, {"timestamp": "Mục 4", "seconds": 3, "title": "5 Nguyên lý Thiết kế Cốt lõi (Thẩm định Đối kháng & Chống Báo động giả)"}, {"timestamp": "Mục 5", "seconds": 4, "title": "Cài đặt, Vận hành & Yêu cầu Môi trường Sandbox Cô lập"}], "core_ideas": [{"chapter": "1. Tổng quan & Ý nghĩa cốt lõi", "timestamp": "Mục 1", "seconds": 0, "content": "Biến AI Coding Agent thành hệ thống kiểm toán bảo mật có kỷ luật kỹ thuật cao. Đây chính là hạt nhân khởi đầu cho hệ thống phát hiện lỗ hổng diện rộng (Vulnerability Discovery Harness) của Cloudflare, hỗ trợ chạy cộng dồn nhiều vòng (additive runs) trên cùng một kho mã nguồn để lấp đầy các khoảng trống chưa được kiểm tra."}, {"chapter": "2. Quy trình Kiểm toán 6 Giai đoạn (What it does)", "timestamp": "Mục 2", "seconds": 1, "content": "(1) Trinh sát (Reconnaissance): Lập bản đồ kiến trúc, ranh giới tin cậy và bề mặt đầu vào trong architecture.md và coverage-ledger.json; (2) Săn tìm theo độ phủ (Coverage-led hunting): Phân công các tác nhân săn lỗi độc lập theo từng đơn vị sổ cái; (3) Thẩm định ứng viên (Candidate validation): Giao mỗi phát hiện cho một tác nhân phản biện mới tìm cách bác bỏ nó; (4) Xuất cấu trúc chuẩn (findings.json): Phân loại rõ confirmed, needs_validation và rejected; (5) Xác minh độc lập; (6) Xuất báo cáo REPORT.md và FINDINGS-DETAIL.md."}, {"chapter": "3. Hệ thống 11 Phân lớp Săn tìm Lỗ hổng (Attack Classes)", "timestamp": "Mục 3", "seconds": 2, "content": "Bộ kỹ năng cung cấp các mô-đun chuyên sâu cho từng bề mặt tấn công: An toàn bộ nhớ & nhị phân (MEMORY-SAFETY-AND-BINARY), Bảo mật AI & LLM (Prompt Injection, gọi công cụ), Giao thức Web & Xác thực (HTTP framing, Cache, Auth), Bảo mật trình duyệt (DOM/UI redress), Chuỗi cung ứng & CI/CD, Hạ tầng đám mây (IAM, IaC, Container), Giao thức RPC/Messaging, Cạn kiệt tài nguyên (DoS/Quota), Cô lập dữ liệu đa thuê bao và IPC trên Desktop/Mobile."}, {"chapter": "4. Năm Nguyên lý Thiết kế Chống Ảo giác (Design Principles)", "timestamp": "Mục 4", "seconds": 3, "content": "(1) Chỉ xác nhận lỗi (confirmed) khi chứng minh được sự phá vỡ ranh giới bảo mật kèm dấu vết mã nguồn đầy đủ; (2) Thẩm định đối kháng (Adversarial validation): Tác nhân kiểm tra không bao giờ là tác nhân phát hiện ra lỗi đó; (3) Mức độ nghiêm trọng phải dựa trên Tác động thực tế x Khả năng xảy ra; (4) Thiếu lớp phòng thủ phụ (Defense-in-depth) khi lớp chính đã chặn được tấn công chỉ được ghi nhận là lưu ý gia cố (hardening note), không tính là lỗ hổng; (5) Chạy nhiều vòng giúp tăng gấp đôi số lỗ hổng phát hiện được."}, {"chapter": "5. Cài đặt, Kích hoạt & Yêu cầu Sandbox An toàn", "timestamp": "Mục 5", "seconds": 4, "content": "Cài đặt qua lệnh 'npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit --global' và kích hoạt bằng câu lệnh 'security audit this codebase'. Khi cần biên dịch hoặc chạy thử mã nguồn mục tiêu, hệ thống yêu cầu môi trường Sandbox cấp hệ điều hành (ngắt mạng ngoài, giới hạn tài nguyên, chỉ ghi vào thư mục tạm) để đảm bảo an toàn tuyệt đối."}], "key_insights": [{"timestamp": "Nguyên lý 1", "seconds": 0, "content": "Thẩm định đối kháng (Adversarial Validation): Bí quyết giúp Cloudflare loại bỏ báo cáo giả của AI là bắt buộc một tác nhân độc lập thứ hai đóng vai người phản biện (verifier) cố gắng chứng minh phát hiện của tác nhân thứ nhất là sai."}, {"timestamp": "Nguyên lý 2", "seconds": 1, "content": "Kiểm soát độ phủ bằng Sổ cái tất định (validate-coverage-ledger.cjs): Thay vì quét ngẫu nhiên, mọi thành phần mã nguồn đều được ghi vào sổ cái độ phủ để các lần chạy sau tiếp tục đào sâu vào các vùng chưa được kiểm tra."}, {"timestamp": "Nguyên lý 3", "seconds": 2, "content": "Thực nghiệm của Cloudflare cho thấy 1 lần chạy đơn lẻ chỉ tìm thấy khoảng 50% tổng số lỗ hổng; cơ chế chạy tích lũy nhiều vòng (Multiple additive runs) là chìa khóa để đạt độ phủ bảo mật toàn diện."}], "actionable_steps": [{"timestamp": "Bước 1", "seconds": 0, "content": "Cài đặt bộ kỹ năng vào Coding Agent bằng lệnh: npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit --global"}, {"timestamp": "Bước 2", "seconds": 1, "content": "Mở Coding Agent tại thư mục dự án cần kiểm tra và yêu cầu: 'do a security review, output to ~/audits/my-project' để chạy toàn trình 6 giai đoạn."}, {"timestamp": "Bước 3", "seconds": 2, "content": "Rà soát tệp báo cáo đầu ra REPORT.md, FINDINGS-DETAIL.md và chạy lặp lại định kỳ sau mỗi lần cập nhật mã nguồn để tận dụng sổ cái độ phủ tích lũy (coverage-ledger.json)."}]}, "en": {"title": "[GitHub] cloudflare/security-audit-skill (★ 46,206) — Multi-phase Security Audit Skill for Coding Agents by Cloudflare", "one_liner": "Cloudflare's official coding-agent skill that orchestrates isolated sub-agents through a 6-phase security audit with deterministic coverage ledgers and adversarial verification.", "executive_summary": "cloudflare/security-audit-skill is the open-source coding-agent skill that seeded Cloudflare's fleet-wide vulnerability discovery harness. Instead of relying on single-pass LLM prompting that suffers from high false-positive rates, it orchestrates isolated sub-agents through six rigorous phases: (1) Reconnaissance of architecture and trust boundaries; (2) Coverage-led hunting tracked via coverage-ledger.json; (3) Adversarial candidate validation; (4) Schema-validated structured output (findings.json); (5) Independent record verification; and (6) Target-neutral reporting. It covers 11 specialized attack classes (memory safety, AI/LLM prompt injection, web/auth protocols, client-side DOM, supply chain, cloud/IAM, RPC/IPC, resource exhaustion, and tenant isolation) and supports additive multi-run auditing.", "chapters": [{"timestamp": "Section 1", "seconds": 0, "title": "Overview & Origin in Cloudflare's Vulnerability Discovery Harness"}, {"timestamp": "Section 2", "seconds": 1, "title": "Six-Phase Structured Security Audit Pipeline"}, {"timestamp": "Section 3", "seconds": 2, "title": "11 Specialized Attack-Class Hunting Modules"}, {"timestamp": "Section 4", "seconds": 3, "title": "5 Core Design Principles (Adversarial Validation & Impact Scoring)"}, {"timestamp": "Section 5", "seconds": 4, "title": "Installation, Usage & OS-Enforced Sandbox Requirements"}], "core_ideas": [{"chapter": "1. Overview & Purpose", "timestamp": "Section 1", "seconds": 0, "content": "Turns a tool-capable coding agent into a disciplined security auditor. Evolved from the foundation of Cloudflare's internal vulnerability discovery harness, supporting additive runs that build upon prior coverage ledgers and findings."}, {"chapter": "2. Six-Phase Audit Workflow (What it does)", "timestamp": "Section 2", "seconds": 1, "content": "(1) Reconnaissance: Maps trust boundaries and input surfaces in architecture.md and coverage-ledger.json; (2) Coverage-led hunting: Assigns isolated hunters to ledger units; (3) Candidate validation: Fresh verifiers attempt to disprove every candidate finding; (4) Structured output: Writes confirmed, needs_validation, and rejected verdicts validated by validate-findings.cjs; (5) Independent verification; (6) Generates REPORT.md and FINDINGS-DETAIL.md."}, {"chapter": "3. Eleven Specialized Attack Classes", "timestamp": "Section 3", "seconds": 2, "content": "Includes dedicated hunting prompts for Memory Safety & Binary, AI & LLM (prompt injection & tool handling), Web Protocol & Auth, Client-Side DOM/IPC, Supply Chain & CI/CD, Cloud & Deployment (IAM/IaC/Containers), Protocols/RPC/Messaging, Resource Exhaustion, Data Isolation & Tenant Lifecycle, and Desktop/Mobile Local IPC."}, {"chapter": "4. Core Design Principles", "timestamp": "Section 4", "seconds": 3, "content": "(1) Only confirm established boundary failures with full source traces; (2) Adversarial validation: the verifying agent is never the discovering agent; (3) Severity requires real impact x likelihood; (4) Defense-in-depth gaps where Layer A already blocks the attack are recorded as hardening notes, not vulnerabilities; (5) Repeated runs double total vulnerability discovery coverage."}, {"chapter": "5. Installation, Usage & Sandboxing", "timestamp": "Section 5", "seconds": 4, "content": "Installed via 'npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit --global' and triggered by asking the agent to 'security audit this codebase'. Target code execution requires an OS-enforced sandbox with disabled external networking and strict resource limits."}], "key_insights": [{"timestamp": "Principle 1", "seconds": 0, "content": "Adversarial Validation: Separating the hunter agent from a dedicated disproving verifier agent drastically eliminates hallucinated vulnerability claims."}, {"timestamp": "Principle 2", "seconds": 1, "content": "Deterministic Coverage Ledgers: Zero-dependency Node.js validators (validate-coverage-ledger.cjs and validate-findings.cjs) enforce strict schema compliance across all 6 phases."}, {"timestamp": "Principle 3", "seconds": 2, "content": "Empirical Multi-Run Gain: A single audit pass finds roughly half of total vulnerabilities; additive multi-run execution using prior ledgers uncovers the remaining deep bugs."}], "actionable_steps": [{"timestamp": "Step 1", "seconds": 0, "content": "Install globally via Skills CLI: npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit --global"}, {"timestamp": "Step 2", "seconds": 1, "content": "Launch your coding agent in the target repo and prompt: 'do a security review, output to ~/audits/my-project'."}, {"timestamp": "Step 3", "seconds": 2, "content": "Review REPORT.md, FINDINGS-DETAIL.md, and NEEDS-VALIDATION.md, then run additional passes to expand coverage-ledger.json."}]}}}];

  global.ChatVaultEngine = {
    init: autoRestoreIfEmpty,
    ingestAndSave: async function (rawInput, options = {}) {
      // Tầng 1: Kiểm tra trùng lặp tức thì trước khi tải mạng (trừ khi forceReExtract = true)
      if (!options.forceReExtract && !options.keepBoth) {
        const preDup = await findDuplicateInVault(rawInput, null);
        if (preDup && preDup.matchedItem && isEmptyOrIncompleteWebRecord(preDup.matchedItem)) {
          await deleteItemFromIDB(preDup.matchedItem.id);
        } else if (preDup && preDup.matchedItem) {
          const existing = preDup.matchedItem;
          if (!existing.i18n || !existing.i18n.vi || !isSnapshotVietnamese(existing.i18n.vi)) {
            await ensureRecordBilingual(existing);
            await putItemToIDB(existing);
            await syncBackupToNativeStorage();
          }
          const newNote = String(options.senderNote || '').trim();
          if (newNote && newNote !== 'Chia sẻ trực tiếp sang Krypto' && existing.chat_context) {
            const curNote = existing.chat_context.sender_note || '';
            if (!curNote.includes(newNote)) {
              existing.chat_context.sender_note = curNote ? `${curNote} | ${newNote}` : newNote;
              await putItemToIDB(existing);
              await syncBackupToNativeStorage();
            }
          }
          existing._duplicateInfo = {
            isDuplicate: true,
            duplicateType: preDup.duplicateType,
            similarity: preDup.similarity,
            matchedTitle: (existing.metadata && existing.metadata.title) || existing.id
          };
          return existing;
        }
      }

      const record = await ingestAnyInput(rawInput, options);
      await ensureRecordBilingual(record);

      // Tầng 2: Kiểm tra trùng lặp ngữ nghĩa sau khi bóc tách nội dung (Cosine/Bigram >= 72%)
      if (!options.forceReExtract && !options.keepBoth) {
        const postDup = await findDuplicateInVault(rawInput, record);
        if (postDup && postDup.matchedItem && postDup.matchedItem.id !== record.id) {
          const existing = postDup.matchedItem;
          existing._duplicateInfo = {
            isDuplicate: true,
            duplicateType: postDup.duplicateType,
            similarity: postDup.similarity,
            matchedTitle: (existing.metadata && existing.metadata.title) || existing.id,
            candidateRecord: record
          };
          return existing;
        }
      }

      if (options.keepBoth && record.id) {
        record.id = `${record.id}_${Date.now().toString(36).slice(-4)}`;
      }
      record._duplicateInfo = { isDuplicate: false, similarity: 0 };
      await putItemToIDB(record);
      await syncBackupToNativeStorage();
      return record;
    },
    findDuplicateInVault,
    scanAndMergeVaultDuplicates,
    computeContentSimilarity,
    reExtractRecord: async function (recordId) {
      const all = await getAllItemsFromIDB();
      const target = all.find(x => x.id === recordId);
      if (!target || !target.metadata || !target.metadata.url) return null;
      await deleteItemFromIDB(recordId);
      const fresh = await ingestAnyInput(target.metadata.url, {
        senderNote: (target.chat_context && target.chat_context.sender_note) || '',
        sharedBy: (target.chat_context && target.chat_context.shared_by) || 'User',
        chatGroup: (target.chat_context && target.chat_context.chat_group) || 'Zalo / R&D'
      });
      await ensureRecordBilingual(fresh);
      await putItemToIDB(fresh);
      await syncBackupToNativeStorage();
      return fresh;
    },
    ensureRecordBilingual,
    isEmptyOrIncompleteWebRecord,
    isPrimarilyVietnamese,
    isSnapshotVietnamese,
    getLocalizedRecord,
    saveRecord: async function (record) {
      await putItemToIDB(record);
      await syncBackupToNativeStorage();
      return record;
    },
    deleteRecord: async function (id) {
      await deleteItemFromIDB(id);
      await syncBackupToNativeStorage();
      return true;
    },
    searchVault,
    getAllItems: getAllItemsFromIDB,
    exportFullBackupJson,
    importFullBackupJson,
    exportIdeaCardMarkdown,
    exportTopicGroupMarkdown,
    removeVietnameseAccents
  };
})(typeof window !== 'undefined' ? window : globalThis);
