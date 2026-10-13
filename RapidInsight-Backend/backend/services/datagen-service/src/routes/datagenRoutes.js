const express = require('express');
const verifyInternalRequest = require('../middlewares/verifyInternalRequest');

const {
  generatePreview,
  generateData,
  generateRelationalData,
  sdvStatus
} = require('../controllers/datagenController');

const router = express.Router();

router.use(verifyInternalRequest);

router.post('/preview', generatePreview);
router.post('/generate', generateData);
router.post('/generate-relational', generateRelationalData);

// Whether the SDV sidecar is up. There is no fallback generator, so this is the
// difference between "will work" and "will fail once you press the button".
router.get('/sdv-status', sdvStatus);

module.exports = router;
