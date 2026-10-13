import React from 'react';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend
);

export default function GeneratedRowsChart({ tables = [] }) {
  const labels = tables.map(
    (table) => table.display_name || table.physical_table_name || 'Table'
  );

  const rowCounts = tables.map((table) => table.row_count || 0);

  const data = {
    labels,
    datasets: [
      {
        label: 'Generated Rows',
        data: rowCounts
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

  if (!tables.length) {
    return null;
  }

  return (
    <div className="chart-card">
      <h3>Generated Rows by Table</h3>
      <Bar data={data} options={options} />
    </div>
  );
}
