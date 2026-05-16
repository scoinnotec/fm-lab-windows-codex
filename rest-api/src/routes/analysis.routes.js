const express = require('express');
const router = express.Router({ caseSensitive: false });
const analysisController = require('../controllers/analysis.controller');
const { validate } = require('../middleware/validator');

router.get(
  '/analysis/table-occurrences/usage/count',
  validate('tableOccurrenceUsageCount'),
  analysisController.tableOccurrenceUsageCount
);

router.get(
  '/analysis/table-occurrences/usage',
  validate('tableOccurrenceUsage'),
  analysisController.tableOccurrenceUsage
);

router.get(
  '/analysis/objects/usage/count',
  validate('objectUsageCount'),
  analysisController.objectUsageCount
);

router.get(
  '/analysis/objects/usage',
  validate('objectUsage'),
  analysisController.objectUsage
);

router.get(
  '/analysis/credentials/count',
  validate('credentialFindingsCount'),
  analysisController.credentialFindingsCount
);

router.get(
  '/analysis/credentials',
  validate('credentialFindings'),
  analysisController.credentialFindings
);

router.get(
  '/analysis/api-integrations/summary',
  validate('apiIntegrationSummary'),
  analysisController.apiIntegrationSummary
);

router.get(
  '/analysis/api-integrations/count',
  validate('apiIntegrationsCount'),
  analysisController.apiIntegrationsCount
);

router.get(
  '/analysis/api-integrations',
  validate('apiIntegrations'),
  analysisController.apiIntegrations
);

router.get(
  '/analysis/layout-objects/quality/count',
  validate('layoutObjectQualityCount'),
  analysisController.layoutObjectQualityCount
);

router.get(
  '/analysis/layout-objects/quality',
  validate('layoutObjectQuality'),
  analysisController.layoutObjectQuality
);

router.get(
  '/analysis/quality/dashboard',
  validate('qualityDashboard'),
  analysisController.qualityDashboard
);

router.get(
  '/analysis/quality/count',
  validate('qualityFindingsCount'),
  analysisController.qualityFindingsCount
);

router.get(
  '/analysis/quality',
  validate('qualityFindings'),
  analysisController.qualityFindings
);

module.exports = router;
