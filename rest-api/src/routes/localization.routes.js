const express = require('express');
const router = express.Router({ caseSensitive: false });
const localizationController = require('../controllers/localization.controller');
const { validate } = require('../middleware/validator');

router.get(
  '/localization/labels',
  validate('localizationLabels'),
  localizationController.labels
);

module.exports = router;
