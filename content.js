// content.js v1.4 - harga (JSON-LD dulu, regex fallback) + rating, terjual, estimasi kirim, jaminan Shopee
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrapeData") {
    let result = { title: "", category: "", price: "", images: [], rating: "", sold: "", shipping: "", guarantee: "" };

    function cleanShopeeTitle(raw) {
      if (!raw) return "";
      let clean = raw.split('|')[0];
      clean = clean.replace(/^Jual\s+/i, '').trim();
      return clean.replace(/\s+/g, ' ').trim();
    }

    // Konversi string harga ke angka. Mendukung "77001.00" (JSON-LD) dan "77.001" / "77.001,50" (format Indonesia)
    function parsePrice(v) {
      if (v === null || v === undefined || v === "") return 0;
      if (typeof v === 'number') return Math.round(v);
      let str = String(v).replace(/[^\d.,]/g, '');
      if (!str) return 0;
      if (/^\d+\.\d{1,2}$/.test(str)) return Math.round(parseFloat(str));   // desimal ala JSON-LD
      str = str.replace(/\./g, '').replace(/,\d{1,2}$/, '').replace(/,/g, ''); // format Indonesia
      return parseInt(str, 10) || 0;
    }

    try {
      result.title = cleanShopeeTitle(document.title);
      if (!result.title || result.title.length < 5) {
        result.title = cleanShopeeTitle(document.querySelector('meta[property="og:title"]')?.content);
      }

      // JSON-LD (cek semua blok script)
      document.querySelectorAll('script[type="application/ld+json"]').forEach(node => {
        try {
          const parsed = JSON.parse(node.textContent);
          const product = Array.isArray(parsed) ? parsed[0] : parsed;
          if (!product) return;
          if (!result.category && product.category) result.category = product.category;
          if (!result.rating && product.aggregateRating && product.aggregateRating.ratingValue) result.rating = String(product.aggregateRating.ratingValue);
          if (!result.price && product.offers) {
            const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
            const nums = offers.map(o => parsePrice(o.lowPrice ?? o.price)).filter(n => n > 0);
            if (nums.length) result.price = Math.min(...nums);
          }
        } catch (e) {}
      });

      // Fallback harga dari teks halaman: rentang "Rp77.001 - Rp97.501" -> ambil terendah
      if (!result.price) {
        const text = document.body.innerText;
        const range = text.match(/Rp\.?\s?([\d.,]+)\s*[-–—]\s*(?:Rp\.?\s?)?([\d.,]+)/);
        if (range) {
          const nums = [parsePrice(range[1]), parsePrice(range[2])].filter(n => n > 0);
          if (nums.length) result.price = Math.min(...nums);
        } else {
          const m = text.match(/Rp\.?\s?([\d.,]+)/);
          if (m) result.price = parsePrice(m[1]);
        }
      }
      result.price = result.price
        ? new Intl.NumberFormat('id-ID').format(parsePrice(result.price))
        : "0";

      // ---- Data tambahan: rating, terjual, estimasi kirim, jaminan Shopee ----
      // Class acak Shopee dipakai sebagai pilihan pertama, teks label tetap sebagai cadangan
      const bodyText = document.body.innerText;
      const pick = (sels, ok) => {
        for (const sel of sels) {
          for (const el of document.querySelectorAll(sel)) {
            const t = (el.textContent || '').trim();
            if (t && (!ok || ok.test(t))) return t;
          }
        }
        return "";
      };

      // Rating
      if (!result.rating) {
        result.rating = pick(['div.FllsTu'], /^\d(?:[.,]\d)?$/)
          || (bodyText.match(/(\d[.,]\d)\s+[\d.,]+\s?(?:RB|JT)?\+?\s+Penilaian/i) || [])[1] || "";
      }
      const r = parseFloat(String(result.rating).replace(',', '.'));
      result.rating = r > 0 && r <= 5 ? String(Math.round(r * 10) / 10) : "";

      // Terjual (mis. "1RB+")
      result.sold = pick(['span.PfWbfd'], /^\d[\d.,]*\s?(?:RB|JT)?\+?$/i)
        || (bodyText.match(/(\d[\d.,]*\s?(?:RB|JT)?\+?)\s+Terjual/i) || [])[1] || "";

      // Estimasi pengiriman (mis. "25 - 27 Okt")
      const DATE = '\\d{1,2}(?:\\s?-\\s?\\d{1,2})?\\s(?:Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)[a-z]*';
      result.shipping = (
        pick(['span[style*="38, 170, 153"]'], new RegExp('^' + DATE + '$', 'i'))
        || (bodyText.match(new RegExp('Pengiriman[\\s\\S]{0,80}?(' + DATE + ')', 'i')) || [])[1]
        || ""
      ).replace(/\s*-\s*/, '–');

      // Jaminan Shopee (mis. "Bebas Pengembalian • Proteksi Kerusakan +")
      result.guarantee = (
        pick(['div.febVZd'], /Pengembalian|Proteksi|Garansi/i)
        || (bodyText.match(/Bebas Pengembalian[^\n]*/) || [])[0]
        || ""
      ).slice(0, 120);

      // Gambar
      const imageSet = new Set();
      document.querySelectorAll('img[data-src*="susercontent"], img[src*="susercontent"]').forEach(img => {
        let src = (img.dataset.src || img.src || '').split('?')[0];
        if (src.startsWith('http') && !/\.(svg|html?|gif)$/i.test(src)) imageSet.add(src);
      });
      if (imageSet.size === 0) {
        document.querySelectorAll('img').forEach(img => {
          if (img.naturalWidth > 200 && img.src.startsWith('http')) imageSet.add(img.src.split('?')[0]);
        });
      }
      result.images = Array.from(imageSet).slice(0, 5);

      sendResponse({ success: true, data: result });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  return true;
});
