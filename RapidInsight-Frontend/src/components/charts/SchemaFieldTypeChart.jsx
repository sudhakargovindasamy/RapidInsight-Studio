import React from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';
import { Pie } from 'react-chartjs-2';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend
);

export default function SchemaFieldTypeChart({ fieldTypes = {} }) {
  const labels = Object.keys(fieldTypes);
  const values = Object.values(fieldTypes);

  if (!labels.length) {
    return null;
  }

  const data = {
    labels,
    datasets: [
      {
        data: values
      }
    ]
  };

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'bottom'
      }
    }
  };

  return (
    <div className="chart-card">
      <h3>Schema Field Types</h3>
      <Pie data={data} options={options} />
    </div>
  );
}
