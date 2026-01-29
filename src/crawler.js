/**
 * @fileoverview Core documentation crawler module
 * @description Crawls documentation websites and extracts content for AI-ready markdown output
 * @module crawler
 */

const puppeteer = require('puppeteer');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

/**
 * Documentation crawler class for extracting and converting web documentation to markdown
 * @class DocsCrawler
 */
class DocsCrawler {
    /**
     * Creates a new DocsCrawler instance
     * @param {Object} options - Crawler configuration options
     * @param {string} options.url - Starting URL to crawl
     * @param {string} [options.domain] - Domain to restrict crawling to
     * @param {number} [options.depth=5] - Maximum crawl depth
     * @param {string[]} [options.include=[]] - URL patterns to include
     * @param {string[]} [options.exclude=[]] - URL patterns to exclude
     * @param {string} [options.selector] - CSS selector for main content
     * @param {number} [options.wait=1000] - Wait time between requests in ms
     * @param {number} [options.concurrency=3] - Number of concurrent pages
     * @param {boolean} [options.verbose=false] - Enable verbose logging
     */
    constructor(options = {}) {
        this.startUrl = options.url;
        this.domain = options.domain || this.extractDomain(options.url);
        this.maxDepth = options.depth ?? 5;
        this.includePatterns = options.include || [];
        this.excludePatterns = options.exclude || [];
        this.selector = options.selector || 'main, article, .content, .documentation, .docs-content, [role="main"], body';
        this.waitTime = options.wait ?? 1000;
        this.concurrency = options.concurrency ?? 3;
        this.verbose = options.verbose ?? false;

        this.visitedUrls = new Set();
        this.urlQueue = [];
        this.urlDepthMap = new Map();
        this.results = [];
        this.errors = [];
        this.browser = null;

        this.turndown = this.initTurndown();
    }

