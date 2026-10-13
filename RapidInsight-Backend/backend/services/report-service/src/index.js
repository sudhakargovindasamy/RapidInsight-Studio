const express = require('express');

const app = express();
const PORT = process.env.REPORT_SERVICE_PORT || 3004;

app.get('/health', (req, res) => {
  res.json({
    service: 'report-service',
    status: 'ok'
  });
});

app.listen(PORT, () => {
  console.log(`report-service running on port ${PORT}`);
});