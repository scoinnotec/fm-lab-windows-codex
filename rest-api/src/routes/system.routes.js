const express = require('express');
const router = express.Router({ caseSensitive: false });
const systemController = require('../controllers/system.controller');
const { validate } = require('../middleware/validator');

/**
 * System Routes
 * Routes for system information endpoints
 */

// GET /api/version - API version and health
router.get('/version', systemController.version);

// GET /api/info - Solution information
router.get('/info', validate('info'), systemController.info);

module.exports = router;
