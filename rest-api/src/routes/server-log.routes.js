const express = require('express');
const router = express.Router({ caseSensitive: false });
const serverLogController = require('../controllers/server-log.controller');

router.get('/analysis/server-logs/top-calls/dashboard', serverLogController.topCallDashboard);
router.get('/analysis/server-logs/top-calls/wait-analysis', serverLogController.topCallWaitAnalysis);
router.get('/analysis/server-logs/top-calls/summary/count', serverLogController.topCallSummaryCount);
router.get('/analysis/server-logs/top-calls/summary', serverLogController.topCallSummary);
router.get('/analysis/server-logs/top-calls/count', serverLogController.topCallRowsCount);
router.get('/analysis/server-logs/top-calls', serverLogController.topCallRows);

module.exports = router;
