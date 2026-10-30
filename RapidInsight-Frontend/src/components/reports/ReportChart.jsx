import { useState } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip
} from 'chart.js';
import { Bar, Doughnut, Line, Pie } from 'react-chartjs-2';
import './ReportChart.css';

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip
);

const CHART_COLORS = [
  '#8b73dc',
  '#b283f5',
  '#5c7cfa',
  '#48c78e',
  '#e8a64a',
  '#ef7182',
  '#22b8cf',
  '#a7c957',
  '#f08c46',
  '#7c83fd'
];

function cssVariable(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const value = window
    .getComputedStyle(document.body)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function selectChart(type) {
  if (type === 'line') return Line;
  if (type === 'pie') return Pie;
  if (type === 'doughnut') return Doughnut;
  return Bar;
}

function formatChartValue(value, format) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) return value ?? '—';

  if (format === 'currency') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2
    }).format(numericValue);
  }

  // Values arrive already scaled to percent units (ratio measures use scale 100).
  if (format === 'percentage') {
    return `${new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 2
    }).format(numericValue)}%`;
  }

  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2
  }).format(numericValue);
}

function formatTitleWords(str) {
  if (!str) return '';
  return str
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveChartAxisLabels(item) {
  let group = (item.group_label || '').trim();
  let measure = (item.measure_label || '').trim();

  const isGenericGroup = !group || /^(label|category|group|dimension|x)$/i.test(group);
  const isGenericMeasure = !measure || /^(value|metric|val|measure|y)$/i.test(measure);

  if (isGenericGroup || isGenericMeasure) {
    const rawTitle = (item.title || item.request || item.label || '').trim();
    const splitMatch = rawTitle.match(/^(.+?)\s+(?:by|per|across|vs|for each)\s+(.+)$/i);
    if (splitMatch) {
      const part1 = formatTitleWords(splitMatch[1]);
      const part2 = formatTitleWords(splitMatch[2]);

      const measureKeywords = /\b(count|sum|avg|average|total|number|rate|ratio|percentage|percent|margin|amount|performance|score|revenue|sales|profit|price|cost|growth|index|stat|statistics|metric|value)\b/i;
      const dimensionKeywords = /\b(name|district|city|state|country|region|college|school|category|type|status|dept|department|group|year|month|date|day|quarter|code|gender|id|class)\b/i;

      let candidateGroup = '';
      let candidateMeasure = '';

      if (measureKeywords.test(part1) && !measureKeywords.test(part2)) {
        candidateMeasure = part1;
        candidateGroup = part2;
      } else if (dimensionKeywords.test(part1) && !dimensionKeywords.test(part2)) {
        candidateGroup = part1;
        candidateMeasure = part2;
      } else if (measureKeywords.test(part2) && !measureKeywords.test(part1)) {
        candidateGroup = part1;
        candidateMeasure = part2;
      } else {
        candidateMeasure = part1;
        candidateGroup = part2;
      }

      if (isGenericGroup && candidateGroup) group = candidateGroup;
      if (isGenericMeasure && candidateMeasure) measure = candidateMeasure;
    } else if (rawTitle) {
      if (isGenericMeasure && !isGenericGroup) measure = formatTitleWords(rawTitle);
      else if (isGenericGroup && !isGenericMeasure) group = formatTitleWords(rawTitle);
      else if (isGenericGroup && isGenericMeasure) {
        measure = formatTitleWords(rawTitle);
        group = 'Category';
      }
    }
  }

  if (!group || /^(label|x)$/i.test(group)) group = 'Category';
  if (!measure || /^(value|y)$/i.test(measure)) measure = 'Value';

  return { groupLabel: group, measureLabel: measure };
}

export default function ReportChart({ item }) {
  const isCircular = item.type === 'pie' || item.type === 'doughnut';
  const isLine = item.type === 'line';
  const isBar = !isCircular && !isLine;

  // Toggle state: 'x' for vertical bars, 'y' for horizontal bars
  const [orientation, setOrientation] = useState(() => (item.type === 'horizontal_bar' ? 'y' : 'x'));
  const isHorizontal = isBar && orientation === 'y';

  const ChartComponent = selectChart(item.type);
  const labels = Array.isArray(item.labels) ? item.labels : [];
  const values = Array.isArray(item.values) ? item.values : [];
  const { groupLabel, measureLabel } = resolveChartAxisLabels(item);
  const heading = item.title || measureLabel;
  const primary = cssVariable('--schema-primary', '#8b73dc');
  const muted = cssVariable('--text-muted', '#8d93a1');
  const border = cssVariable('--border-color', 'rgba(148, 163, 184, 0.22)');

  const data = {
    labels,
    datasets: [
      {
        label: measureLabel,
        data: values,
        borderColor: isCircular ? cssVariable('--card-solid', '#11141a') : primary,
        backgroundColor: isCircular
          ? labels.map((_, index) => CHART_COLORS[index % CHART_COLORS.length])
          : isLine
            ? 'rgba(178, 131, 245, 0.16)'
            : 'rgba(139, 115, 220, 0.78)',
        borderWidth: isCircular ? 2 : 1.5,
        borderRadius: isBar
          ? isHorizontal
            ? { topRight: 6, bottomRight: 6, topLeft: 0, bottomLeft: 0 }
            : { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 }
          : 0,
        maxBarThickness: isBar ? (isHorizontal ? 26 : 38) : undefined,
        fill: isLine,
        pointBackgroundColor: primary,
        pointBorderColor: primary,
        pointRadius: isLine ? 3 : 0,
        tension: isLine ? 0.32 : 0
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: isHorizontal ? 'y' : 'x',
    animation: {
      duration: 550
    },
    plugins: {
      legend: {
        display: isCircular,
        position: 'bottom',
        labels: {
          color: muted,
          boxWidth: 10,
          boxHeight: 10,
          padding: 16,
          usePointStyle: true
        }
      },
      tooltip: {
        displayColors: true,
        padding: 12,
        callbacks: {
          title: (entries) => {
            const label = entries?.[0]?.label ?? '';
            return groupLabel ? `${groupLabel}: ${label}` : label;
          },
          label: (entry) => {
            const val = isHorizontal ? entry.parsed?.x : (entry.parsed?.y ?? entry.parsed);
            return ` ${measureLabel}: ${formatChartValue(val, item.format)}`;
          }
        }
      }
    },
    scales: isCircular
      ? undefined
      : isHorizontal
        ? {
            x: {
              beginAtZero: true,
              title: measureLabel
                ? { display: true, text: measureLabel, color: muted, font: { weight: '600' } }
                : { display: false },
              ticks: {
                color: muted,
                precision: 0,
                callback: (value) => formatChartValue(value, item.format)
              },
              grid: {
                color: border
              },
              border: {
                display: false
              }
            },
            y: {
              title: groupLabel
                ? { display: true, text: groupLabel, color: muted, font: { weight: '600' } }
                : { display: false },
              ticks: {
                color: muted,
                maxRotation: 0,
                minRotation: 0,
                autoSkip: false
              },
              grid: {
                display: false
              },
              border: {
                color: border
              }
            }
          }
        : {
            x: {
              title: groupLabel
                ? { display: true, text: groupLabel, color: muted, font: { weight: '600' } }
                : { display: false },
              ticks: {
                color: muted,
                maxRotation: 35,
                minRotation: 0
              },
              grid: {
                display: false
              },
              border: {
                color: border
              }
            },
            y: {
              beginAtZero: true,
              title: measureLabel
                ? { display: true, text: measureLabel, color: muted, font: { weight: '600' } }
                : { display: false },
              ticks: {
                color: muted,
                precision: 0,
                callback: (value) => formatChartValue(value, item.format)
              },
              grid: {
                color: border
              },
              border: {
                display: false
              }
            }
          }
  };

  return (
    <article className="report-chart-card">
      <header className="report-chart-card__header">
        <div>
          <h2>{heading}</h2>
          {item.description ? <p>{item.description}</p> : null}
        </div>
        {isBar ? (
          <button
            type="button"
            className="report-chart-card__type report-chart-card__type--interactive"
            onClick={() => setOrientation((prev) => (prev === 'x' ? 'y' : 'x'))}
            title={`Currently ${isHorizontal ? 'Horizontal' : 'Vertical'} Bar. Click to switch to ${isHorizontal ? 'Vertical' : 'Horizontal'} layout.`}
            aria-label={`Switch between vertical and horizontal layout`}
          >
            <span aria-hidden="true" style={{ fontSize: '11px' }}>{isHorizontal ? '⇄' : '⇅'}</span>
            <span>{isHorizontal ? 'Horizontal Bar' : 'Vertical Bar'}</span>
          </button>
        ) : (
          <span className="report-chart-card__type">{item.type || 'chart'}</span>
        )}
      </header>

      {labels.length ? (
        <div
          className="report-chart-card__canvas"
          style={{
            height: isHorizontal && labels.length > 8 ? `${Math.max(340, labels.length * 36)}px` : undefined,
            maxHeight: isHorizontal && labels.length > 8 ? '520px' : undefined,
            overflowY: isHorizontal && labels.length > 8 ? 'auto' : undefined
          }}
        >
          <ChartComponent data={data} options={options} />
        </div>
      ) : (
        <div className="report-chart-card__empty">No chart values are available.</div>
      )}
    </article>
  );
}
