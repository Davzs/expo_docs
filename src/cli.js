#!/usr/bin/env node

/**
 * @fileoverview Command-line interface for the documentation crawler
 * @description Entry point for the docs-to-md CLI tool
 * @module cli
 */

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const path = require('path');
const fs = require('fs').promises;
const { DocsCrawler } = require('./crawler');
const { generateSingleFile, generateMultiFile, generateStructured, formatSize } = require('./output');

/**
 * Main CLI entry point
 */
async function main() {
    const argv = yargs(hideBin(process.argv))
        .usage('Usage: $0 --url <url> [options]')
        .option('url', {
            alias: 'u',
            describe: 'Starting URL to crawl',
            type: 'string',
            demandOption: true,
        })
        .option('output', {
            alias: 'o',
            describe: 'Output path (file or directory based on format)',
            type: 'string',
        })
        .option('format', {
            alias: 'f',
            describe: 'Output format',
            type: 'string',
            choices: ['single', 'multi', 'structured'],
            default: 'structured',
        })
        .option('depth', {
            alias: 'd',
            describe: 'Maximum crawl depth',
            type: 'number',
            default: 5,
        })
        .option('include', {
            alias: 'i',
            describe: 'URL patterns to include (can be used multiple times)',
            type: 'array',
            default: [],
        })
        .option('exclude', {
            alias: 'e',
            describe: 'URL patterns to exclude (can be used multiple times)',
            type: 'array',
            default: [],
        })
        .option('selector', {
            alias: 's',
            describe: 'CSS selector for main content',
            type: 'string',
        })
        .option('wait', {
            alias: 'w',
            describe: 'Wait time between batches (ms)',
            type: 'number',
            default: 200,
        })
        .option('concurrency', {
            alias: 'c',
            describe: 'Number of pages to crawl concurrently',
            type: 'number',
            default: 5,
        })
        .option('no-frontmatter', {
            describe: 'Disable YAML frontmatter in output files',
            type: 'boolean',
            default: false,
        })
        .option('verbose', {
            alias: 'v',
            describe: 'Enable verbose logging',
            type: 'boolean',
            default: false,
        })
        .example('$0 --url https://docs.example.com', 
            'Crawl docs and output structured markdown')
        .example('$0 --url https://docs.example.com --format single --output docs.md', 
            'Generate a single markdown file')
        .example('$0 --url https://docs.example.com --format multi --output ./docs', 
            'Generate multiple markdown files in a directory')
        .example('$0 --url https://docs.example.com --include /api/ /guides/', 
            'Only crawl URLs containing /api/ or /guides/')
        .example('$0 --url https://docs.example.com --exclude /blog/ /changelog/', 
            'Exclude blog and changelog pages')
        .example('$0 --url https://docs.example.com --depth 3', 
            'Limit crawl depth to 3 levels')
        .example('$0 --url https://docs.example.com --concurrency 10', 
            'Crawl 10 pages at a time for faster processing')
        .epilogue('Output Formats:\n' +
            '  single     - All content in one markdown file\n' +
            '  multi      - Separate markdown files with index\n' +
            '  structured - Full package with manifest and combined file (default)')
        .help()
        .argv;

    try {
        // Determine output path early for incremental saves
        let outputPath = argv.output;
        if (!outputPath) {
            const urlObj = new URL(argv.url);
            const domain = urlObj.hostname.replace(/[^a-zA-Z0-9-]/g, '-').replace('www-', '');
            if (argv.format === 'single') {
                outputPath = `${domain}-docs.md`;
            } else {
                outputPath = `${domain}-docs`;
            }
        }
        if (!path.isAbsolute(outputPath)) {
            outputPath = path.join(process.cwd(), outputPath);
        }

        // Create progress file path for incremental saves
        const progressFile = path.join(
            path.dirname(outputPath), 
            `.${path.basename(outputPath)}.progress.json`
        );

        // Track crawled pages for incremental saving
        let incrementalPages = [];
        let lastSaveTime = Date.now();
        const SAVE_INTERVAL_MS = 30000; // Save every 30 seconds

        // Incremental save function
        const saveProgress = async (pages, force = false) => {
            const now = Date.now();
            if (!force && now - lastSaveTime < SAVE_INTERVAL_MS) return;
            
            try {
                await fs.writeFile(progressFile, JSON.stringify({
                    url: argv.url,
                    savedAt: new Date().toISOString(),
                    pageCount: pages.length,
                    pages: pages,
                }, null, 2));
                lastSaveTime = now;
                if (argv.verbose) {
                    console.log(`  💾 Progress saved (${pages.length} pages)`);
                }
            } catch (e) {
                // Ignore save errors
            }
        };

        // Create crawler instance with incremental save callback
        const crawler = new DocsCrawler({
            url: argv.url,
            depth: argv.depth,
            include: argv.include,
            exclude: argv.exclude,
            selector: argv.selector,
            wait: argv.wait,
            concurrency: argv.concurrency,
            verbose: argv.verbose,
            onPageCrawled: async (page, totalCount) => {
                incrementalPages.push(page);
                await saveProgress(incrementalPages);
            },
        });

        // Run crawler
        const crawlData = await crawler.crawl();
        
        // Final progress save
        await saveProgress(crawlData.pages, true);

        if (crawlData.pages.length === 0) {
            console.error('❌ No pages were crawled successfully.');
            process.exit(1);
        }

        // Generate output
        console.log(`\n📝 Generating ${argv.format} output...`);

        let result;
        switch (argv.format) {
            case 'single':
                result = await generateSingleFile(crawlData, outputPath);
                break;
            case 'multi':
                result = await generateMultiFile(crawlData, outputPath, {
                    frontmatter: !argv.noFrontmatter,
                });
                break;
            case 'structured':
            default:
                result = await generateStructured(crawlData, outputPath);
                break;
        }

        // Success message
        console.log('');
        console.log('─'.repeat(50));
        console.log('✅ Output Generated Successfully');
        console.log('─'.repeat(50));
        console.log(`   Format: ${result.type}`);
        console.log(`   Location: ${result.outputPath}`);
        console.log(`   Files: ${result.fileCount}`);
        console.log(`   Total size: ${result.totalSizeFormatted}`);
        console.log('');

        if (argv.format === 'structured') {
            console.log('📁 Output contents:');
            console.log('   └── combined.md      (all docs in one file)');
            console.log('   └── content/         (individual pages)');
            console.log('   └── manifest.json    (metadata & index)');
            console.log('   └── README.md        (usage instructions)');
            console.log('');
        }

        console.log('🤖 Ready for AI consumption!');
        console.log('');

    } catch (error) {
        console.error('');
        console.error('❌ Error:', error.message);
        if (argv.verbose) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
