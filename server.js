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
const PAGE_TIMEOUT = 15000;
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`Provider: ${AI_PROVIDER} | Threads: ${CONCURRENCY}`);

// ============ UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AU Search API</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0f2f5; padding: 20px; max-width: 1200px; margin: 0 auto; color: #1c1e21; }
        .search-box { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 24px; display: flex; gap: 12px; }
        input { flex: 1; padding: 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; outline: none; transition: border 0.2s; }
        input:focus { border-color: #1877f2; }
        button { padding: 14px 32px; background: #1877f2; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 16px; transition: background 0.2s; }
        button:hover { background: #166fe5; }
        button:disabled { background: #bcc0c4; cursor: not-allowed; }
        
        .status-bar { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; color: #65676b; font-weight: 500; }
        .progress-track { height: 6px; background: #e4e6eb; border-radius: 3px; overflow: hidden; margin-bottom: 24px; }
        .progress-fill { height: 100%; background: #1877f2; width: 0%; transition: width 0.3s ease-out; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.1); display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s; border: 1px solid #f0f2f5; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 8px 16px rgba(0,0,0,0.1); }
        .img-area { height: 200px; padding: 15px; display: flex; align-items: center; justify-content: center; background: #fff; border-bottom: 1px solid #f0f2f5; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .content { padding: 16px; flex: 1; display: flex; flex-direction: column; }
        .site { font-size: 11px; text-transform: uppercase; color: #65676b; font-weight: 700; margin-bottom: 8px; letter-spacing: 0.5px; }
        .title { font-size: 15px; margin-bottom: 8px; font-weight: 600; line-height: 1.4; color: #050505; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .price { font-size: 18px; font-weight: 700; color: #216fdb; margin-top: auto; }
        .actions { margin-top: 16px; }
        .btn-view { display: block; text-align: center; background: #e4e6eb; color: #050505; text-decoration: none; padding: 10px; border-radius: 6px; font-size: 14px; font-weight: 600; transition: 0.2s; }
        .btn-view:hover { background: #d8dadf; }
    </style>
</head>
<body>
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Search for products in Australia..." onkeypress="if(event.key==='Enter') run()">
        <button onclick="run()" id="btn">Search</button>
    </div>
    
    <div class="status-bar"><span id="status">Ready</span><span id="counter">0 found</span></div>
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
            progress.style.width = '2%';
            status.textContent = 'Initializing search...';
            
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
                                    counter.textContent = count + ' found';
                                    const p = data.p;
                                    const domain = new URL(p.productUrl).hostname.replace('www.','');
                                    
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="img-area">
                                                <img src="\${p.imageUrl}" onerror="this.src='https://placehold.co/400?text=No+Image'">
                                            </div>
                                            <div class="content">
                                                <div class="site">\${domain}</div>
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="price">\${p.price || 'See Website'}</div>
                                                <div class="actions">
                                                    <a href="\${p.productUrl}" target="_blank" class="btn-view">View Product</a>
                                                </div>
                                            </div>
                                        </div>
                                    \`);
                                }
                                
                                if(data.type === 'done') {
                                    status.textContent = 'Search complete';
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
        send('progress', { msg: 'Searching Google...', done: 0, total: 10 });
        
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

        const topUrls = urls.slice(0, 10);
        let completed = 0;
        const queue = [...topUrls];
        
        const worker = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                try {
                    await processSite(browser, url, keyword, send);
                } catch (e) {
                    // console.log(`Skipping ${url}: ${e.message}`);
                } finally {
                    completed++;
                    send('progress', { 
                        msg: `Scanning sites (${completed}/${topUrls.length})...`, 
                        done: completed, 
                        total: topUrls.length 
                    });
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

// ============ PROCESSOR ============
async function processSite(browser, url, keyword, send) {
    let page = null;
    try {
        page = await browser.newPage();
        
        // Block heavy media but KEEP SCRIPTS (needed for dynamic prices)
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image', 'font', 'media'].includes(type)) req.abort();
            else req.continue();
        });

        const ua = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(ua.toString());

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // Scroll to load dynamic content
        await page.evaluate(async () => {
            window.scrollBy(0, 800);
            await new Promise(r => setTimeout(r, 200));
            window.scrollBy(0, 800);
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

// ============ AI LOGIC ============
async function parseWithAI(html, url, keyword) {
    const $ = cheerio.load(html);

    // 1. Remove ONLY strict garbage. Keep 'divs' and 'spans' intact.
    $('script, style, noscript, svg, iframe, header, footer').remove();
    
    // 2. Fix Images
    $('img').each((i, el) => {
        const $el = $(el);
        const realSrc = $el.attr('data-src') || $el.attr('lazy-src') || $el.attr('data-srcset');
        if (realSrc) $el.attr('src', realSrc.split(' ')[0]);
    });

    // 3. Attribute pruning (Keep classes for context!)
    $('*').each((i, el) => {
        if(el.type === 'tag') {
            const attribs = el.attribs || {};
            // Keep class, id, src, href. Remove huge data attributes.
            for(const key in attribs) {
                if(!['class','id','src','href'].includes(key) && attribs[key].length > 100) {
                    delete attribs[key];
                }
            }
        }
    });

    // Extract BODY content
    const bodyHtml = $('body').html() || '';
    // Limit to 50k chars (approx 12-15k tokens), fits in GPT-4o-mini
    const truncated = bodyHtml.replace(/\s+/g, ' ').substring(0, 50000);

    const prompt = `
    Analyze this HTML from "${url}".
    Extract products matching: "${keyword}".

    Instructions:
    1. FIND THE MAIN GRID: Look for lists of items with images, titles, and prices.
    2. RELEVANCE: Include items that are relevant variations of the keyword. 
       - If user wants "iphone", include "iphone 13", "iphone 14 pro".
       - EXCLUDE "cases", "cables" unless keyword explicitly asks for accessories.
    3. LINKS: Ensure 'productUrl' is the FULL absolute URL (e.g. start with https://...).
    4. PRICE: Extract price text (e.g. "$19.99"). If missing, set null.
    5. IMAGE: Must be a valid image URL.

    Return JSON:
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

        return raw.map(p => ({
            title: p.title,
            price: p.price,
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
        urlStr = urlStr.trim();
        if (urlStr.startsWith('//')) return 'https:' + urlStr;
        if (urlStr.startsWith('http')) return urlStr;
        // Fix relative paths
        if (urlStr.startsWith('/')) return new URL(urlStr, baseUrl).href;
        // Fix paths without slash
        return new URL(urlStr, baseUrl).href;
    } catch { return null; }
}

async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    // Більш широкий запит для магазинів
    const q = encodeURIComponent(`${keyword} buy online australia`);
    try {
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=10&gl=au`);
        return (res.data.items || [])
            .map(i => i.link)
            .filter(l => !l.includes('facebook') && !l.includes('youtube') && !l.includes('wiki'));
    } catch { return []; }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server: ${PORT}`));
