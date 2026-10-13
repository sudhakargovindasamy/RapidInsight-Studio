import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getTablesByProject } from '../api/tableApi.js';
import GeneratedTablesList from '../components/tables/GeneratedTablesList.jsx';
import GeneratedRowsChart from '../components/charts/GeneratedRowsChart.jsx';
import TableBuildProgressChart from '../components/charts/TableBuildProgressChart.jsx';

import './TablesPage.css';

export default function TablesPage() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project_id');

  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadTables() {
    try {
      setLoading(true);
      setError('');

      const response = await getTablesByProject(projectId);
      setTables(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load generated tables.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTables();
  }, [projectId]);

  const stats = useMemo(() => {
    const totalTables = tables.length;
    const totalRows = tables.reduce(
      (sum, table) => sum + Number(table.row_count || 0),
      0
    );

    return {
      totalTables,
      totalRows
    };
  }, [tables]);

  return (
    <div className="page-wrap tables-page">
      <section className="hero-card tables-hero">
        <span className="hero-kicker">Generated Tables</span>
        <h1>Your generated tables and synthetic data</h1>
        <p>
          View tables created from schemas, generate Faker.js data,
          and inspect inserted rows.
        </p>
      </section>

      <div className="tables-stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.totalTables}</div>
          <div className="stat-label">Generated Tables</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">{stats.totalRows}</div>
          <div className="stat-label">Generated Rows</div>
        </div>
      </div>

      {error && (
        <div className="error-box">
          {error}
        </div>
      )}

      <div className="tables-chart-grid">
        <TableBuildProgressChart tables={tables} />
        <GeneratedRowsChart tables={tables} />
      </div>

      <div className="tables-toolbar">
        <h2>Tables</h2>

        <button
          className="refresh-btn"
          onClick={loadTables}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <GeneratedTablesList
        tables={tables}
        loading={loading}
        onRefresh={loadTables}
      />
    </div>
  );
}
