const serverLogService = require('../services/server-log.service');
const formatters = require('../formatters');
const { sendFormatted } = require('../utils/response-builder');

function readOptions(query) {
  return {
    q: query.q,
    file: query.file,
    objectType: query.object_type || query.type,
    matchedOnly: query.matched_only === '1' || query.matched_only === 'true',
    minElapsedMs: query.min_elapsed_ms,
    limit: query.limit,
    offset: query.offset,
  };
}

async function topCallDashboard(req, res, next) {
  try {
    const { format = 'json', meta, debug } = req.query;
    const result = await serverLogService.getTopCallDashboard();
    sendFormatted(res, formatters.format(result.data, format), format, meta ? result.meta : null, debug ? 'server-log-dashboard' : null);
  } catch (error) {
    next(error);
  }
}

async function topCallSummary(req, res, next) {
  try {
    const { format = 'json', meta, debug } = req.query;
    const options = readOptions(req.query);
    const result = await serverLogService.listTopCallSummary(options);
    sendFormatted(res, formatters.format(result.data, format), format, meta ? result.meta : null, debug ? 'server-log-top-call-summary' : null);
  } catch (error) {
    next(error);
  }
}

async function topCallSummaryCount(req, res, next) {
  try {
    const { format = 'json', meta, debug } = req.query;
    const result = await serverLogService.countTopCallSummary(readOptions(req.query));
    sendFormatted(res, formatters.format(result.data, format), format, meta ? result.meta : null, debug ? 'server-log-top-call-summary-count' : null);
  } catch (error) {
    next(error);
  }
}

async function topCallWaitAnalysis(req, res, next) {
  try {
    const { format = 'json', meta, debug } = req.query;
    const result = await serverLogService.getTopCallWaitAnalysis(readOptions(req.query));
    sendFormatted(res, formatters.format(result.data, format), format, meta ? result.meta : null, debug ? 'server-log-wait-analysis' : null);
  } catch (error) {
    next(error);
  }
}

async function topCallRows(req, res, next) {
  try {
    const { format = 'json', meta, debug } = req.query;
    const result = await serverLogService.listTopCallRows(readOptions(req.query));
    sendFormatted(res, formatters.format(result.data, format), format, meta ? result.meta : null, debug ? 'server-log-top-call-rows' : null);
  } catch (error) {
    next(error);
  }
}

async function topCallRowsCount(req, res, next) {
  try {
    const { format = 'json', meta, debug } = req.query;
    const result = await serverLogService.countTopCallRows(readOptions(req.query));
    sendFormatted(res, formatters.format(result.data, format), format, meta ? result.meta : null, debug ? 'server-log-top-call-rows-count' : null);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  topCallDashboard,
  topCallSummary,
  topCallSummaryCount,
  topCallWaitAnalysis,
  topCallRows,
  topCallRowsCount,
};
