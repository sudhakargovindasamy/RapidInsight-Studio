import React from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend
);

export default function TableBuildProgressChart({ tables = [] }) {
  const builtCount = tables.filter(
    (table) =>
      table.table_status === 'BUILT' ||
      table.status === 'CREATED' ||
      table.status === 'BUILT'
  ).length;

  const notBuiltCount = Math.max(tables.length - builtCount, 0);

  const data = {
    labels: ['Built', 'Not Built'],
    datasets: [
      {
        data: [builtCount, notBuiltCount]
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
      <h3>Table Build Status</h3>
      <Doughnut data={data} options={options} />
    </div>
  );
}
