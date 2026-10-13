const express = require('express');

const app = express();
const PORT = process.env.EXPORT_SERVICE_PORT || 3009;

app.get('/health', (req, res) => {
  res.json({
    service: 'export-service',
    status: 'ok'
  });
});

app.listen(PORT, () => {
  console.log(`export-service running on port ${PORT}`);
});