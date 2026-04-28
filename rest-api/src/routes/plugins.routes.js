const express = require('express');
const router = express.Router({ caseSensitive: false });
const controller = require('../controllers/plugins.controller');

/**
 * Plugins Routes
 * Core endpoint (not plugin-provided) — must be mounted before loadPlugins().
 */

router.get('/plugins', controller.list);
router.get('/plugins/:name', controller.get);
router.patch('/plugins/:name', express.json(), controller.patch);

module.exports = router;
