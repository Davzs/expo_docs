/**
 * @fileoverview Output handlers for generating markdown files from crawled content
 * @description Provides multiple output formats: single file, multi-file, and structured
 * @module output
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Formats a date as YYYY-MM-DD
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

/**
 * Generates YAML frontmatter for a markdown file
 * @param {Object} metadata - Page metadata
 * @returns {string} YAML frontmatter block
 */
function generateFrontmatter(metadata) {
    const lines = ['---'];
    
    if (metadata.title) {
        lines.push(`title: "${metadata.title.replace(/"/g, '\\"')}"`);
    }
    if (metadata.url) {
        lines.push(`source: "${metadata.url}"`);
    }
    if (metadata.description) {
        lines.push(`description: "${metadata.description.replace(/"/g, '\\"').substring(0, 200)}"`);
    }
    if (metadata.crawledAt) {
        lines.push(`crawled_at: "${metadata.crawledAt}"`);
    }
    
    lines.push('---');
    return lines.join('\n');
}

/**
 * Generates a single consolidated markdown file
 * @param {Object} crawlData - Data from the crawler
 * @param {string} outputPath - Output file path
 * @returns {Promise<Object>} Output statistics
 */
async function generateSingleFile(crawlData, outputPath) {
    const { domain, startUrl, pages, stats } = crawlData;
    const lines = [];

    // Header
    lines.push(`# ${domain} Documentation`);
    lines.push('');
    lines.push(`> AI-ready documentation generated from [${startUrl}](${startUrl})`);
    lines.push(`> Generated on: ${formatDate(new Date())}`);
    lines.push(`> Total pages: ${pages.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Table of Contents
    lines.push('## Table of Contents');
    lines.push('');
    pages.forEach((page, index) => {
        const indent = '  '.repeat(Math.min(page.depth, 3));
        const anchor = page.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        lines.push(`${indent}- [${page.metadata.title}](#${anchor})`);
    });
    lines.push('');
    lines.push('---');
    lines.push('');

    // Content
    for (const page of pages) {
        // Section header with anchor
        lines.push(`## ${page.metadata.title}`);
        lines.push('');
        lines.push(`> Source: ${page.metadata.url}`);
        lines.push('');
        lines.push(page.content);
        lines.push('');
        lines.push('---');
        lines.push('');
    }

    const content = lines.join('\n');
    
    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content, 'utf-8');

    const fileSizeBytes = Buffer.byteLength(content, 'utf-8');
    
    return {
        type: 'single',
        outputPath,
        fileCount: 1,
        totalSize: fileSizeBytes,
        totalSizeFormatted: formatSize(fileSizeBytes),
    };
}

/**
 * Generates multiple markdown files in a directory structure
 * @param {Object} crawlData - Data from the crawler
 * @param {string} outputDir - Output directory path
 * @param {Object} options - Output options
 * @returns {Promise<Object>} Output statistics
 */
async function generateMultiFile(crawlData, outputDir, options = {}) {
    const { domain, startUrl, pages, stats } = crawlData;
    const includeFrontmatter = options.frontmatter !== false;
    
    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    let totalSize = 0;
    const files = [];

    // Generate individual files
    for (const page of pages) {
        const filename = `${page.slug}.md`;
        const filepath = path.join(outputDir, filename);
        
        const lines = [];
        
        if (includeFrontmatter) {
            lines.push(generateFrontmatter(page.metadata));
            lines.push('');
        }
        
        lines.push(`# ${page.metadata.title}`);
        lines.push('');
        lines.push(page.content);
        
        const content = lines.join('\n');
        await fs.writeFile(filepath, content, 'utf-8');
        
        const fileSize = Buffer.byteLength(content, 'utf-8');
        totalSize += fileSize;
        files.push({ filename, size: fileSize });
    }

    // Generate index file
    const indexLines = [];
    indexLines.push(`# ${domain} Documentation Index`);
    indexLines.push('');
    indexLines.push(`> Generated from: ${startUrl}`);
    indexLines.push(`> Date: ${formatDate(new Date())}`);
    indexLines.push(`> Files: ${pages.length}`);
    indexLines.push('');
    indexLines.push('## Pages');
    indexLines.push('');

    // Group by depth for better organization
    const byDepth = {};
    pages.forEach(page => {
        const depth = page.depth || 0;
        if (!byDepth[depth]) byDepth[depth] = [];
        byDepth[depth].push(page);
    });

    Object.keys(byDepth).sort((a, b) => a - b).forEach(depth => {
        if (depth > 0) {
            indexLines.push(`### Depth ${depth}`);
            indexLines.push('');
        }
        byDepth[depth].forEach(page => {
            indexLines.push(`- [${page.metadata.title}](./${page.slug}.md)`);
        });
        indexLines.push('');
    });

    const indexContent = indexLines.join('\n');
    const indexPath = path.join(outputDir, 'README.md');
    await fs.writeFile(indexPath, indexContent, 'utf-8');
    totalSize += Buffer.byteLength(indexContent, 'utf-8');

    return {
        type: 'multi',
        outputPath: outputDir,
        fileCount: pages.length + 1,
        totalSize,
        totalSizeFormatted: formatSize(totalSize),
        files,
    };
}

