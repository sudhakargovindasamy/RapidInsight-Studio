require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const verifyInternalRequest = require('./middlewares/verifyInternalRequest');
const projectRoutes = require('./routes/projectRoutes');

const app = express();
const PORT = process.env.PROJECT_SERVICE_PORT || 3007;

app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => {
  res.json({ success: true, service: 'project-service', status: 'healthy' });
});

app.use(verifyInternalRequest);
app.use(projectRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Project service route not found.' });
});

app.use((err, req, res, next) => {
  console.error('Project service error:', err);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal project service error.'
  });
});

app.listen(PORT, () => {
  console.log(`Project service running on port ${PORT}`);
});