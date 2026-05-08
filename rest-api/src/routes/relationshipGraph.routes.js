const express = require('express');
const router = express.Router({ caseSensitive: false });
const controller = require('../controllers/relationshipGraph.controller');
const { validate } = require('../middleware/validator');

/**
 * Relationship Graph Routes
 * GET /api/relationship-graph/:fileName
 */
router.get(
  '/relationship-graph/:fileName',
  validate('relationshipGraph'),
  controller.getGraph
);

module.exports = router;