/**
 * Generates structured output with metadata JSON and markdown files
 * @param {Object} crawlData - Data from the crawler  
 * @param {string} outputDir - Output directory path
 * @returns {Promise<Object>} Output statistics
 */
async function generateStructured(crawlData, outputDir) {
    const { domain, startUrl, pages, errors, stats } = crawlData;
    
    // Create directory structure
    const contentDir = path.join(outputDir, 'content');
    await fs.mkdir(contentDir, { recursive: true });

    let totalSize = 0;

    // Generate content files
    const manifest = {
        domain,
        startUrl,
        generatedAt: new Date().toISOString(),
        stats,
        pages: [],
    };

    for (const page of pages) {
        const filename = `${page.slug}.md`;
        const filepath = path.join(contentDir, filename);
        
        const lines = [];
        lines.push(generateFrontmatter(page.metadata));
        lines.push('');
        lines.push(`# ${page.metadata.title}`);
        lines.push('');
        lines.push(page.content);
        
        const content = lines.join('\n');
        await fs.writeFile(filepath, content, 'utf-8');
        
        const fileSize = Buffer.byteLength(content, 'utf-8');
        totalSize += fileSize;

        manifest.pages.push({
            slug: page.slug,
            title: page.metadata.title,
            url: page.metadata.url,
            depth: page.depth,
            file: `content/${filename}`,
            size: fileSize,
            wordCount: countWords(page.content),
        });
    }

    // Generate manifest
    const manifestPath = path.join(outputDir, 'manifest.json');
    const manifestContent = JSON.stringify(manifest, null, 2);
    await fs.writeFile(manifestPath, manifestContent, 'utf-8');
    totalSize += Buffer.byteLength(manifestContent, 'utf-8');

    // Generate errors log if any
    if (errors && errors.length > 0) {
        const errorsPath = path.join(outputDir, 'errors.json');
        const errorsContent = JSON.stringify(errors, null, 2);
        await fs.writeFile(errorsPath, errorsContent, 'utf-8');
        totalSize += Buffer.byteLength(errorsContent, 'utf-8');
    }

    // Generate combined file for AI consumption
    const combinedLines = [];
    combinedLines.push(`# ${domain} Documentation (Combined)`);
    combinedLines.push('');
    combinedLines.push(`> Source: ${startUrl}`);
    combinedLines.push(`> Generated: ${formatDate(new Date())}`);
    combinedLines.push(`> Pages: ${pages.length}`);
    combinedLines.push('');
    combinedLines.push('---');
    combinedLines.push('');

    for (const page of pages) {
        combinedLines.push(`## ${page.metadata.title}`);
        combinedLines.push('');
        combinedLines.push(`*Source: ${page.metadata.url}*`);
        combinedLines.push('');
        combinedLines.push(page.content);
        combinedLines.push('');
        combinedLines.push('---');
        combinedLines.push('');
    }

    const combinedPath = path.join(outputDir, 'combined.md');
    const combinedContent = combinedLines.join('\n');
    await fs.writeFile(combinedPath, combinedContent, 'utf-8');
    totalSize += Buffer.byteLength(combinedContent, 'utf-8');

    // Generate README
    const readmeLines = [];
    readmeLines.push(`# ${domain} Documentation`);
    readmeLines.push('');
    readmeLines.push('AI-ready documentation package.');
    readmeLines.push('');
    readmeLines.push('## Contents');
    readmeLines.push('');
    readmeLines.push('- `combined.md` - All documentation in a single file (best for AI context)');
    readmeLines.push('- `content/` - Individual markdown files for each page');
    readmeLines.push('- `manifest.json` - Metadata and page index');
    if (errors && errors.length > 0) {
        readmeLines.push('- `errors.json` - Crawl errors log');
    }
    readmeLines.push('');
    readmeLines.push('## Statistics');
    readmeLines.push('');
    readmeLines.push(`- **Pages:** ${pages.length}`);
    readmeLines.push(`- **Source:** ${startUrl}`);
    readmeLines.push(`- **Generated:** ${formatDate(new Date())}`);
    readmeLines.push('');
    readmeLines.push('## Usage with AI');
    readmeLines.push('');
    readmeLines.push('For best results with AI assistants:');
    readmeLines.push('');
    readmeLines.push('1. Use `combined.md` for comprehensive context');
    readmeLines.push('2. Reference specific pages from `content/` for focused queries');
    readmeLines.push('3. Use `manifest.json` to build custom document sets');
    readmeLines.push('');

    const readmePath = path.join(outputDir, 'README.md');
    const readmeContent = readmeLines.join('\n');
    await fs.writeFile(readmePath, readmeContent, 'utf-8');
    totalSize += Buffer.byteLength(readmeContent, 'utf-8');

    return {
        type: 'structured',
        outputPath: outputDir,
        fileCount: pages.length + 4 + (errors?.length > 0 ? 1 : 0),
        totalSize,
        totalSizeFormatted: formatSize(totalSize),
        manifest,
    };
}

/**
 * Counts words in a text
 * @param {string} text - Text to count words in
 * @returns {number} Word count
 */
function countWords(text) {
    return text.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Formats a byte size to human readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

module.exports = {
    generateSingleFile,
    generateMultiFile,
    generateStructured,
    generateFrontmatter,
    formatSize,
    countWords,
};
