require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const UserAgent = require('user-agents');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// === CONFIG ===
const CONCURRENCY = 3; // ЗМЕНШЕНО з 5 до 3 для production
const PAGE_TIMEOUT = 20000; // ЗБІЛЬШЕНО з 12s до 20s
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

// Стоп-слова (абсолютне табу)
const BLACKLIST = [
    'cremation', 'funeral', 'burial', 'service', 'consultation', 'booking', 
    'course', 'workshop', 'seminar', 'hire', 'rental', 'deposit', 'donation',
    'login', 'account', 'cart', 'checkout', 'register', 'subscription'
];

// ВИПРАВЛЕНО: видалено "custom" та інші важливі слова
const STOP_WORDS = ['the', 'and', 'for', 'with', 'australia', 'best', 'top'];

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`🚀 SMART SEARCH: ${AI_PROVIDER.toUpperCase()} | Precision Level: HIGH`);

// ============ UI (без змін) ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smart Search Australia</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f1f5f9; padding: 20px; max-width: 1200px; margin: 0 auto; }
        .search-box { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 14px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 16px; outline: none; transition: 0.2s; }
        input:focus { border-color: #0ea5e9; }
        button { padding: 14px 32px; background: #0ea5e9; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
        button:hover { background: #0284c7; }
        button:disabled { background: #cbd5e1; }
        
        .status-bar { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; color: #64748b; font-weight: 500; }
        .progress-track { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-bottom: 24px; }
        .progress-fill { height: 100%; background: #0ea5e9; width: 0%; transition: width 0.3s; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; display: flex; flex-direction: column; transition: transform 0.2s; position: relative; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .img-wrap { height: 200px; padding: 15px; display: flex; align-items: center; justify-content: center; background: #fff; border-bottom: 1px solid #f1f5f9; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .info { padding: 16px; flex: 1; display: flex; flex-direction: column; }
        .badge { position: absolute; top: 10px; right: 10px; font-size: 10px; background: rgba(255,255,255,0.9); padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; color: #64748b; font-weight: bold; }
        .title { font-size: 14px; margin-bottom: 8px; font-weight: 600; color: #0f172a; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .price { font-size: 18px; font-weight: 700; color: #16a34a; margin-top: auto; }
        .btn-link { margin-top: 12px; text-align: center; background: #f8fafc; color: #334155; text-decoration: none; padding: 10px; border-radius: 6px; font-size: 13px; font-weight: 600; transition: 0.2s; border: 1px solid #e2e8f0; }
        .btn-link:hover { background: #e2e8f0; }
    </style>
</head>
<body>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Enter specific product name..." onkeypress="if(event.key==='Enter') run()">
        <button onclick="run()" id="btn">Search</button>
    </div>
    
    <div class="status-bar"><span id="status">Ready</span><span id="counter">0 products</span></div>
    <div class="progress-track"><div class="progress-fill" id="progress"></div></div>
    <div id="results" class="grid"></div>

    <script>
        async function run() {
            const keyword = document.getElementById('keyword').value;
            if(!keyword) return;
            
            const btn = document.getElementById('btn');
            const status = document.getElementById('status');
            const counter = document.getElementById('counter');
            const progress = document.getElementById('progress');
            const results = document.getElementById('results');
            
            btn.disabled = true;
            results.innerHTML = '';
            progress.style.width = '5%';
            status.textContent = 'Searching...';
            
            let count = 0;

            try {
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ keyword })
                });
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    
                    const chunk = decoder.decode(value, {stream: true});
                    const lines = chunk.split('\\n');
                    
                    for(const line of lines) {
                        if(line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                
                                if(data.type === 'progress') {
                                    status.textContent = data.msg;
                                    if(data.total > 0) progress.style.width = Math.round((data.done / data.total) * 100) + '%';
                                }
                                
                                if(data.type === 'product') {
                                    count++;
                                    counter.textContent = count + ' products';
                                    const p = data.p;
                                    const domain = new URL(p.productUrl).hostname.replace('www.','');
                                    
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="badge">\${domain}</div>
                                            <div class="img-wrap">
                                                <img src="\${p.imageUrl}" loading="lazy" onerror="this.src='https://placehold.co/400?text=No+Image'">
                                            </div>
                                            <div class="info">
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="price">\${p.price}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="btn-link">View Product</a>
                                            </div>
                                        </div>
                                    \`);
                                }
                                
                                if(data.type === 'done') {
                                    status.textContent = \`Done. Found \${count} high-match products.\`;
                                    progress.style.width = '100%';
                                    btn.disabled = false;
                                }
                            } catch(e) {}
                        }
                    }
                }
            } catch(e) {
                status.textContent = 'Error: ' + e.message;
                btn.disabled = false;
            }
        }
    </script>
</body>
</html>
    `);
});

// ============ API ============
app.post('/api/search', async (req, res) => {
    const { keyword } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

    let browser = null;
    try {
        send('progress', { msg: 'Google Search...', done: 0, total: 10 });
        
        // 1. Google Search
        const urls = await googleSearch(keyword);
        
        if (urls.length === 0) {
            send('done', { total: 0 });
            return res.end();
        }

        // Беремо топ 10-12 сайтів
        const topUrls = urls.slice(0, 12);
        
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-accelerated-2d-canvas', 
                '--disable-gpu'
                // ВИДАЛЕНО: --blink-settings=imagesEnabled=false (деякі сайти потребують images для завантаження)
            ]
        });

        send('progress', { msg: `Scanning ${topUrls.length} sites...`, done: 0, total: topUrls.length });

        // 2. Queue Logic
        let completed = 0;
        const queue = [...topUrls];
        
        const worker = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                try {
                    await processSite(browser, url, keyword, send);
                } catch (e) {
                    console.error(`Error processing ${url}:`, e.message);
                } finally {
                    completed++;
                    send('progress', { msg: `Processing...`, done: completed, total: topUrls.length });
                }
            }
        };

        const workers = Array(CONCURRENCY).fill(null).map(() => worker());
        await Promise.all(workers);

        send('done', {});

    } catch (e) {
        console.error('Search error:', e);
        send('progress', { msg: 'Error: ' + e.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
        res.end();
    }
});

async function processSite(browser, url, keyword, send) {
    let page = null;
    try {
        page = await browser.newPage();
        
        // ВИПРАВЛЕНО: дозволяємо images (деякі сайти не працюють без них)
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['font', 'media', 'other'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        await page.setUserAgent(new UserAgent({ deviceCategory: 'desktop' }).toString());
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // Wait for JS
        await new Promise(r => setTimeout(r, 2000)); // ЗБІЛЬШЕНО з 1.5s до 2s

        const html = await page.content();
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const baseUrl = new URL(url).origin;
        let products = [];

        // --- PHASE 1: JSON-LD ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const txt = $(el).html();
                if(!txt) return;
                const data = JSON.parse(txt);
                const items = Array.isArray(data) ? data : [data];
                items.forEach(item => {
                    if (item['@type'] === 'Product' || item['@type'] === 'ItemPage') {
                        extractFromJson(item, products, baseUrl);
                    }
                    if (item['@graph']) {
                        item['@graph'].forEach(g => {
                            if (g['@type'] === 'Product') extractFromJson(g, products, baseUrl);
                        });
                    }
                });
            } catch (e) {}
        });

        // --- PHASE 2: AI FALLBACK ---
        // ВИПРАВЛЕНО: викликаємо AI якщо < 2 products (було < 3)
        if (products.length < 2) {
            $('script, style, noscript, svg, iframe, header, footer, nav, .menu, .sidebar, .popup, .hidden, [aria-hidden="true"]').remove();
            
            const body = $('body').html() || '';
            const truncated = body.replace(/\s+/g, ' ').substring(0, 100000); // ЗБІЛЬШЕНО до 100k

            if (truncated.length > 500) {
                const aiProducts = await parseWithAI(truncated, url, keyword);
                products = [...products, ...aiProducts];
            }
        }

        // --- PHASE 3: SMART FILTER (ВИПРАВЛЕНИЙ) ---
        const unique = new Map();
        
        products.forEach(p => {
            if (!p.title || !p.imageUrl || !p.productUrl) return;
            if (p.title.length < 3) return;
            
            // 1. Blacklist Check
            const titleLower = p.title.toLowerCase();
            if (BLACKLIST.some(bad => titleLower.includes(bad))) return;

            // 2. ПОКРАЩЕНИЙ KEYWORD MATCHING
            const queryTokens = keyword.toLowerCase()
                .replace(/[^a-z0-9 ]/g, '')
                .split(' ')
                .filter(t => t.length > 2 && !STOP_WORDS.includes(t));

            // НОВА ЛОГІКА: більш м'який підхід
            if (queryTokens.length === 0) {
                // Занадто короткий запит - пропускаємо все
                // skip smart filter
            } else if (queryTokens.length === 1) {
                // Один токен - вимагаємо щоб він був в title
                const token = queryTokens[0];
                if (!titleLower.includes(token)) {
                    // Перевіряємо синоніми
                    const synonyms = getSynonyms(token);
                    if (!synonyms.some(syn => titleLower.includes(syn))) {
                        return; // Не пройшов
                    }
                }
            } else {
                // Декілька токенів - вимагаємо хоча б 33% збіг (було 50%)
                let matchCount = 0;
                queryTokens.forEach(token => {
                    if (titleLower.includes(token)) matchCount++;
                    else {
                        // Перевіряємо синоніми
                        const synonyms = getSynonyms(token);
                        if (synonyms.some(syn => titleLower.includes(syn))) matchCount++;
                    }
                });

                const threshold = 0.33; // ЗМЕНШЕНО з 0.5 до 0.33
                if ((matchCount / queryTokens.length) < threshold) return;
            }

            // 3. Normalize Price
            if (!p.price) p.price = 'Check Site';
            
            if (!unique.has(p.productUrl)) {
                unique.set(p.productUrl, true);
                send('product', { p });
            }
        });

    } catch (e) {
        console.error(`processSite error for ${url}:`, e.message);
        if(page) await page.close().catch(() => {});
    }
}

// НОВА ФУНКЦІЯ: синоніми для кращого matching
function getSynonyms(word) {
    const synonymMap = {
        'sticker': ['decal', 'label', 'adhesive'],
        'decal': ['sticker', 'label'],
        'label': ['sticker', 'tag'],
        'card': ['cards'],
        'banner': ['banners', 'sign', 'signage'],
        'print': ['printing', 'printed'],
        'custom': ['personalised', 'personalized', 'bespoke'],
        'vinyl': ['pvc'],
        'business': ['corporate', 'company']
    };
    return synonymMap[word] || [];
}

function extractFromJson(item, list, baseUrl) {
    if (!item.name) return;
    
    let price = null;
    let currency = 'AUD';
    
    if (item.offers) {
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        if (offer.price) price = offer.price;
        if (offer.priceCurrency) currency = offer.priceCurrency;
        if (!price && offer.lowPrice) price = offer.lowPrice;
    }
    
    let image = item.image;
    if (Array.isArray(image)) image = image[0];
    if (typeof image === 'object') image = image.url;

    if (image) {
        list.push({
            title: item.name,
            price: price ? `$${price} ${currency}` : null,
            imageUrl: normalizeUrl(image, baseUrl),
            productUrl: normalizeUrl(item.url || '', baseUrl) || baseUrl
        });
    }
}

async function parseWithAI(html, url, keyword) {
    // ПОКРАЩЕНИЙ ПРОМПТ
    const prompt = `
You are a product extraction AI. Extract ALL e-commerce products from this HTML that match the keyword "${keyword}".

STRICT RULES:
1. ONLY products for sale (not services, courses, consultations)
2. ONLY items semantically related to "${keyword}"
3. Must have: title, image URL, product URL
4. Price: Extract if visible (e.g. "$19.95" or "$19.95 AUD"). If missing, use null
5. Image URL: MUST be absolute URL (starts with http:// or https://)
6. Product URL: MUST be absolute URL

Return ONLY valid JSON array (no markdown, no explanation):
[
  {
    "title": "exact product name",
    "price": "$19.95 AUD" or null,
    "imageUrl": "https://...",
    "productUrl": "https://..."
  }
]

If no products found, return empty array: []

HTML:
${html}
    `.trim();

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 4000 // ЗБІЛЬШЕНО з 3000
            });
            content = completion.choices[0].message.content;
        } else {
            const resp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { 
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0,
                        maxOutputTokens: 4000
                    }
                }
            );
            content = resp.data.candidates[0].content.parts[0].text;
        }
        
        // Clean JSON
        const json = content.replace(/```json|```/gi, '').trim();
        const start = json.indexOf('[');
        const end = json.lastIndexOf(']');
        if (start === -1) return [];
        
        const raw = JSON.parse(json.substring(start, end + 1));
        const baseUrl = new URL(url).origin;
        
        return raw.map(p => ({
            title: p.title,
            price: p.price,
            imageUrl: normalizeUrl(p.imageUrl, baseUrl),
            productUrl: normalizeUrl(p.productUrl, baseUrl)
        })).filter(p => p.imageUrl && p.productUrl); // Фільтруємо invalid URLs
        
    } catch (e) {
        console.error('AI parsing error:', e.message);
        return [];
    }
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr || urlStr.startsWith('data:')) return null;
    try {
        if (urlStr.startsWith('//')) return 'https:' + urlStr;
        if (urlStr.startsWith('/')) return new URL(urlStr, baseUrl).href;
        if (!urlStr.startsWith('http')) return new URL(urlStr, baseUrl).href;
        return urlStr;
    } catch { return null; }
}

async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    
    // СПРОЩЕНИЙ QUERY (видалено (shop OR buy))
    const q = encodeURIComponent(`${keyword} -cremation -funeral -hire -course -pinterest -facebook site:.au`);
    
    try {
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10`);
        return (res.data.items || [])
            .map(i => i.link)
            .filter(l => !l.includes('facebook') && !l.includes('youtube') && !l.includes('pinterest'));
    } catch (e) {
        console.error('Google search error:', e.message);
        return [];
    }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
