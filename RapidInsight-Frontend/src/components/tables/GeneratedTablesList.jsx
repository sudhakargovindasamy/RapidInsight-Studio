import React from 'react';
import GeneratedTableCard from './GeneratedTableCard.jsx';

export default function GeneratedTablesList({ tables = [], loading, onRefresh }) {
  if (loading) {
    return (
      <div className="empty-state">
        Loading generated tables...
      </div>
    );
  }

  if (!tables.length) {
    return (
      <div className="empty-state">
        <p>No generated tables found yet.</p>
        <p>Build a table from a schema and generate data to see it here.</p>
      </div>
    );
  }

  return (
    <div className="generated-tables-grid">
      {tables.map((table) => (
        <GeneratedTableCard
          key={table.id}
          table={table}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}
