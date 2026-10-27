// popup.js v1.6 - Reply Fb: balasan singkat tanpa sapaan: READY + nama produk, harga, ajakan, link
document.addEventListener('DOMContentLoaded', async () => {
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  let current = null; // { data, safeTitle }

  // ---------- Pengaturan ----------
  const settings = Object.assign(
    { mode: 'local', apiKey: '', model: 'gemini-2.5-flash', url: '' },
    (await chrome.storage.local.get('settings')).settings || {}
  );
  function renderSettings() {
    $('mode').value = settings.mode;
    $('api-key').value = settings.apiKey;
    $('api-model').value = settings.model;
    $('api-url').value = settings.url;
    $('api-fields').style.display = settings.mode === 'local' ? 'none' : 'block';
    $('api-url').style.display = settings.mode === 'custom' ? 'block' : 'none';
  }
  function saveSettings() {
    settings.mode = $('mode').value;
    settings.apiKey = $('api-key').value.trim();
    settings.model = $('api-model').value.trim();
    settings.url = $('api-url').value.trim();
    chrome.storage.local.set({ settings });
    renderSettings();
  }
  ['mode', 'api-key', 'api-model', 'api-url'].forEach((id) => $(id).addEventListener('change', saveSettings));
  renderSettings();

  // ---------- Bank redaksi (tanpa sapaan) ----------
  const BANK = {
    // Baris 1: pernyataan stok + nama produk + ✅  ->  "Masih ready, Nama Produk ✅"
    openers: [
      'READY',
      'READY STOCK',
      'Ready',
      'Ready ya',
      'Stok ready',
      'Stok aman',
      'Masih ready',
      'Masih tersedia',
      'Tersedia',
      'Available',
      'Barang ready',
      'Ready stock'
    ],
    // Baris 2: harga ({p})
    priceLines: ['Rp{p}', 'Harga Rp{p}', 'Cuma Rp{p}', 'Mulai Rp{p}', 'Rp{p} aja', 'Hanya Rp{p}', 'Harga mulai Rp{p}'],
    // Baris 3: ajakan pendek, link tepat di bawahnya
    ctaLink: [
      'Cek di sini 👇',
      'Silakan cek 👇',
      'Order di sini 👇',
      'Langsung order 👇',
      'Link 👇',
      'Cek link 👇',
      'Bisa langsung order 👇',
      'Checkout di sini 👇',
      'Detail di sini 👇',
      'Pesan di sini 👇'
    ],
    ctaNoLink: ['Link ada di komentar ya', 'Link di komentar ya', 'Cek link di komentar', 'Link order di komentar']
  };

  const rnd = (n) => Math.floor(Math.random() * n);
  const fill = (s, v) => s.replace(/\{(\w)\}/g, (_, k) => v[k] ?? '');

  // Pilih item acak tapi tidak sama dengan pilihan terakhir (disimpan di storage)
  async function makePicker() {
    const hist = (await chrome.storage.local.get('pickHistory')).pickHistory || {};
    const pick = (key, arr) => {
      if (arr.length === 1) return arr[0];
      let i; do { i = rnd(arr.length); } while (i === hist[key]);
      hist[key] = i;
      return arr[i];
    };
    return { pick, save: () => chrome.storage.local.set({ pickHistory: hist }) };
  }

  function shortName(title) {
    const t = title.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[^\w\s\-./]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.split(' ').slice(0, 6).join(' ') || title;
  }

  // Baris 1, mis. "Masih ready, Nama Produk ✅"
  function buildFirstLine(data, pick) {
    const name = shortName(data.title);
    return pick('opener', BANK.openers) + (name ? ', ' + name : '') + ' ✅';
  }

  // Baris 2, mis. "Cuma Rp77.001"
  function buildPriceLine(data, pick) {
    if (!data.price || data.price === '0') return '';
    return fill(pick('price', BANK.priceLines), { p: data.price });
  }

  // ---------- Generator LOKAL ----------
  async function generateLocal(data, link) {
    const { pick, save } = await makePicker();
    const lines = [buildFirstLine(data, pick)];
    const priceLine = buildPriceLine(data, pick);
    if (priceLine) lines.push(priceLine);
    lines.push(link ? pick('cta', BANK.ctaLink) : pick('ctaNo', BANK.ctaNoLink));
    if (link) lines.push(link);
    await save();
    return lines.join('\n');
  }

  // ---------- Generator AI (opsional) ----------
  function buildPrompt(data) {
    return `Buat balasan komentar Facebook Group berbahasa Indonesia untuk produk ini, sangat singkat.
Produk: ${shortName(data.title)}
Harga: Rp ${data.price}
Contoh pembuka (variasikan, jangan ditiru persis): ${BANK.openers[rnd(BANK.openers.length)]}, ${shortName(data.title)} ✅
Kode variasi: ${Math.random().toString(36).slice(2, 8)}

ATURAN:
1. Tepat 3 baris pendek, tanpa baris kosong.
2. TANPA sapaan (jangan pakai kak, gan, sis, bun, om, bang, dsb) dan tanpa basa-basi.
3. Baris 1: kata stok seperti READY / Stok ready / Masih tersedia, lalu nama produk, diakhiri emoji ✅. Contoh: Masih ready, ${shortName(data.title)} ✅
4. Baris 2: harga saja. Contoh: Cuma Rp${data.price}. JANGAN tulis rating atau jumlah terjual.
5. Baris 3: ajakan sangat pendek yang diakhiri emoji 👇.
6. JANGAN masukkan link. Jangan mengarang spesifikasi. Tanpa hashtag.
7. Keluarkan hanya balasannya, tanpa penjelasan.`;
  }

  async function callGemini(prompt) {
    const model = settings.model || 'gemini-2.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0, maxOutputTokens: 512 } })
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    return j.candidates[0].content.parts.map((p) => p.text).join('');
  }

  async function callCustom(prompt) {
    const res = await fetch(settings.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: prompt }], temperature: 0.9, max_tokens: 512 })
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    return j.choices[0].message.content;
  }

  async function generateCaption(data, link) {
    if (settings.mode !== 'local' && settings.apiKey) {
      try {
        const prompt = buildPrompt(data);
        let text = settings.mode === 'gemini' ? await callGemini(prompt) : await callCustom(prompt);
        text = text.replace(/^"|"$/g, '').trim();
        text += link ? `\n${link}` : '\nLink ada di komentar ya';
        return { text, note: 'AI' };
      } catch (e) {
        const text = await generateLocal(data, link);
        return { text, note: `Lokal (AI gagal: ${e.message})` };
      }
    }
    return { text: await generateLocal(data, link), note: 'Lokal' };
  }

  // ---------- Cek URL benar-benar gambar ----------
  async function isRealImage(url) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      return r.ok && (r.headers.get('content-type') || '').toLowerCase().startsWith('image/');
    } catch (e) {
      return false;
    }
  }

  // ---------- Simpan balasan ke .txt ----------
  function saveCaptionFile(text, safeTitle) {
    const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
    chrome.downloads.download({ url, filename: `Database_Shopee/${safeTitle}_balasan.txt`, saveAs: false, conflictAction: 'uniquify' });
  }

  async function runCaption(saveFile) {
    const link = $('affiliate-link').value.trim();
    const { data, safeTitle } = current;
    statusEl.innerText = '⏳ Membuat balasan...';
    const { text, note } = await generateCaption(data, link);
    $('caption-result').value = text;
    statusEl.innerText = `✅ Balasan dibuat (${note}).`;
    if (saveFile) saveCaptionFile(text, safeTitle);
  }

  // ---------- Tombol ----------
  $('btn-scrape').addEventListener('click', () => {
    statusEl.innerText = '🔎 Mengambil data produk...';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'scrapeData' }, async (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          statusEl.innerText = '❌ Gagal ambil data. Pastikan di halaman produk Shopee & refresh halaman!';
          return;
        }
        const data = response.data;
        const safeTitle = data.title.replace(/[^a-zA-Z0-9\s]/g, '').substring(0, 40).trim() || 'produk';
        current = { data, safeTitle };

        $('res-title').innerText = data.title;
        $('res-price').innerText = data.price;
        $('result-section').style.display = 'block';

        // Hanya download URL yang benar-benar gambar (lewati halaman HTML)
        const validImages = [];
        for (const url of data.images) {
          if (await isRealImage(url)) validImages.push(url);
        }
        validImages.forEach((url, i) => {
          setTimeout(() => chrome.downloads.download({
            url, filename: `Database_Shopee/${safeTitle}_gambar${i + 1}.jpg`, saveAs: false, conflictAction: 'uniquify'
          }), i * 1000);
        });

        await runCaption(true);
      });
    });
  });

  $('btn-regen').addEventListener('click', () => { if (current) runCaption(false); });

  $('btn-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('caption-result').value);
    $('btn-copy').innerText = '✅ Tersalin!';
    setTimeout(() => { $('btn-copy').innerText = '📋 Copy Balasan'; }, 2000);
  });
});
