/**
 * @fileoverview Main module exports for docs-to-md
 * @description Exposes crawler and output utilities for programmatic use
 * @module docs-to-md
 */

const { DocsCrawler } = require('./crawler');
const output = require('./output');

module.exports = {
    DocsCrawler,
    ...output,
};
