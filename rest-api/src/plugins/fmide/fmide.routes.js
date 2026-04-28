const express = require('express');
const router = express.Router({ caseSensitive: false });
const controller = require('./fmide.controller');

/**
 * fmIDE Plugin Routes
 * Mounted at /api/fmide by the plugin loader
 */

// GET /api/fmide/uri?uuid=...  — Thingamajig URI + fmp URL
router.get('/uri', controller.uri);

// GET /api/fmide/goto?uuid=... — 302 redirect to fmp:// URL
router.get('/goto', controller.goto);

// GET /api/fmide/config         — Current configuration
router.get('/config', controller.getConfig);

// PUT /api/fmide/config         — Update config in memory
router.put('/config', express.json(), controller.putConfig);

module.exports = router;
