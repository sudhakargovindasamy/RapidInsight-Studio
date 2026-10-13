require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const datagenRoutes = require('./routes/datagenRoutes');

const app = express();

const PORT = process.env.DATAGEN_SERVICE_PORT || 3002;

app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'datagen-service',
    status: 'healthy',
  });
});

app.use('/datagen', datagenRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Datagen service route not found.',
  });
});

app.use((err, req, res, next) => {
  console.error('Datagen service error:', err);

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal datagen service error.',
  });
});

app.listen(PORT, () => {
  console.log(`Datagen service running on port ${PORT}`);
});
