require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
// Використовуємо stealth плагін для обходу захисту
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const UserAgent = require('user-agents');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`\n🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}\n`);

// ============ HTML INTERFACE (Залишив без змін) ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Product Search API - Australia (Fix)</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #333; margin-bottom: 10px; }
        .subtitle { color: #666; margin-bottom: 20px; }
        .search-box { display: flex; gap: 10px; margin-bottom: 20px; }
        input { flex: 1; padding: 12px 16px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; }
        input:focus { outline: none; border-color: #007bff; }
        button { padding: 12px 24px; font-size: 16px; background: #007bff; color: white; border: none; border-radius: 8px; cursor: pointer; }
        button:hover { background: #0056b3; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .status { padding: 10px; background: #e8f4fd; border-radius: 8px; margin-bottom: 15px; color: #0066cc; }
        .stats { display: flex; gap: 20px; margin-bottom: 20px; }
        .stat { background: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-value { font-size: 24px; font-weight: bold; color: #007bff; }
        .stat-label { color: #666; font-size: 14px; }
        .products { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
        .product { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: transform 0.2s; }
        .product:hover { transform: translateY(-4px); }
        .product img { width: 100%; height: 180px; object-fit: cover; background: #f0f0f0; }
        .product-info { padding: 15px; }
        .product-title { font-size: 14px; color: #333; margin-bottom: 8px; line-height: 1.4; }
        .product-price { font-size: 18px; font-weight: bold; color: #28a745; }
        .product-link { display: block; margin-top: 10px; color: #007bff; text-decoration: none; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 Product Search API (Stealth Mode)</h1>
        <p class="subtitle">Search Australian e-commerce sites in real-time</p>
        <div class="search-box">
            <input type="text" id="keyword" placeholder="Enter product keyword (e.g., bumper stickers)" />
            <button onclick="search()" id="searchBtn">Search</button>
        </div>
        <div id="status" class="status" style="display:none;"></div>
        <div class="stats" id="stats" style="display:none;">
            <div class="stat"><div class="stat-value" id="productCount">0</div><div class="stat-label">Products Found</div></div>
            <div class="stat"><div class="stat-value" id="siteCount">0/0</div><div class="stat-label">Sites Processed</div></div>
        </div>
        <div class="products" id="products"></div>
    </div>
    <script>
        async function search() {
            const keyword = document.getElementById('keyword').value.trim();
            if (!keyword) { alert('Please enter a keyword'); return; }
            const btn = document.getElementById('searchBtn');
            const status = document.getElementById('status');
            const stats = document.getElementById('stats');
            const products = document.getElementById('products');
            btn.disabled = true;
            btn.textContent = 'Searching...';
            status.style.display = 'block';
            stats.style.display = 'flex';
            products.innerHTML = '';
            document.getElementById('productCount').textContent = '0';
            document.getElementById('siteCount').textContent = '0/0';
            try {
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keyword })
                });
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const lines = decoder.decode(value).split('\\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try { handleEvent(JSON.parse(line.slice(6))); } catch (e) {}
                        }
                    }
                }
            } catch (e) { status.textContent = 'Error: ' + e.message; }
            btn.disabled = false;
            btn.textContent = 'Search';
        }
        function handleEvent(data) {
            const status = document.getElementById('status');
            const products = document.getElementById('products');
            if (data.type === 'status') status.textContent = data.message;
            if (data.type === 'processing') {
                status.textContent = 'Processing: ' + data.site;
                document.getElementById('siteCount').textContent = data.siteIndex + '/' + data.totalSites;
            }
            if (data.type === 'products') {
                document.getElementById('productCount').textContent = data.totalSoFar;
                data.newProducts.forEach(p => {
                    const price = p.price ? '$' + p.price + ' AUD' : 'Check Site';
                    products.innerHTML += '<div class="product"><img src="' + p.imageUrl + '" onerror="this.style.display=\\'none\\'"><div class="product-info"><div class="product-title">' + p.title + '</div><div class="product-price">' + price + '</div><a href="' + p.productUrl + '" target="_blank" class="product-link">View Product →</a></div></div>';
                });
            }
            if (data.type === 'complete') status.textContent = 'Found ' + data.totalProducts + ' products!';
        }
        document.getElementById('keyword').addEventListener('keypress', e => { if (e.key === 'Enter') search(); });
    </script>
</body>
</html>
    `);
});

// ============ STREAMING SEARCH ============
app.post('/api/search', async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    let browser = null;

    try {
        console.log(`\n🔍 Searching for: "${keyword}"`);
        sendEvent('status', { message: `Searching for "${keyword}"...` });

        const urls = await googleSearch(keyword);
        console.log(`📋 Found ${urls.length} URLs`);
        sendEvent('status', { message: `Found ${urls.length} sites to scan` });

        if (urls.length === 0) {
            sendEvent('complete', { totalProducts: 0, products: [] });
            return res.end();
        }

        // ЗАПУСК БРАУЗЕРА: Оптимізовано для Railway
        browser = await puppeteer.launch({
            // headless: 'new', // Старий синтаксис
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Важливо для Docker/Railway
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080'
            ],
            // Не вказуємо executablePath вручну, нехай puppeteer знайде встановлений або скачаний chrome
        });

        const allProducts = [];
        const seenTitles = new Set();

        // Ліміт на 5 сайтів для швидкості (можна змінити)
        const sitesToScan = urls.slice(0, 8); 

        for (let i = 0; i < sitesToScan.length; i++) {
            const url = sitesToScan[i];
            console.log(`\n📄 [${i + 1}/${sitesToScan.length}] Processing: ${url}`);
            sendEvent('processing', { site: url, siteIndex: i + 1, totalSites: sitesToScan.length });

            try {
                const html = await fetchPage(browser, url);
                if (!html) throw new Error("Empty HTML");

                const products = await parseHtmlWithAI(html, url, keyword);

                const newProducts = [];
                for (const product of products) {
                    // Більш жорстка фільтрація дублів
                    const normalizedTitle = product.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (normalizedTitle.length > 5 && !seenTitles.has(normalizedTitle)) {
                        seenTitles.add(normalizedTitle);
                        allProducts.push(product);
                        newProducts.push(product);
                    }
                }

                if (newProducts.length > 0) {
                    console.log(`   ✅ Found ${newProducts.length} new products`);
                    sendEvent('products', { site: url, newProducts, totalSoFar: allProducts.length });
                } else {
                    console.log(`   ⚠️ No new products found on this site`);
                }
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
            }
        }

        console.log(`\n✨ Total products: ${allProducts.length}`);
        sendEvent('complete', { keyword, totalProducts: allProducts.length, products: allProducts });

    } catch (error) {
        console.error('Search error:', error.message);
        sendEvent('error', { error: error.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
    }

    res.end();
});

// ============ FETCH PAGE (OPTIMIZED) ============
async function fetchPage(browser, url) {
    const page = await browser.newPage();
    
    try {
        // Динамічний User-Agent для кожного запиту
        const userAgent = new UserAgent({ deviceCategory: 'desktop' });
        await page.setUserAgent(userAgent.toString());
        
        await page.setViewport({ width: 1920, height: 1080 });

        // Блокуємо важкі ресурси для швидкості та економії трафіку
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media', 'other'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Timeout 25s
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        
        // Швидкий скрол для тригера lazy-load
        try {
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 400; // менший крок
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if(totalHeight >= 4000 || totalHeight >= scrollHeight){ // Не скролимо до безкінечності
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });
        } catch(e) {} // ігноруємо помилки скролу
        
        // Отримуємо контент
        const html = await page.content();
        return html;
    } catch (e) {
        console.log(`   Fetch failed: ${e.message}`);
        return null;
    } finally {
        await page.close();
    }
}

// ============ GOOGLE SEARCH ============
async function googleSearch(keyword) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    if (!apiKey || !cx) throw new Error('Google API not configured');

    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(keyword)}&num=10&gl=au&cr=countryAU`;
    
    try {
        const response = await axios.get(url);
        if (!response.data.items) return [];

        const blocked = ['reddit', 'wiki', 'youtube', 'facebook', 'twitter', 'pinterest', 'instagram', 'tiktok'];
        return response.data.items
            .map(item => item.link)
            .filter(link => !blocked.some(b => link.includes(b)));
    } catch(e) {
        console.error("Google Search Error:", e.message);
        return [];
    }
}

// ============ AI PARSING WITH CHEERIO (BETTER CLEANING) ============
async function parseHtmlWithAI(html, url, keyword) {
    // 1. Load HTML into Cheerio
    const $ = cheerio.load(html);

    // 2. Remove Junk (Garbage Collection)
    $('script, style, noscript, svg, iframe, header, footer, nav, form').remove();
    $('[class*="menu"], [class*="nav"], [class*="footer"], [class*="popup"], [class*="cookie"]').remove();
    
    // 3. Extract text logic - більш розумний підхід
    // Ми шукаємо елементи, які можуть бути контейнерами товарів
    // Замість сирого HTML ми спробуємо спростити структуру
    
    // Видаляємо всі атрибути крім src та href для економії токенів
    $('*').each((i, el) => {
        const attribs = el.attribs;
        const keep = ['src', 'href']; // Залишаємо тільки посилання
        Object.keys(attribs).forEach(attr => {
            if (!keep.includes(attr)) $(el).removeAttr(attr);
        });
    });

    // Беремо body, але лімітуємо довжину розумніше
    let cleanedHtml = $('body').html() || '';
    
    // Видаляємо пусті теги та зайві пробіли
    cleanedHtml = cleanedHtml.replace(/<[^/>][^>]*><\/[^>]+>/g, "").replace(/\s+/g, ' ').trim();
    
    // Ліміт токенів - тепер ми відправляємо чистішу розмітку
    const truncated = cleanedHtml.substring(0, 45000); 
    console.log(`   📝 Sending ${truncated.length} clean chars to AI`);

    const prompt = `
    Analyze this HTML snippet from an Australian e-commerce site searched for "${keyword}".
    Identify the main PRODUCT GRID. Ignore "Related products" or "You may also like".

    Extract products into a JSON Array.
    Format: [{"title": "String", "price": NumberOrString, "imageUrl": "String", "productUrl": "String"}]

    Rules:
    1. Title: Must be the specific product name.
    2. Price: Extract raw number or string (e.g. "29.99" or "$29.99"). If unavailable, set null.
    3. Image: Find the main product image (src).
    4. Link: Find the link to the product page (href).
    5. Exclude items that are obviously categories, ads, or blog posts.
    6. Max 15 items.

    Response MUST be valid JSON only. No markdown.

    HTML Snippet:
    ${truncated}
    `;

    try {
        let responseText;
        
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a JSON extractor API. Output pure JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0,
                max_tokens: 4000
            });
            responseText = completion.choices[0].message.content;
        } else {
            const resp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 8000 } }
            );
            responseText = resp.data.candidates[0].content.parts[0].text;
        }

        const jsonStr = responseText.replace(/```json|```/gi, '').trim();
        const start = jsonStr.indexOf('[');
        const end = jsonStr.lastIndexOf(']');
        
        if (start === -1 || end === -1) return [];
        
        const products = JSON.parse(jsonStr.substring(start, end + 1));

        const baseUrl = new URL(url).origin;
        
        return products.map(p => ({
            title: p.title,
            price: p.price,
            imageUrl: normalizeUrl(p.imageUrl, baseUrl),
            productUrl: normalizeUrl(p.productUrl, baseUrl),
            supplier: new URL(url).hostname
        }));

    } catch (error) {
        console.log(`   ❌ AI Error: ${error.message}`);
        return [];
    }
}

function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr) return null;
    try {
        // Якщо це base64 картинка - ігноруємо або повертаємо як є (часто це плейсхолдер)
        if (urlStr.startsWith('data:')) return null; 
        return new URL(urlStr, baseUrl).href;
    } catch (e) {
        return null;
    }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
