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
const CONCURRENCY = 5; 
const PAGE_TIMEOUT = 15000; // Трохи збільшив для надійності
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`Provider: ${AI_PROVIDER} | Threads: ${CONCURRENCY}`);

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
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; padding: 20px; max-width: 1200px; margin: 0 auto; }
        .search-box { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; gap: 10px; }
        input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px; }
        button { padding: 12px 24px; background: #0052cc; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
        button:disabled { background: #b3bac5; }
        
        .status-bar { margin-bottom: 10px; font-size: 14px; color: #555; display: flex; justify-content: space-between; }
        .progress-bg { height: 4px; background: #dfe1e6; width: 100%; margin-bottom: 20px; }
        .progress-fill { height: 100%; background: #0052cc; width: 0%; transition: width 0.3s; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 8px; overflow: hidden; border: 1px solid #ebecf0; display: flex; flex-direction: column; transition: transform 0.2s; }
        .card:hover { transform: translateY(-3px); box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
        .img-wrap { height: 180px; padding: 10px; display: flex; align-items: center; justify-content: center; background: #fff; border-bottom: 1px solid #f0f0f0; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .info { padding: 15px; flex: 1; display: flex; flex-direction: column; }
        .domain { font-size: 11px; text-transform: uppercase; color: #6b778c; font-weight: 700; margin-bottom: 5px; }
        .title { font-size: 14px; margin-bottom: 8px; font-weight: 500; color: #172b4d; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .price { font-size: 18px; font-weight: 700; color: #00875a; margin-top: auto; }
        .link-btn { margin-top: 12px; display: block; text-align: center; background: #f4f5f7; color: #172b4d; text-decoration: none; padding: 10px; border-radius: 4px; font-size: 13px; font-weight: 500; transition: background 0.2s; }
        .link-btn:hover { background: #ebecf0; }
    </style>
</head>
<body>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Enter product name..." onkeypress="if(event.key==='Enter') run()">
        <button onclick="run()" id="btn">Search</button>
    </div>
    
    <div class="status-bar"><span id="status">Ready</span><span id="counter">0 products</span></div>
    <div class="progress-bg"><div class="progress-fill" id="progress"></div></div>
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
                                    if(data.total > 0) {
                                        progress.style.width = Math.round((data.done / data.total) * 100) + '%';
                                    }
                                }
                                
                                if(data.type === 'product') {
                                    count++;
                                    counter.textContent = count + ' products';
                                    const p = data.p;
                                    const domain = new URL(p.productUrl).hostname.replace('www.','');
                                    
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="img-wrap">
                                                <img src="\${p.imageUrl}" loading="lazy" onerror="this.style.display='none'">
                                            </div>
                                            <div class="info">
                                                <div class="domain">\${domain}</div>
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="price">\${p.price || 'Check Price'}</div>
                                                <a href="\${p.productUrl}" target="_blank" class="link-btn">View Product</a>
                                            </div>
                                        </div>
                                    \`);
                                }
                                
                                if(data.type === 'done') {
                                    status.textContent = 'Search complete.';
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
                    '--block-new-web-contents'
                ]
            }),
            googleSearch(keyword)
        ]);

        browser = browserInstance;

        if (urls.length === 0) {
            send('done', { total: 0 });
            return res.end();
        }

        // Обробляємо топ 10 сайтів
        const topUrls = urls.slice(0, 10);
        
        let completed = 0;
        const queue = [...topUrls];
        
        // Воркер для черги
        const worker = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                try {
                    await processSite(browser, url, keyword, send);
                } catch (e) {
                    // console.error(`Failed ${url}: ${e.message}`);
                } finally {
                    completed++;
                    send('progress', { 
                        msg: `Processing sites...`, 
                        done: completed, 
                        total: topUrls.length 
                    });
                }
            }
        };

        // Запускаємо потоки
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

// ============ SITE PROCESSOR ============
async function processSite(browser, url, keyword, send) {
    let page = null;
    try {
        page = await browser.newPage();
        
        // Блокуємо ресурси (КРІМ СКРИПТІВ - вони потрібні для цін і посилань на багатьох SPA сайтах)
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        const ua = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(ua.toString());

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // Скрол для активації лінків і цін
        await page.evaluate(async () => {
            window.scrollBy(0, 1000);
            await new Promise(r => setTimeout(r, 300));
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

// ============ AI LOGIC (IMPROVED) ============
async function parseWithAI(html, url, keyword) {
    const $ = cheerio.load(html);

    // 1. ВИДАЛЯЄМО СМІТТЯ (але обережно з nav/menu, бо там бувають категорії)
    $('script, style, noscript, svg, iframe, footer').remove();
    // Видаляємо явні блоки "Related", "You may like", щоб прибрати нерелевантність
    $('.related, .recommendations, .upsell, .cross-sell, .recent-viewed').remove();
    
    // 2. ФІКС КАРТИНОК (Lazy Load)
    $('img').each((i, el) => {
        const $el = $(el);
        const realSrc = $el.attr('data-src') || $el.attr('lazy-src') || $el.attr('data-srcset');
        if (realSrc) $el.attr('src', realSrc.split(' ')[0]);
    });

    // 3. ПІДГОТОВКА ДЛЯ AI
    // Не видаляємо всі атрибути, бо class допомагає AI знайти ціну (.price, .amount)
    // Просто обрізаємо дуже довгі атрибути (типу base64 або tracking data)
    $('*').each((i, el) => {
        if(el.type === 'tag') {
            const attribs = el.attribs || {};
            for(const key in attribs) {
                if(attribs[key].length > 200 && key !== 'src' && key !== 'href') {
                    delete attribs[key];
                }
            }
        }
    });

    let body = $('body').html() || '';
    // Ліміт 50к символів
    const truncated = body.replace(/\s+/g, ' ').substring(0, 50000);

    const prompt = `
    Analyze HTML from "${url}".
    Extract products matching keyword: "${keyword}".

    STRICT RULES:
    1. RELEVANCE: Ignore items that do not match the keyword (e.g. if searching for "iphone", ignore "case" or "cable" unless it's the main item).
    2. LINKS: You MUST return the Full Absolute URL. If the link in HTML is relative (e.g. "/product/123"), prepend the base domain.
    3. PRICE: Look carefully for prices in <span>, <div>, or <b> tags. Format: "$20.00". If multiple prices, take the main/lowest. If missing, null.
    4. IMAGE: Must be a valid URL.

    Return JSON Array:
    [{"title":"...","price":"...","imageUrl":"...","productUrl":"..."}]
    
    HTML Snippet:
    ${truncated}
    `;

    try {
        let content;
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 4000
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

        // Фільтрація і Нормалізація
        return raw.map(p => ({
            title: p.title,
            price: p.price,
            imageUrl: normalizeUrl(p.imageUrl, baseUrl),
            productUrl: normalizeUrl(p.productUrl, baseUrl)
        })).filter(p => {
            // Фільтруємо сміття
            if (!p.title || !p.productUrl || !p.imageUrl) return false;
            // Перевірка на релевантність (базова)
            const kWords = keyword.toLowerCase().split(' ');
            const titleLower = p.title.toLowerCase();
            // Хоча б одне слово з запиту має бути в назві (окрім прийменників)
            return kWords.some(w => w.length > 2 && titleLower.includes(w));
        });

    } catch (e) {
        return [];
    }
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr || urlStr.startsWith('data:') || urlStr.startsWith('javascript:')) return null;
    try {
        // Очищаємо пробіли
        urlStr = urlStr.trim();
        
        // Якщо це просто шлях, додаємо базу
        if (urlStr.startsWith('/')) {
            return new URL(urlStr, baseUrl).href;
        }
        // Якщо немає протоколу
        if (urlStr.startsWith('www.')) {
            return 'https://' + urlStr;
        }
        // Якщо це повний URL, перевіряємо валідність
        if (urlStr.startsWith('http')) {
            return new URL(urlStr).href;
        }
        // В інших випадках (наприклад relative path без слеша)
        return new URL(urlStr, baseUrl).href;
    } catch { 
        return null; 
    }
}

async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    // Додаємо "product" щоб уникнути статей блогів
    const q = encodeURIComponent(`${keyword} product australia`);
    try {
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10&gl=au`);
        return (res.data.items || [])
            .map(i => i.link)
            .filter(l => !l.includes('facebook.com') && !l.includes('youtube.com') && !l.includes('instagram.com'));
    } catch { return []; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