    /**
     * Initializes and configures the Turndown service for HTML to Markdown conversion
     * @private
     * @returns {TurndownService} Configured Turndown instance
     */
    initTurndown() {
        const turndown = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            bulletListMarker: '-',
            emDelimiter: '*',
            strongDelimiter: '**',
            linkStyle: 'inlined',
            preformattedCode: true,
        });

        turndown.use(gfm);

        // Custom rule for code blocks with language detection
        turndown.addRule('codeBlocks', {
            filter: (node) => {
                return node.nodeName === 'PRE' && node.querySelector('code');
            },
            replacement: (content, node) => {
                const code = node.querySelector('code');
                const className = code?.className || '';
                const langMatch = className.match(/language-(\w+)|lang-(\w+)|(\w+)/);
                const language = langMatch ? (langMatch[1] || langMatch[2] || langMatch[3]) : '';
                const text = code?.textContent || content;
                return `\n\n\`\`\`${language}\n${text.trim()}\n\`\`\`\n\n`;
            }
        });

        // Custom rule for inline code
        turndown.addRule('inlineCode', {
            filter: (node) => {
                return node.nodeName === 'CODE' && 
                       node.parentNode?.nodeName !== 'PRE';
            },
            replacement: (content) => {
                if (!content.trim()) return '';
                const escaped = content.replace(/`/g, '\\`');
                return `\`${escaped}\``;
            }
        });

        // Remove script and style elements
        turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg']);

        return turndown;
    }

    /**
     * Extracts the domain name from a URL
     * @private
     * @param {string} url - URL to extract domain from
     * @returns {string} Extracted domain name
     */
    extractDomain(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace('www.', '');
        } catch {
            return 'documentation';
        }
    }

    /**
     * Logs a message if verbose mode is enabled
     * @private
     * @param {...any} args - Arguments to log
     */
    log(...args) {
        if (this.verbose) {
            console.log(...args);
        }
    }

    /**
     * Determines if a URL should be crawled based on configuration
     * @private
     * @param {string} url - URL to check
     * @returns {boolean} Whether the URL should be crawled
     */
    shouldCrawlUrl(url) {
        try {
            const urlObj = new URL(url);
            const startUrlObj = new URL(this.startUrl);

            // Must be same domain
            if (urlObj.hostname !== startUrlObj.hostname) {
                return false;
            }

            // Must match the path prefix from start URL
            // e.g., if startUrl is /docs/, only crawl URLs under /docs/
            const startPath = startUrlObj.pathname;
            if (startPath && startPath !== '/') {
                // Normalize paths for comparison
                const normalizedStartPath = startPath.endsWith('/') ? startPath : startPath + '/';
                const urlPath = urlObj.pathname;
                const normalizedUrlPath = urlPath.endsWith('/') ? urlPath : urlPath + '/';
                
                // URL must start with the same path prefix OR be exactly the start path
                if (!normalizedUrlPath.startsWith(normalizedStartPath) && 
                    urlPath !== startPath && 
                    normalizedUrlPath !== normalizedStartPath) {
                    return false;
                }
            }

            // Remove hash from URL for comparison
            const cleanUrl = url.split('#')[0];
            if (this.visitedUrls.has(cleanUrl)) {
                return false;
            }

            // Check include patterns
            if (this.includePatterns.length > 0) {
                const matchesInclude = this.includePatterns.some(pattern => 
                    url.includes(pattern)
                );
                if (!matchesInclude) return false;
            }

            // Check exclude patterns
            const matchesExclude = this.excludePatterns.some(pattern => 
                url.includes(pattern)
            );
            if (matchesExclude) return false;

            // Skip non-document URLs
            const invalidExtensions = [
                '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico',
                '.pdf', '.zip', '.tar', '.gz', '.rar',
                '.mp3', '.mp4', '.avi', '.mov', '.webm',
                '.css', '.js', '.json', '.xml', '.rss'
            ];
            const lowercaseUrl = url.toLowerCase();
            if (invalidExtensions.some(ext => lowercaseUrl.endsWith(ext))) {
                return false;
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Generates a safe filename from a URL
     * @param {string} url - URL to convert
     * @returns {string} Safe filename
     */
    urlToSlug(url) {
        try {
            const urlObj = new URL(url);
            let pathname = urlObj.pathname;
            
            // Remove leading/trailing slashes
            pathname = pathname.replace(/^\/|\/$/g, '');
            
            if (!pathname) {
                return 'index';
            }

            // Convert path to slug
            return pathname
                .replace(/\//g, '_')
                .replace(/[^a-zA-Z0-9_-]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
                .substring(0, 100);
        } catch {
            return 'page';
        }
    }

    /**
     * Extracts the page title from the document
     * @private
     * @param {import('puppeteer').Page} page - Puppeteer page instance
     * @returns {Promise<string>} Page title
     */
    async extractTitle(page) {
        return page.evaluate(() => {
            // Try various title sources
            const h1 = document.querySelector('h1');
            if (h1?.textContent?.trim()) {
                return h1.textContent.trim();
            }

            const title = document.querySelector('title');
            if (title?.textContent?.trim()) {
                return title.textContent.trim().split('|')[0].trim();
            }

            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle?.content) {
                return ogTitle.content;
            }

            return 'Untitled';
        });
    }

    /**
     * Extracts metadata from the page
     * @private
     * @param {import('puppeteer').Page} page - Puppeteer page instance
     * @param {string} url - Current page URL
     * @returns {Promise<Object>} Page metadata
     */
    async extractMetadata(page, url) {
        const metadata = await page.evaluate(() => {
            const getMeta = (name) => {
                const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                return el?.content || '';
            };

            return {
                description: getMeta('description') || getMeta('og:description'),
                keywords: getMeta('keywords'),
                author: getMeta('author'),
                lastModified: document.lastModified,
            };
        });

        const title = await this.extractTitle(page);

        return {
            title,
            url,
            crawledAt: new Date().toISOString(),
            ...metadata,
        };
    }

    /**
     * Extracts and converts page content to markdown
     * @private
     * @param {import('puppeteer').Page} page - Puppeteer page instance
     * @returns {Promise<string>} Markdown content
     */
    async extractContent(page) {
        const html = await page.evaluate((selector) => {
            // Remove unwanted elements before extraction
            const unwantedSelectors = [
                'nav', 'header', 'footer', 'aside',
                '.sidebar', '.navigation', '.nav', '.navbar',
                '.breadcrumb', '.breadcrumbs',
                '.toc', '.table-of-contents',
                '[class*="cookie"]', '[class*="banner"]',
                '[class*="popup"]', '[class*="modal"]',
                '[class*="advertisement"]', '[class*="ad-"]',
                '.edit-page', '.edit-on-github',
                '.page-nav', '.pagination',
                'script', 'style', 'noscript',
            ];

            unwantedSelectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => el.remove());
            });

            // Find main content
            const selectors = selector.split(',').map(s => s.trim());
            for (const sel of selectors) {
                const content = document.querySelector(sel);
                if (content && content.textContent.trim().length > 100) {
                    return content.innerHTML;
                }
            }

            // Fallback to body
            return document.body.innerHTML;
        }, this.selector);

        // Convert HTML to Markdown
        let markdown = this.turndown.turndown(html);

        // Clean up the markdown
        markdown = this.cleanMarkdown(markdown);

        return markdown;
    }

    /**
     * Cleans and normalizes markdown content
     * @private
     * @param {string} markdown - Raw markdown content
     * @returns {string} Cleaned markdown
     */
    cleanMarkdown(markdown) {
        return markdown
            // Remove excessive blank lines
            .replace(/\n{4,}/g, '\n\n\n')
            // Remove trailing whitespace from lines
            .replace(/[ \t]+$/gm, '')
            // Normalize line endings
            .replace(/\r\n/g, '\n')
            // Remove empty links
            .replace(/\[([^\]]*)\]\(\s*\)/g, '$1')
            // Fix broken markdown links
            .replace(/\]\s+\(/g, '](')
            // Remove zero-width characters
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            // Trim the content
            .trim();
    }

    /**
     * Extracts all valid links from the page with priority on navigation elements
     * MUST be called BEFORE extractContent which modifies the DOM
     * @private
     * @param {import('puppeteer').Page} page - Puppeteer page instance
     * @returns {Promise<string[]>} Array of valid URLs
     */
    async extractLinks(page) {
        const links = await page.evaluate(() => {
            const urls = new Set();
            
            // Priority selectors for documentation navigation (check these first)
            const navSelectors = [
                'nav a[href]',
                'aside a[href]',
                '.sidebar a[href]',
                '.navigation a[href]',
                '.nav a[href]',
                '.menu a[href]',
                '.toc a[href]',
                '.table-of-contents a[href]',
                '[class*="sidebar"] a[href]',
                '[class*="navigation"] a[href]',
                '[class*="menu"] a[href]',
                '[role="navigation"] a[href]',
                '[data-testid*="nav"] a[href]',
                '[data-testid*="sidebar"] a[href]',
            ];

            // Extract from navigation elements first
            navSelectors.forEach(selector => {
                try {
                    document.querySelectorAll(selector).forEach(anchor => {
                        const href = anchor.getAttribute('href');
                        if (href && 
                            !href.startsWith('#') && 
                            !href.startsWith('mailto:') && 
                            !href.startsWith('tel:') &&
                            !href.startsWith('javascript:')) {
                            try {
                                const absoluteUrl = new URL(href, window.location.href).href;
                                urls.add(absoluteUrl.split('#')[0]);
                            } catch {}
                        }
                    });
                } catch {}
            });

            // Then get all other links
            document.querySelectorAll('a[href]').forEach(anchor => {
                const href = anchor.getAttribute('href');
                if (href && 
                    !href.startsWith('#') && 
                    !href.startsWith('mailto:') && 
                    !href.startsWith('tel:') &&
                    !href.startsWith('javascript:')) {
                    try {
                        const absoluteUrl = new URL(href, window.location.href).href;
                        urls.add(absoluteUrl.split('#')[0]);
                    } catch {}
                }
            });

            return [...urls];
        });

        return links.filter(link => this.shouldCrawlUrl(link));
    }

    /**
     * Attempts to fetch and parse sitemap.xml for URL discovery
     * @private
     * @param {import('puppeteer').Page} page - Puppeteer page instance
     * @returns {Promise<string[]>} Array of URLs from sitemap
     */
    async fetchSitemap(page) {
        const sitemapUrls = [];
        const baseUrl = new URL(this.startUrl);
        const sitemapLocations = [
            `${baseUrl.origin}/sitemap.xml`,
            `${baseUrl.origin}/sitemap_index.xml`,
            `${baseUrl.origin}/sitemap/sitemap.xml`,
        ];

        for (const sitemapUrl of sitemapLocations) {
            try {
                const response = await page.goto(sitemapUrl, {
                    waitUntil: 'networkidle2',
                    timeout: 10000,
                });

                if (response && response.ok()) {
                    const content = await page.content();
                    
                    // Extract URLs from sitemap XML
                    const urlMatches = content.match(/<loc>([^<]+)<\/loc>/g);
                    if (urlMatches) {
                        urlMatches.forEach(match => {
                            const url = match.replace(/<\/?loc>/g, '').trim();
                            if (this.shouldCrawlUrl(url)) {
                                sitemapUrls.push(url);
                            }
                        });
                    }
                    
                    if (sitemapUrls.length > 0) {
                        this.log(`  📍 Found ${sitemapUrls.length} URLs in sitemap`);
                        break;
                    }
                }
            } catch {
                // Sitemap not found or error, continue
            }
        }

        return sitemapUrls;
    }

    /**
     * Processes a single page
     * @private
     * @param {import('puppeteer').Page} page - Puppeteer page instance
     * @param {string} url - URL to process
     * @param {number} depth - Current crawl depth
     * @returns {Promise<Object|null>} Processed page data or null on error
     */
    async processPage(page, url, depth) {
        try {
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000,
            });

            // Wait for content to be available
            await page.waitForSelector(this.selector.split(',')[0].trim(), {
                timeout: 5000,
            }).catch(() => {
                this.log(`  Primary selector not found, using fallback`);
            });

            // Extended delay for JavaScript-rendered navigation
            await new Promise(resolve => setTimeout(resolve, 1000));

            // IMPORTANT: Extract links FIRST before content extraction modifies DOM
            const links = await this.extractLinks(page);

            // Add new links to queue immediately
            links.forEach(link => {
                if (!this.visitedUrls.has(link) && 
                    !this.urlQueue.some(item => item.url === link)) {
                    this.urlQueue.push({ url: link, depth: depth + 1 });
                    this.urlDepthMap.set(link, depth + 1);
                }
            });

            // Now extract metadata and content (content extraction modifies DOM)
            const metadata = await this.extractMetadata(page, url);
            const content = await this.extractContent(page);

            return {
                slug: this.urlToSlug(url),
                metadata,
                content,
                depth,
                linksFound: links.length,
            };
        } catch (error) {
            this.errors.push({ url, error: error.message, depth });
            console.error(`  ✗ Error: ${error.message}`);
            return null;
        }
    }

    /**
     * Starts the crawling process
     * @returns {Promise<Object>} Crawl results including pages and statistics
     */
    async crawl() {
        console.log('\n🕷️  Documentation Crawler');
        console.log('─'.repeat(50));
        console.log(`📍 Start URL: ${this.startUrl}`);
        console.log(`🌐 Domain: ${this.domain}`);
        console.log(`📊 Max depth: ${this.maxDepth}`);
        console.log(`⏱️  Wait time: ${this.waitTime}ms`);
        if (this.includePatterns.length > 0) {
            console.log(`✅ Include: ${this.includePatterns.join(', ')}`);
        }
        if (this.excludePatterns.length > 0) {
            console.log(`❌ Exclude: ${this.excludePatterns.join(', ')}`);
        }
        console.log('─'.repeat(50));
        console.log('');

        // Initialize browser
        this.browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });

        const startTime = Date.now();

        // Try to fetch sitemap first for comprehensive URL discovery
        console.log('🔍 Discovering pages...');
        const sitemapPage = await this.browser.newPage();
        try {
            const sitemapUrls = await this.fetchSitemap(sitemapPage);
            if (sitemapUrls.length > 0) {
                console.log(`  📍 Found ${sitemapUrls.length} URLs in sitemap`);
                sitemapUrls.forEach(url => {
                    if (!this.visitedUrls.has(url) && !this.urlQueue.some(item => item.url === url)) {
                        this.urlQueue.push({ url, depth: 0 });
                        this.urlDepthMap.set(url, 0);
                    }
                });
            }
        } catch (e) {
            this.log('  No sitemap found, using link discovery');
        } finally {
            await sitemapPage.close();
        }

        // Always add start URL if not already in queue
        if (!this.urlQueue.some(item => item.url === this.startUrl)) {
            this.urlQueue.unshift({ url: this.startUrl, depth: 0 });
            this.urlDepthMap.set(this.startUrl, 0);
        }

        console.log(`  📋 Initial queue: ${this.urlQueue.length} URLs`);
        console.log('');

        try {
            while (this.urlQueue.length > 0) {
                const { url, depth } = this.urlQueue.shift();

                // Skip if already visited or exceeds depth
                const cleanUrl = url.split('#')[0];
                if (this.visitedUrls.has(cleanUrl) || depth > this.maxDepth) {
                    continue;
                }

                this.visitedUrls.add(cleanUrl);

                console.log(`[${this.results.length + 1}] [Depth ${depth}] ${url}`);

                const page = await this.browser.newPage();
                await page.setViewport({ width: 1280, height: 800 });

                try {
                    const result = await this.processPage(page, url, depth);
                    if (result) {
                        this.results.push(result);
                        console.log(`  ✓ ${result.metadata.title} (${result.linksFound} links)`);
                    }
                } finally {
                    await page.close();
                }

                // Rate limiting
                if (this.waitTime > 0 && this.urlQueue.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.waitTime));
                }
            }
        } finally {
            await this.browser.close();
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('');
        console.log('─'.repeat(50));
        console.log('📊 Crawl Summary');
        console.log('─'.repeat(50));
        console.log(`   Pages crawled: ${this.results.length}`);
        console.log(`   Errors: ${this.errors.length}`);
        console.log(`   Duration: ${duration}s`);
        console.log('');

        return {
            domain: this.domain,
            startUrl: this.startUrl,
            pages: this.results,
            errors: this.errors,
            stats: {
                totalPages: this.results.length,
                totalErrors: this.errors.length,
                duration: parseFloat(duration),
            },
        };
    }
}

module.exports = { DocsCrawler };
