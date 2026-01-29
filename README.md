# docs-to-md

**AI-ready documentation crawler** - Converts any website's documentation into clean, structured markdown files optimized for LLM consumption.

## Why Markdown for AI?

- **Native LLM format**: Language models parse markdown directly without conversion overhead
- **Lightweight**: Plain text is smaller and faster to process than binary formats like PDF
- **Preserves structure**: Headings, code blocks, lists, and tables remain semantically meaningful
- **Easy to chunk**: Ideal for RAG (Retrieval-Augmented Generation) systems
- **Version control friendly**: Track documentation changes with Git

## Features

- 🕷️ **Smart Crawling** - Automatic discovery of documentation pages with depth control
- 📝 **Clean Markdown** - HTML-to-Markdown conversion with GitHub Flavored Markdown support
- 🎯 **Flexible Filtering** - Include/exclude URL patterns to target specific sections
- � **Multiple Output Formats** - Single file, multi-file, or structured package
- 🔧 **Configurable Extraction** - Custom CSS selectors for content targeting
- � **Rich Metadata** - YAML frontmatter with title, source URL, and timestamps
- � **AI-Optimized** - Combined output file perfect for LLM context windows

## Installation

```bash
npm install
```

## Quick Start

```bash
# Crawl documentation with structured output (recommended)
npm run crawl -- --url https://docs.example.com

# Or run directly
node src/cli.js --url https://docs.example.com
```

## Usage

### Output Formats

#### Structured (Default) - Best for AI workflows
```bash
npm run crawl -- --url https://docs.example.com --format structured
```

Generates a complete documentation package:
```
example-docs/
├── README.md         # Usage instructions
├── combined.md       # All docs in one file (ideal for AI context)
├── manifest.json     # Metadata, page index, word counts
├── content/          # Individual markdown files
│   ├── getting-started.md
│   ├── api-reference.md
│   └── ...
└── errors.json       # Crawl errors (if any)
```

#### Single File - One consolidated document
```bash
npm run crawl -- --url https://docs.example.com --format single --output docs.md
```

#### Multi-File - Directory with individual pages
```bash
npm run crawl -- --url https://docs.example.com --format multi --output ./docs
```

### Filtering Content

#### Include specific sections only:
```bash
npm run crawl -- --url https://docs.example.com --include /api/ /guides/
```

#### Exclude certain sections:
```bash
npm run crawl -- --url https://docs.example.com --exclude /blog/ /changelog/ /forum/
```

### Advanced Options

```bash
# Limit crawl depth
npm run crawl -- --url https://docs.example.com --depth 3

# Custom content selector
npm run crawl -- --url https://docs.example.com --selector "article.docs-content"

# Adjust rate limiting
npm run crawl -- --url https://docs.example.com --wait 2000

# Enable verbose logging
npm run crawl -- --url https://docs.example.com --verbose

# Disable YAML frontmatter
npm run crawl -- --url https://docs.example.com --format multi --no-frontmatter
```

## Command Line Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--url` | `-u` | Starting URL to crawl (required) | - |
| `--output` | `-o` | Output path (file or directory) | `<domain>-docs[.md]` |
| `--format` | `-f` | Output format: `single`, `multi`, `structured` | `structured` |
| `--depth` | `-d` | Maximum crawl depth | `5` |
| `--include` | `-i` | URL patterns to include | `[]` |
| `--exclude` | `-e` | URL patterns to exclude | `[]` |
| `--selector` | `-s` | CSS selector for main content | auto-detect |
| `--wait` | `-w` | Delay between requests (ms) | `1000` |
| `--no-frontmatter` | | Disable YAML frontmatter | `false` |
| `--verbose` | `-v` | Enable detailed logging | `false` |

## Using with AI Assistants

### Claude / ChatGPT / Other LLMs

1. **Full Context**: Upload or paste `combined.md` for comprehensive documentation access
2. **Focused Queries**: Reference specific files from `content/` directory
3. **Programmatic Access**: Use `manifest.json` to build custom document sets

### RAG Systems

The structured output is designed for RAG workflows:
- `manifest.json` provides metadata for indexing
- Individual files in `content/` are pre-chunked by page
- Word counts help with token estimation

### Example Prompt

```
I've attached the documentation for [library]. Based on this context:
1. How do I implement [feature]?
2. What are the best practices for [topic]?
```

## Programmatic Usage

```javascript
const { DocsCrawler, generateStructured } = require('docs-to-md');

async function crawlDocs() {
    const crawler = new DocsCrawler({
        url: 'https://docs.example.com',
        depth: 3,
        include: ['/api/'],
    });

    const data = await crawler.crawl();
    await generateStructured(data, './output');
}

crawlDocs();
```

## How It Works

1. **Initialize** - Launches headless browser with Puppeteer
2. **Crawl** - Recursively discovers pages within the same domain
3. **Extract** - Removes navigation/headers, extracts main content
4. **Convert** - Transforms HTML to clean Markdown with Turndown
5. **Output** - Generates files in the selected format with metadata

## Requirements

- **Node.js** 16+
- **Chrome/Chromium** (automatically downloaded by Puppeteer)

## License

MIT