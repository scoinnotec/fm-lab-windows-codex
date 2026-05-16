const localizationService = require('../services/localization.service');
const formatters = require('../formatters');
const { sendFormatted } = require('../utils/response-builder');

async function labels(req, res, next) {
  try {
    const {
      domain,
      language,
      format = 'json',
      meta,
      debug,
    } = req.query;

    const result = await localizationService.listLabels({
      domain,
      language,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `localization-labels domain=${domain || ''} language=${language || ''}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  labels,
};
