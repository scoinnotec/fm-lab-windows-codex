const express = require('express');
const router = express.Router({ caseSensitive: false });
const queryController = require('../controllers/query.controller');
const { validate } = require('../middleware/validator');

/**
 * Query & Report Routes
 * Template-based SQL execution endpoints
 */

// GET/POST /api/query - Execute custom SQL template
router.get('/query', validate('query', 'query'), queryController.executeQuery);
router.post('/query', validate('query', 'body'), queryController.executeQuery);

// GET/POST /api/report - Execute report template
router.get('/report', validate('report', 'query'), queryController.executeReport);
router.post('/report', validate('report', 'body'), queryController.executeReport);

// GET /api/query/list - List available custom templates
router.get('/query/list', queryController.listQueryTemplates);

// GET /api/report/list - List available report templates
router.get('/report/list', queryController.listReportTemplates);

module.exports = router;
