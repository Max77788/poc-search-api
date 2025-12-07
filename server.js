async function googleSearch(keyword) {
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    
    console.log('========== GOOGLE SEARCH DEBUG ==========');
    console.log('Keyword:', keyword);
    console.log('API Key exists:', !!key);
    console.log('API Key length:', key ? key.length : 0);
    console.log('CX exists:', !!cx);
    console.log('CX value:', cx);
    
    if (!key || !cx) {
        console.error('❌ Missing API credentials!');
        console.log('Check .env file has:');
        console.log('GOOGLE_API_KEY=your_key');
        console.log('GOOGLE_CX=your_cx');
        return [];
    }
    
    const fetchPage = async (start) => {
        const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(keyword)}&num=10&start=${start}`;
        
        console.log(`\n📡 REQUEST to Google:`);
        console.log(`URL: ${url.replace(key, 'KEY_HIDDEN')}`);
        
        try {
            const res = await axios.get(url);
            
            console.log(`✅ Response status: ${res.status}`);
            console.log(`Items returned: ${res.data.items?.length || 0}`);
            
            if (res.data.items && res.data.items.length > 0) {
                console.log(`First result: ${res.data.items[0].link}`);
            }
            
            if (res.data.searchInformation) {
                console.log(`Total results available: ${res.data.searchInformation.totalResults}`);
            }
            
            return res.data.items || [];
        } catch (e) {
            console.error(`\n❌ GOOGLE API ERROR:`);
            
            if (e.response) {
                console.error(`Status: ${e.response.status}`);
                console.error(`Error details:`, JSON.stringify(e.response.data, null, 2));
                
                if (e.response.status === 403) {
                    console.error('\n⚠️ ERROR 403 - Possible reasons:');
                    console.error('1. API key is invalid');
                    console.error('2. Custom Search API not enabled in Google Console');
                    console.error('3. Billing not set up');
                    console.error('Go to: https://console.cloud.google.com/apis/library/customsearch.googleapis.com');
                }
                
                if (e.response.status === 429) {
                    console.error('\n⚠️ ERROR 429 - Rate limit exceeded');
                    console.error('Daily quota: 100 searches/day (free tier)');
                }
            } else {
                console.error(`Network error:`, e.message);
            }
            
            return [];
        }
    };

    try {
        console.log(`\n🔎 Searching Google for: "${keyword}"`);
        
        const page1 = await fetchPage(1);
        
        if (page1.length === 0) {
            console.error('\n❌ Page 1 returned 0 results. Stopping.');
            console.log('\n🔧 TROUBLESHOOTING:');
            console.log('1. Test your API manually:');
            console.log(`   https://www.googleapis.com/customsearch/v1?key=YOUR_KEY&cx=${cx}&q=test`);
            console.log('2. Check Custom Search Engine settings:');
            console.log('   https://programmablesearchengine.google.com/');
            console.log('3. Verify API is enabled:');
            console.log('   https://console.cloud.google.com/apis/library/customsearch.googleapis.com');
            return [];
        }
        
        const page2 = await fetchPage(11);
        
        let results = [...page1, ...page2];
        console.log(`\n📊 Total from Google: ${results.length} results`);
        
        const blocked = ['facebook.com', 'youtube.com', 'pinterest.com', 'instagram.com', 'reddit.com', 'wikipedia.org'];
        
        const validUrls = results
            .map(i => i.link)
            .filter(link => {
                const isBlocked = blocked.some(b => link.includes(b));
                if (isBlocked) {
                    console.log(`🚫 Blocked: ${link}`);
                }
                return !isBlocked;
            });
        
        console.log(`\n✅ Valid sites after filtering: ${validUrls.length}`);
        
        if (validUrls.length > 0) {
            console.log('\n📋 Sample results:');
            validUrls.slice(0, 5).forEach((url, i) => {
                console.log(`  ${i + 1}. ${url}`);
            });
        }
        
        console.log('========== END DEBUG ==========\n');
        
        return validUrls;
            
    } catch (e) {
        console.error('❌ Fatal error:', e.message);
        return [];
    }
}
