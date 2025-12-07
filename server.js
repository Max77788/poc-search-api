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
const CONCURRENCY = 3; // Зменшено для стабільності
const PAGE_TIMEOUT = 20000; // Збільшено для надійності
const MAX_SITES = 20;
const AI_PROVIDER = process.env.OPENAI_API_KEY ? 'openai' : 'gemini';

// Мінімальний blacklist - тільки критичні
const BLACKLIST = ['cremation', 'funeral', 'burial', 'login', 'cart', 'checkout', 'career', 'job', 'account'];

let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

console.log(`🚀 AU Product Search v2.0 | ${AI_PROVIDER.toUpperCase()}`);

// ============ UI ============
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AU Product Search</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, system-ui, sans-serif; background: #f0f4f8; padding: 20px; max-width: 1400px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; }
        .header h1 { color: #1e40af; margin: 0; font-size: 28px; }
        .header p { color: #64748b; margin-top: 8px; }
        .search-box { background: white; padding: 20px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); display: flex; gap: 12px; margin-bottom: 24px; }
        input { flex: 1; padding: 16px 20px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 16px; outline: none; transition: 0.2s; }
        input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
        button { padding: 16px 40px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; border: none; border-radius: 12px; font-weight: 600; font-size: 16px; cursor: pointer; transition: 0.2s; }
        button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(59,130,246,0.4); }
        button:disabled { background: #94a3b8; transform: none; box-shadow: none; cursor: not-allowed; }
        
        .status-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px; }
        .status { font-size: 14px; color: #64748b; font-weight: 500; }
        .counter { font-size: 14px; color: #3b82f6; font-weight: 600; }
        .progress-track { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; margin-bottom: 30px; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); width: 0%; transition: width 0.4s ease; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px; }
        .card { background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06); transition: all 0.3s; position: relative; display: flex; flex-direction: column; }
        .card:hover { transform: translateY(-6px); box-shadow: 0 12px 24px rgba(0,0,0,0.12); }
        
        .img-wrap { height: 240px; padding: 20px; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #f8fafc, #fff); position: relative; }
        .card img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; }
        .badge { position: absolute; top: 12px; left: 12px; font-size: 11px; background: #1e40af; padding: 6px 10px; border-radius: 6px; color: white; font-weight: 600; }
        
        .info { padding: 20px; flex: 1; display: flex; flex-direction: column; border-top: 1px solid #f1f5f9; }
        .title { font-size: 15px; margin-bottom: 12px; font-weight: 600; color: #0f172a; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        
        .details { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; min-height: 32px; }
        .tag { font-size: 12px; background: #f1f5f9; padding: 6px 10px; border-radius: 6px; color: #475569; font-weight: 500; display: flex; align-items: center; gap: 4px; }
        .tag.size { background: #dbeafe; color: #1e40af; }
        .tag.price-tag { background: #dcfce7; color: #166534; }
        
        .price { font-size: 24px; font-weight: 700; color: #16a34a; margin-top: auto; margin-bottom: 16px; }
        .price.no-price { font-size: 16px; color: #94a3b8; }
        
        .btn-link { text-align: center; background: #1e40af; color: white; text-decoration: none; padding: 14px; border-radius: 10px; font-size: 14px; font-weight: 600; transition: 0.2s; }
        .btn-link:hover { background: #1d4ed8; }
        
        .empty-state { text-align: center; padding: 60px 20px; color: #64748b; }
        .empty-state svg { width: 80px; height: 80px; margin-bottom: 20px; opacity: 0.5; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🇦🇺 Australian Product Search</h1>
        <p>Find products from Australian e-commerce stores</p>
    </div>
    
    <div class="search-box">
        <input type="text" id="keyword" placeholder="Enter product name (e.g., custom stickers, packaging boxes...)" onkeypress="if(event.key==='Enter') run()">
        <button onclick="run()" id="btn">Search</button>
    </div>
    
    <div class="status-bar">
        <span class="status" id="status">Ready to search</span>
        <span class="counter" id="counter"></span>
    </div>
    <div class="progress-track"><div class="progress-fill" id="progress"></div></div>
    <div id="results" class="grid"></div>

    <script>
        async function run() {
            const keyword = document.getElementById('keyword').value.trim();
            if(!keyword) { alert('Please enter a search term'); return; }
            
            const btn = document.getElementById('btn');
            const status = document.getElementById('status');
            const counter = document.getElementById('counter');
            const progress = document.getElementById('progress');
            const results = document.getElementById('results');
            
            btn.disabled = true;
            results.innerHTML = '';
            progress.style.width = '5%';
            status.textContent = 'Starting search...';
            counter.textContent = '';
            
            let productCount = 0;

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
                                    if(data.pct) progress.style.width = data.pct + '%';
                                }
                                
                                if(data.type === 'product') {
                                    productCount++;
                                    counter.textContent = productCount + ' products found';
                                    const p = data.product;
                                    
                                    let domain = 'Unknown';
                                    try { domain = new URL(p.productUrl).hostname.replace('www.',''); } catch(e) {}
                                    
                                    const sizeHtml = p.size ? \`<span class="tag size">📏 \${p.size}</span>\` : '';
                                    const priceClass = p.price && p.price !== 'Check Site' ? 'price' : 'price no-price';
                                    const priceText = p.price || 'Check Site';
                                    
                                    results.insertAdjacentHTML('beforeend', \`
                                        <div class="card">
                                            <div class="img-wrap">
                                                <div class="badge">\${domain}</div>
                                                <img src="\${p.imageUrl}" loading="lazy" onerror="this.onerror=null; this.src='https://placehold.co/300x200/f1f5f9/64748b?text=No+Image'">
                                            </div>
                                            <div class="info">
                                                <div class="title" title="\${p.title}">\${p.title}</div>
                                                <div class="details">\${sizeHtml}</div>
                                                <div class="\${priceClass}">\${priceText}</div>
                                                <a href="\${p.productUrl}" target="_blank" rel="noopener" class="btn-link">View Product →</a>
                                            </div>
                                        </div>
                                    \`);
                                }
                                
                                if(data.type === 'done') {
                                    status.textContent = \`Complete! Found \${productCount} products from \${data.sites} sites\`;
                                    progress.style.width = '100%';
                                }
                            } catch(e) { console.log('Parse error:', e); }
                        }
                    }
                }
            } catch(e) {
                status.textContent = 'Error: ' + e.message;
            } finally {
                btn.disabled = false;
            }
        }
    </script>
</body>
</html>
    `);
});

// ============ SEARCH API ============
app.post('/api/search', async (req, res) => {
    const { keyword } = req.body;
    
    if (!keyword || keyword.trim().length < 2) {
        return res.status(400).json({ error: 'Keyword required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (type, data) => {
        try {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        } catch (e) {}
    };

    let browser = null;
    const sentProducts = new Map(); // domain -> product
    
    try {
        send('progress', { msg: 'Searching Google Australia...', pct: 5 });
        
        // 1. Google Search
        const urls = await googleSearch(keyword);
        console.log(`📋 Google returned ${urls.length} URLs`);
        
        if (urls.length === 0) {
            send('progress', { msg: 'No results from Google', pct: 100 });
            send('done', { sites: 0 });
            return res.end();
        }

        // Беремо унікальні домени
        const uniqueUrls = getUniqueDomainUrls(urls, MAX_SITES);
        console.log(`🔗 Processing ${uniqueUrls.length} unique domains`);

        send('progress', { msg: `Found ${uniqueUrls.length} sites to scan...`, pct: 10 });

        // 2. Launch Browser
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        // 3. Process sites
        let completed = 0;
        const queue = [...uniqueUrls];
        
        const processNext = async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                if (!url) continue;
                
                const domain = getDomain(url);
                if (sentProducts.has(domain)) {
                    completed++;
                    continue;
                }

                try {
                    console.log(`\n🌐 [${completed + 1}/${uniqueUrls.length}] ${url}`);
                    
                    const product = await extractProductFromSite(browser, url, keyword);
                    
                    if (product && isValidProduct(product)) {
                        sentProducts.set(domain, true);
                        send('product', { product });
                        console.log(`   ✅ Found: ${product.title.substring(0, 50)}...`);
                    } else {
                        console.log(`   ⚠️ No valid product found`);
                    }
                } catch (e) {
                    console.log(`   ❌ Error: ${e.message}`);
                }
                
                completed++;
                const pct = Math.round(10 + (completed / uniqueUrls.length) * 85);
                send('progress', { msg: `Scanning sites... (${completed}/${uniqueUrls.length})`, pct });
            }
        };

        // Run workers in parallel
        const workers = Array(CONCURRENCY).fill(null).map(() => processNext());
        await Promise.all(workers);

        send('progress', { msg: 'Search complete!', pct: 100 });
        send('done', { sites: sentProducts.size });

    } catch (e) {
        console.error('❌ API Error:', e);
        send('progress', { msg: 'Error: ' + e.message, pct: 100 });
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
        res.end();
    }
});

// ============ EXTRACT PRODUCT FROM SITE ============
async function extractProductFromSite(browser, url, keyword) {
    let page = null;
    
    try {
        page = await browser.newPage();
        
        // Блокуємо тільки медіа, залишаємо стилі для кращого рендерингу
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image', 'media', 'font'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent(new UserAgent({ deviceCategory: 'desktop' }).toString());
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Навігація з очікуванням
        await page.goto(url, { 
            waitUntil: 'networkidle2', 
            timeout: PAGE_TIMEOUT 
        });

        // Скрол для lazy-load
        await page.evaluate(async () => {
            for (let i = 0; i < 3; i++) {
                window.scrollBy(0, 500);
                await new Promise(r => setTimeout(r, 300));
            }
            window.scrollTo(0, 0);
        });

        await new Promise(r => setTimeout(r, 1500));

        const html = await page.content();
        const finalUrl = page.url(); // Може бути redirect
        
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const baseUrl = new URL(finalUrl).origin;
        
        // === PHASE 1: JSON-LD (найнадійніше) ===
        const jsonLdProducts = extractJsonLdProducts($, baseUrl);
        console.log(`   📊 JSON-LD: ${jsonLdProducts.length} products`);
        
        // === PHASE 2: AI Analysis (завжди, для кращих результатів) ===
        // Очищаємо HTML
        $('script, style, noscript, svg, iframe, header, footer, nav, .menu, .sidebar, .modal, .popup, .cookie, [aria-hidden="true"]').remove();
        
        let bodyHtml = $('main').html() || $('article').html() || $('.product').html() || $('body').html() || '';
        
        // Витягуємо текст з селектів та варіантів
        const variants = [];
        $('select option, .variant, .swatch, [class*="size"], [class*="option"]').each((i, el) => {
            const text = $(el).text().trim();
            if (text && text.length < 100 && text.length > 1) {
                variants.push(text);
            }
        });
        
        const variantsText = [...new Set(variants)].slice(0, 30).join(', ');
        if (variantsText) {
            bodyHtml += `\n<div>Available options: ${variantsText}</div>`;
        }

        // Обмежуємо розмір HTML
        const cleanedHtml = bodyHtml.replace(/\s+/g, ' ').substring(0, 80000);
        
        let aiProducts = [];
        if (cleanedHtml.length > 500) {
            aiProducts = await parseWithAI(cleanedHtml, finalUrl, keyword);
            console.log(`   🤖 AI: ${aiProducts.length} products`);
        }

        // === PHASE 3: Об'єднуємо та вибираємо найкращий ===
        const allProducts = [...jsonLdProducts, ...aiProducts];
        
        if (allProducts.length === 0) {
            return null;
        }

        // Фільтруємо та сортуємо
        const validProducts = allProducts
            .filter(p => {
                if (!p.title || p.title.length < 3) return false;
                if (!p.imageUrl) return false;
                if (!p.productUrl) return false;
                
                const titleLower = p.title.toLowerCase();
                if (BLACKLIST.some(bad => titleLower.includes(bad))) return false;
                
                // М'яка перевірка релевантності
                const keywordLower = keyword.toLowerCase();
                const keywordWords = keywordLower.split(/\s+/).filter(w => w.length > 2);
                
                // Якщо хоча б одне слово з keyword є в title - ОК
                const hasMatch = keywordWords.some(word => titleLower.includes(word));
                
                return hasMatch || keywordWords.length === 0;
            })
            .sort((a, b) => {
                // Пріоритет: є ціна + є розмір + є картинка
                let scoreA = 0;
                let scoreB = 0;
                
                if (a.price && a.price !== 'Check Site') scoreA += 3;
                if (a.size) scoreA += 2;
                if (a.imageUrl && !a.imageUrl.includes('placeholder')) scoreA += 1;
                
                if (b.price && b.price !== 'Check Site') scoreB += 3;
                if (b.size) scoreB += 2;
                if (b.imageUrl && !b.imageUrl.includes('placeholder')) scoreB += 1;
                
                return scoreB - scoreA;
            });

        if (validProducts.length === 0) {
            return null;
        }

        const best = validProducts[0];
        
        // Нормалізуємо фінальний продукт
        return {
            title: best.title.trim(),
            price: best.price || 'Check Site',
            size: best.size || null,
            imageUrl: best.imageUrl,
            productUrl: best.productUrl || finalUrl
        };

    } catch (e) {
        if (page) await page.close().catch(() => {});
        throw e;
    }
}

// ============ JSON-LD EXTRACTION ============
function extractJsonLdProducts($, baseUrl) {
    const products = [];
    
    $('script[type="application/ld+json"]').each((i, el) => {
        try {
            const text = $(el).html();
            if (!text) return;
            
            const data = JSON.parse(text);
            const items = Array.isArray(data) ? data : [data];
            
            items.forEach(item => {
                // Direct Product
                if (item['@type'] === 'Product') {
                    const p = parseJsonLdProduct(item, baseUrl);
                    if (p) products.push(p);
                }
                
                // ItemPage with mainEntity
                if (item['@type'] === 'ItemPage' && item.mainEntity) {
                    const p = parseJsonLdProduct(item.mainEntity, baseUrl);
                    if (p) products.push(p);
                }
                
                // @graph array
                if (item['@graph']) {
                    item['@graph'].forEach(g => {
                        if (g['@type'] === 'Product') {
                            const p = parseJsonLdProduct(g, baseUrl);
                            if (p) products.push(p);
                        }
                    });
                }
            });
        } catch (e) {
            // Invalid JSON, skip
        }
    });
    
    return products;
}

function parseJsonLdProduct(item, baseUrl) {
    if (!item.name) return null;
    
    let price = null;
    let size = null;
    let image = null;
    let productUrl = null;

    // Price
    if (item.offers) {
        const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
        for (const offer of offers) {
            if (offer.price) {
                const currency = offer.priceCurrency || 'AUD';
                price = `$${offer.price} ${currency}`;
                break;
            }
            if (offer.lowPrice) {
                const currency = offer.priceCurrency || 'AUD';
                price = `From $${offer.lowPrice} ${currency}`;
                break;
            }
        }
    }

    // Size - шукаємо в різних місцях
    if (item.size) {
        size = typeof item.size === 'object' ? item.size.name : item.size;
    }
    
    if (!size && item.additionalProperty) {
        const props = Array.isArray(item.additionalProperty) ? item.additionalProperty : [item.additionalProperty];
        for (const prop of props) {
            if (prop.name && /size|dimension|width|height|length/i.test(prop.name)) {
                size = `${prop.name}: ${prop.value}`;
                break;
            }
        }
    }
    
    if (!size && item.description) {
        // Шукаємо розміри в описі
        const sizeMatch = item.description.match(/(\d+)\s*(x|×|by)\s*(\d+)\s*(mm|cm|m|inch|in|"|cm²|mm²)?/i);
        if (sizeMatch) {
            size = sizeMatch[0];
        } else {
            const paperSize = item.description.match(/\b(A[0-9]|Letter|Legal|Tabloid)\b/i);
            if (paperSize) size = paperSize[0];
        }
    }

    // Image
    if (item.image) {
        if (typeof item.image === 'string') {
            image = item.image;
        } else if (Array.isArray(item.image)) {
            image = typeof item.image[0] === 'string' ? item.image[0] : item.image[0]?.url;
        } else if (item.image.url) {
            image = item.image.url;
        }
    }

    // URL
    productUrl = item.url || item['@id'] || null;

    if (!image) return null;

    return {
        title: item.name,
        price,
        size,
        imageUrl: normalizeUrl(image, baseUrl),
        productUrl: normalizeUrl(productUrl, baseUrl)
    };
}

// ============ AI PARSING ============
async function parseWithAI(html, url, keyword) {
    const prompt = `You are an e-commerce product data extractor. Analyze this Australian store page and extract product information.

SEARCH TERM: "${keyword}"

EXTRACT FOR EACH PRODUCT:
1. title: Full product name
2. price: Price in format "$XX.XX AUD" or null if not found
3. size: Dimensions/size (e.g., "100x50mm", "A4", "Large", "500ml") - check product options, variants, descriptions
4. imageUrl: Product image URL (absolute URL starting with http)
5. productUrl: Product page URL (absolute URL starting with http)

IMPORTANT:
- Look for size information in: product options, variant selectors, specifications, descriptions
- Common size formats: dimensions (100x50mm), paper sizes (A4, A5), volume (500ml), clothing (S/M/L/XL)
- Extract up to 5 most relevant products matching "${keyword}"
- Only include products that can be purchased (not categories or informational pages)
- Base URL for relative paths: ${new URL(url).origin}

Return ONLY a valid JSON array:
[{"title":"...","price":"$XX.XX AUD","size":"...","imageUrl":"https://...","productUrl":"https://..."}]

If no products found, return: []

HTML CONTENT:
${html}`;

    try {
        let content;
        
        if (AI_PROVIDER === 'openai') {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You extract product data from e-commerce HTML. Return only valid JSON arrays.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0,
                max_tokens: 2000
            });
            content = completion.choices[0].message.content;
        } else {
            const resp = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { 
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0, maxOutputTokens: 2000 }
                },
                { timeout: 15000 }
            );
            content = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        }

        // Parse JSON
        const jsonStr = content.replace(/```json|```/gi, '').trim();
        const startIdx = jsonStr.indexOf('[');
        const endIdx = jsonStr.lastIndexOf(']');
        
        if (startIdx === -1 || endIdx === -1) return [];
        
        const parsed = JSON.parse(jsonStr.substring(startIdx, endIdx + 1));
        const baseUrl = new URL(url).origin;
        
        return parsed
            .filter(p => p && p.title)
            .map(p => ({
                title: p.title,
                price: p.price || null,
                size: p.size || null,
                imageUrl: normalizeUrl(p.imageUrl, baseUrl),
                productUrl: normalizeUrl(p.productUrl, baseUrl) || url
            }))
            .filter(p => p.imageUrl && p.productUrl);

    } catch (e) {
        console.log(`   ⚠️ AI Error: ${e.message}`);
        return [];
    }
}

// ============ HELPERS ============
function normalizeUrl(urlStr, baseUrl) {
    if (!urlStr) return null;
    if (typeof urlStr !== 'string') return null;
    if (urlStr.startsWith('data:')) return null;
    
    try {
        urlStr = urlStr.trim();
        
        if (urlStr.startsWith('//')) {
            return 'https:' + urlStr;
        }
        if (urlStr.startsWith('/')) {
            return new URL(urlStr, baseUrl).href;
        }
        if (!urlStr.startsWith('http')) {
            return new URL(urlStr, baseUrl).href;
        }
        return urlStr;
    } catch {
        return null;
    }
}

function getDomain(url) {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return url;
    }
}

function getUniqueDomainUrls(urls, max) {
    const seen = new Set();
    const unique = [];
    
    for (const url of urls) {
        const domain = getDomain(url);
        if (!seen.has(domain)) {
            seen.add(domain);
            unique.push(url);
            if (unique.length >= max) break;
        }
    }
    
    return unique;
}

function isValidProduct(product) {
    if (!product) return false;
    if (!product.title || product.title.length < 3) return false;
    if (!product.imageUrl) return false;
    if (!product.productUrl) return false;
    
    // Перевіряємо що URL валідний
    try {
        new URL(product.imageUrl);
        new URL(product.productUrl);
    } catch {
        return false;
    }
    
    return true;
}

// ============ GOOGLE SEARCH ============
async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    
    if (!key || !cx) {
        console.error('❌ Google API credentials missing');
        return [];
    }

    const query = `${keyword} buy`;
    
    const blocked = [
        'facebook.com', 'youtube.com', 'pinterest.com', 'instagram.com',
        'reddit.com', 'wikipedia.org', 'linkedin.com', 'twitter.com',
        'tiktok.com', 'amazon.com', 'ebay.com', 'gumtree.com.au'
    ];

    const fetchPage = async (start) => {
        try {
            const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
                params: {
                    key,
                    cx,
                    q: query,
                    num: 10,
                    start,
                    gl: 'au',
                    cr: 'countryAU'
                },
                timeout: 10000
            });
            return res.data.items || [];
        } catch (e) {
            console.error(`Google API error (start=${start}):`, e.message);
            return [];
        }
    };

    try {
        // Отримуємо 2 сторінки результатів
        const [page1, page2] = await Promise.all([
            fetchPage(1),
            fetchPage(11)
        ]);
        
        const allResults = [...page1, ...page2];
        
        return allResults
            .map(item => item.link)
            .filter(link => {
                if (!link) return false;
                const linkLower = link.toLowerCase();
                return !blocked.some(b => linkLower.includes(b));
            });

    } catch (e) {
        console.error('Google Search error:', e);
        return [];
    }
}

// ============ START SERVER ============
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📊 Config: ${CONCURRENCY} workers, ${PAGE_TIMEOUT}ms timeout, ${MAX_SITES} max sites`);
});
