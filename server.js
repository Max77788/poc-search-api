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
const CONCURRENCY = 5; 
const PAGE_TIMEOUT = 12000;
// Стоп-слова: якщо це є в назві - викидаємо відразу
const BLACKLIST = [
    'cremation', 'funeral', 'burial', 'service', 'consultation', 'booking', 
    'course', 'workshop', 'seminar', 'hire', 'rental', 'deposit', 'donation',
    'membership', 'subscription', 'digital', 'pdf', 'download', 'fee'
];

const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';
let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`🚀 PRECISION SEARCH: ${AI_PROVIDER.toUpperCase()}`);

// ============ UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Precision Product Search</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f8fafc; padding: 20px; max-width: 1200px; margin: 0 auto; }
        .search-box { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 14px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 16px; outline: none; transition: 0.2s; }
        input:focus { border-color: #3b82f6; }
        button { padding: 14px 32px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
        button:hover { background: #2563eb; }
        button:disabled { background: #94a3b8; }
        
        .status-bar { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; color: #64748b; font-weight: 500; }
        .progress-track { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-bottom: 24px; }
        .progress-fill { height: 100%; background: #3b82f6; width: 0%; transition: width 0.3s; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; border: 1px solid #f1f5f9; display: flex; flex-direction: column; transition: transform 0.2s; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .img-wrap { height: 200px; padding: 15px; display: flex; align-items: center; justify-content: center; background: #fff; border-bottom: 1px solid #f8fafc; position: relative; }
        .badge { position: absolute; top: 10px; left: 10px; font-size: 10px; background: #f1f5f9; padding: 3px 6px; border-radius: 4px; color: #64748b; font-weight: bold; text-transform: uppercase; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .info { padding: 16px; flex: 1; display: flex; flex-direction: column; }
        .title { font-size: 14px; margin-bottom: 8px; font-weight: 600; color: #1e293b; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .price { font-size: 18px; font-weight: 700; color: #15803d; margin-top: auto; }
        .btn-link { margin-top: 12px; text-align: center; background: #f8fafc; color: #334155; text-decoration: none; padding: 10px; border-radius: 6px; font-size: 13px; font-weight: 600; transition: 0.2s; }
        .btn-link:hover { background: #e2e8f0; }
    </style>
</head>
<body>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="What product are you looking for?" onkeypress="if(event.key==='Enter') run()">
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
                                            <div class="img-wrap">
                                                <div class="badge">\${domain}</div>
                                                <img src="\${p.imageUrl}" onerror="this.src='https://placehold.co/400?text=No+Image'">
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
                                    status.textContent = \`Done. Found \${count} strict matches.\`;
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
        
        // 1. Google Search (SMART QUERY)
        // Ми відразу фільтруємо сміття на рівні Google
        const urls = await googleSearch(keyword);
        
        if (urls.length === 0) {
            send('done', { total: 0 });
            return res.end();
        }

        // Обробляємо трохи більше сайтів (12), щоб компенсувати жорстку фільтрацію
        const topUrls = urls.slice(0, 12);
        
        // 2. Launch
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu', '--blink-settings=imagesEnabled=false']
        });

        send('progress', { msg: `Scanning ${topUrls.length} sites...`, done: 0, total: topUrls.length });

        // 3. Queue
        let completed = 0;
        const queue = [...topUrls];
        
        const worker = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                try {
                    await processSite(browser, url, keyword, send);
                } catch (e) {
                    // console.log(e);
                } finally {
                    completed++;
                    send('progress', { msg: `Scanning...`, done: completed, total: topUrls.length });
                }
            }
        };

        const workers = Array(CONCURRENCY).fill(null).map(() => worker());
        await Promise.all(workers);

        send('done', {});

    } catch (e) {
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
        
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['image', 'font', 'media', 'stylesheet', 'other'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        await page.setUserAgent(new UserAgent({ deviceCategory: 'desktop' }).toString());
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        const html = await page.content();
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const baseUrl = new URL(url).origin;
        let products = [];
        let source = 'AI';

        // --- PHASE 1: JSON-LD (Strict Check) ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const data = JSON.parse($(el).html());
                const items = Array.isArray(data) ? data : [data];
                items.forEach(item => {
                    const type = item['@type'];
                    // Беремо тільки Product, ігноруємо Article, Breadcrumb, Organization
                    if (type === 'Product' || type === 'ItemPage') {
                        extractFromJson(item, products, baseUrl, keyword);
                    }
                    // Часто продукти всередині @graph
                    if (item['@graph']) {
                        item['@graph'].forEach(g => {
                            if (g['@type'] === 'Product') extractFromJson(g, products, baseUrl, keyword);
                        });
                    }
                });
            } catch (e) {}
        });

        // --- PHASE 2: AI Fallback (If JSON failed or found nothing relevant) ---
        if (products.length === 0) {
            // Aggressive Cleanup
            $('script, style, noscript, svg, iframe, header, footer, nav, .menu, .sidebar, .popup, .related, .upsell, .blog, .article').remove();
            
            const body = $('body').html() || '';
            const truncated = body.replace(/\s+/g, ' ').substring(0, 45000);

            if (truncated.length > 500) {
                products = await parseWithAI(truncated, url, keyword);
            }
        }

        // --- PHASE 3: FINAL FILTERING (The "Cremation" Killer) ---
        const unique = new Map();
        
        products.forEach(p => {
            // 1. Check Data Quality
            if (!p.title || !p.imageUrl || !p.productUrl) return;
            if (p.title.length < 3) return;
            
            // 2. BLACKLIST CHECK (Critical)
            const titleLower = p.title.toLowerCase();
            const hasForbiddenWord = BLACKLIST.some(badWord => titleLower.includes(badWord));
            if (hasForbiddenWord) return; // Skip "Cremation", "Service", etc.

            // 3. RELEVANCE CHECK (Loose match)
            // Дозволяємо fuzzy match, але хоча б одне слово з запиту має бути в назві
            // (Крім коротких слів типу 'for', 'the', 'box')
            const kWords = keyword.toLowerCase().split(' ').filter(w => w.length > 2);
            const matches = kWords.some(w => titleLower.includes(w));
            
            if (!matches) return; // Якщо шукаємо "iphone", а знайшли "samsung" - викидаємо (спірно, але безпечно)

            // 4. PRICE CHECK
            if (!p.price) p.price = 'Check Price';

            if (!unique.has(p.productUrl)) {
                unique.set(p.productUrl, true);
                send('product', { p, method: source });
            }
        });

    } catch (e) {
        if(page) await page.close().catch(() => {});
    }
}

function extractFromJson(item, list, baseUrl, keyword) {
    if (!item.name) return;
    
    // Перевірка на стоп-слова ще на етапі JSON
    const nameLower = item.name.toLowerCase();
    if (BLACKLIST.some(w => nameLower.includes(w))) return;

    let price = null;
    if (item.offers) {
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        if (offer.price) price = `$${offer.price} ${offer.priceCurrency || 'AUD'}`;
        else if (offer.lowPrice) price = `$${offer.lowPrice} ${offer.priceCurrency || 'AUD'}`;
    }

    let image = item.image;
    if (Array.isArray(image)) image = image[0];
    if (typeof image === 'object') image = image.url;

    if (image) {
        list.push({
            title: item.name,
            price: price,
            imageUrl: normalizeUrl(image, baseUrl),
            productUrl: normalizeUrl(item.url || '', baseUrl) || baseUrl
        });
    }
}

async function parseWithAI(html, url, keyword) {
    const prompt = `
    Analyze HTML from "${url}". Extract PHYSICAL PRODUCTS matching: "${keyword}".

    STRICT RULES:
    1. EXCLUDE SERVICES: No "cremation", "consultation", "booking", "rental", "repair".
    2. EXCLUDE COURSES: No "workshop", "class", "training".
    3. EXCLUDE PARTS: No "batteries" or "cases" if user asked for the device itself.
    4. MUST BE A PRODUCT GRID: Ignore blog posts, categories list.
    
    Output JSON: [{"title":"...","price":"$0.00","imageUrl":"...","productUrl":"..."}]
    
    HTML: ${html}
    `;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0, max_tokens: 3000
            });
            content = completion.choices[0].message.content;
        } else {
            const resp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] }
            );
            content = resp.data.candidates[0].content.parts[0].text;
        }
        
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
        }));
    } catch { return []; }
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
    
    // МАГІЯ ТУТ:
    // 1. "shop" OR "buy" -> шукаємо комерцію
    // 2. -cremation -service -funeral -> відразу прибираємо сміття
    // 3. site:.au -> тільки Австралія
    const negativeKeywords = '-cremation -funeral -service -hire -rental -booking -course -class -repair -parts';
    const q = encodeURIComponent(`${keyword} (shop OR buy) ${negativeKeywords} site:.au`);
    
    try {
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10`);
        return (res.data.items || [])
            .map(i => i.link)
            .filter(l => !l.includes('facebook') && !l.includes('youtube') && !l.includes('pinterest'));
    } catch { return []; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server: ${PORT}`));
