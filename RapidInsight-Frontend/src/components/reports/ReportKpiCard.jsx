import './ReportKpiCard.css';

function formatKpiValue(value, format) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return value ?? '—';
  }

  if (format === 'currency') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2
    }).format(numericValue);
  }

  // Percentage values arrive already scaled to percent units (a ratio measure
  // uses scale 100), so append the sign instead of guessing at the magnitude.
  if (format === 'percentage') {
    return `${new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 2
    }).format(numericValue)}%`;
  }

  if (format === 'decimal') {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(numericValue);
  }

  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0
  }).format(numericValue);
}

export default function ReportKpiCard({ item, index = 0 }) {
  return (
    <article
      className="report-kpi-card"
      style={{ '--report-card-index': index }}
    >
      <div className="report-kpi-card__top">
        <span className="report-kpi-card__icon" aria-hidden="true">
          {index % 3 === 0 ? '◆' : index % 3 === 1 ? '◫' : '●'}
        </span>
        <span className="report-kpi-card__label">
          {item.title || item.measure_label || 'Metric'}
        </span>
      </div>

      <strong className="report-kpi-card__value">
        {formatKpiValue(item.value, item.format)}
      </strong>

      {item.description ? (
        <p className="report-kpi-card__description">{item.description}</p>
      ) : null}
    </article>
  );
}
