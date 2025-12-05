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

// === CONFIGURATION ===
const CONCURRENCY = 5; // Кількість одночасних вкладок
const PAGE_TIMEOUT = 12000; // 12 секунд на сайт. Не встиг - пропускаємо.
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`AI Provider: ${AI_PROVIDER.toUpperCase()} | Threads: ${CONCURRENCY}`);

// ============ HTML UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Search</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8f9fa; padding: 20px; max-width: 1200px; margin: 0 auto; color: #333; }
        .search-container { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e1e4e8; margin-bottom: 20px; }
        .input-group { display: flex; gap: 10px; }
        input { flex: 1; padding: 12px; border: 1px solid #ced4da; border-radius: 4px; font-size: 16px; }
        button { padding: 12px 24px; background: #007bff; color: white; border: none; border-radius: 4px; font-weight: 500; cursor: pointer; }
        button:disabled { background: #6c757d; }
        
        .status-bar { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; color: #666; }
        .progress-container { height: 4px; background: #e9ecef; width: 100%; margin-bottom: 20px; }
        .progress-bar { height: 100%; background: #007bff; width: 0%; transition: width 0.3s; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; }
        .card { background: white; border: 1px solid #e1e4e8; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; transition: box-shadow 0.2s; }
        .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .img-wrap { height: 180px; padding: 10px; display: flex; align-items: center; justify-content: center; background: #fff; border-bottom: 1px solid #f0f0f0; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .info { padding: 15px; flex: 1; display: flex; flex-direction: column; }
        .site-name { font-size: 11px; text-transform: uppercase; color: #888; font-weight: 600; margin-bottom: 5px; }
        .title { font-size: 14px; margin-bottom: 10px; line-height: 1.4; color: #333; height: 40px; overflow: hidden; }
        .price { font-size: 18px; font-weight: 700; color: #28a745; margin-top: auto; }
        .link { margin-top: 12px; text-align: center; background: #f8f9fa; color: #333; text-decoration: none; padding: 8px; border-radius: 4px; font-size: 13px; border: 1px solid #ddd; }
        .link:hover { background: #e2e6ea; }
    </style>
</head>
<body>
    <div class="search-container">
        <h1>API Search</h1>
        <div class="input-group">
            <input type="text" id="keyword" placeholder="Enter keyword..." onkeypress="if(event.key==='Enter') run()">
            <button onclick="run()" id="btn">Search</button>
        </div>
    </div>
    
    <div class="status-bar">
        <span id="status">Idle</span>
        <span id="stats"></span>
    </div>
    <div class="progress-container"><div class="progress-bar" id="progress"></div></div>
    <div id="results" class="grid"></div>

    <script>
        async function run() {
            const keyword = document.getElementById('keyword').value;
            if(!keyword) return;
            
            const btn = document.getElementById('btn');
            const status = document.getElementById('status');
            const stats = document.getElementById('stats');
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
                                    if(data.total > 0) {
                                        const pct = Math.round((data.done / data.total) * 100);
                                        progress.style.width = pct + '%';
                                        stats.textContent = data.done + '/' + data.total;
                                    }
                                }
                                
                                if(data.type === 'product') {
                                    count++;
                                    const p = data.p;
                                    const domain = new URL(p.productUrl).hostname.replace('www.','');
                                    const priceDisplay = p.price ? p.price : 'Check Price';
                                    
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="img-wrap">
                                                <img src="\${p.imageUrl}" loading="lazy" onerror="this.src='https://placehold.co/200x200?text=No+Image'">
                                            </div>
                                            <div class="info">
                                                <div class="site-name">\${domain}</div>
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="price">\${priceDisplay}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="link">View Product</a>
                                            </div>
                                        </div>
                                    \`);
                                }
                                
                                if(data.type === 'done') {
                                    status.textContent = 'Completed. Found ' + count + ' products.';
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
        
        const [browserInstance, urls] = await Promise.all([
            puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--block-new-web-contents' // Блокуємо попапи
                ]
            }),
            googleSearch(keyword)
        ]);

        browser = browserInstance;

        if (urls.length === 0) {
            send('done', { total: 0 });
            return res.end();
        }

        const topUrls = urls.slice(0, 10);
        send('progress', { msg: `Scanning ${topUrls.length} sites...`, done: 0, total: topUrls.length });

        // Queue Logic
        let completed = 0;
        const queue = [...topUrls];
        
        const worker = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                try {
                    await processSite(browser, url, keyword, send);
                } catch (e) {
                    // Ignore errors
                } finally {
                    completed++;
                    send('progress', { 
                        msg: `Processing...`, 
                        done: completed, 
                        total: topUrls.length 
                    });
                }
            }
        };

        // Start workers
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
        
        // Aggressive Blocking for Speed
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image', 'font', 'media', 'stylesheet', 'other'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        const ua = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(ua.toString());

        // Fail Fast: 12 seconds max
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // Minimal scroll to trigger text-based lazy loaders
        await page.evaluate(async () => {
            window.scrollBy(0, 1000);
            await new Promise(r => setTimeout(r, 200));
        });

        const html = await page.content();
        await page.close();
        page = null;

        const products = await parseWithAI(html, url, keyword);
        
        if (products.length > 0) {
            products.forEach(p => send('product', { p }));
        }

    } catch (e) {
        if(page) await page.close().catch(() => {});
    }
}

async function parseWithAI(html, url, keyword) {
    const $ = cheerio.load(html);

    // Clean junk, BUT be careful with prices
    $('script, style, noscript, svg, iframe, header, footer, nav').remove();
    $('.menu, .sidebar, .popup, .cookie, .ad, .banner').remove();
    
    // Fix Lazy Images
    $('img').each((i, el) => {
        const $el = $(el);
        const realSrc = $el.attr('data-src') || $el.attr('lazy-src') || $el.attr('data-srcset');
        if (realSrc) $el.attr('src', realSrc.split(' ')[0]);
    });

    // Compress HTML
    let body = $('body').html() || '';
    // Increase limit slightly to capture prices which might be further down
    const truncated = body.replace(/\s+/g, ' ').substring(0, 45000);

    const prompt = `
    Extract products for "${keyword}" from HTML.
    Site: ${new URL(url).hostname}

    CRITICAL INSTRUCTIONS FOR PRICE:
    - Look for currency symbols ($, AUD) and numbers.
    - Prices are often in <span> or <div> classes like 'price', 'amount', 'current-price'.
    - If a price has a range, take the lowest.
    - If price is missing, return null.

    Output format (JSON Array):
    [{"title":"...","price":"...","imageUrl":"...","productUrl":"..."}]

    HTML:
    ${truncated}
    `;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 3000
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
            price: p.price, // AI should now extract this better
            imageUrl: normalizeUrl(p.imageUrl, baseUrl),
            productUrl: normalizeUrl(p.productUrl, baseUrl)
        })).filter(p => p.imageUrl && p.productUrl && p.title);

    } catch (e) {
        return [];
    }
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr || urlStr.startsWith('data:')) return null;
    try {
        if (urlStr.startsWith('//')) return 'https:' + urlStr;
        return new URL(urlStr, baseUrl).href;
    } catch { return null; }
}

async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    const q = encodeURIComponent(`${keyword} australia shop`);
    try {
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10&gl=au`);
        return (res.data.items || [])
            .map(i => i.link)
            .filter(l => !l.includes('facebook') && !l.includes('youtube'));
    } catch { return []; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server started on ${PORT}`));
