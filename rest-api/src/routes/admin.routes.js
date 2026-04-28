const express = require('express');
const router = express.Router({ caseSensitive: false });
const adminController = require('../controllers/admin.controller');

/**
 * Admin Routes
 * Endpoints for runtime administration of the API process.
 */

// POST /api/admin/reload - Re-open DuckDB connection from disk
router.post('/admin/reload', adminController.reload);

module.exports = router;
