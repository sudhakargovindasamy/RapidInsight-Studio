// The blueprint contract gives dashboard objects a short "name" and no prose.
// The report UI renders a title, a description and axis labels, so build plain
// language for each object here rather than showing raw column identifiers.

const OPERATION_NOUNS = Object.freeze({
  sum: 'Total',
  avg: 'Average',
  count: 'Number of records',
  min: 'Lowest',
  max: 'Highest'
});

const SORT_PHRASES = Object.freeze({
  desc: 'highest to lowest',
  asc: 'lowest to highest'
});

const TIME_BUCKET_PHRASES = Object.freeze({
  hour: 'by hour',
  day: 'by day',
  week: 'by week',
  month: 'by month',
  quarter: 'by quarter',
  year: 'by year'
});

// order_id -> "Order Id", analysis_item_level_sales -> "Analysis Item Level Sales"
function humanize(identifier) {
  const cleaned = String(identifier || '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  return cleaned
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// What the aggregated number represents, e.g. "Total Item Total", or for a
// ratio measure "Estimated Profit Amount as % of Item Total".
function buildMeasureLabel(item) {
  const operation = String(item?.operation || '').toLowerCase();

  if (item?.ratio && nonEmpty(item?.column) && nonEmpty(item.ratio.column)) {
    const numerator = humanize(item.column);
    const denominator = humanize(item.ratio.column);
    const asPercent = Number(item.ratio.scale) === 100;

    return asPercent
      ? `${numerator} as % of ${denominator}`
      : `${numerator} per ${denominator}`;
  }

  // Without this, a difference measure falls through to the plain operation
  // noun and is labelled after only one of its two columns, e.g. "Total Unit
  // Price" for what is actually unit price minus cost price.
  if (item?.difference && nonEmpty(item?.column) && nonEmpty(item.difference.column)) {
    const minuend = humanize(item.column);
    const subtrahend = humanize(item.difference.column);

    if (item.difference.as_percentage) {
      return `${minuend} minus ${subtrahend}, as % of ${minuend}`;
    }

    const noun = OPERATION_NOUNS[operation] || humanize(operation);
    const measure = `${minuend} minus ${subtrahend}`;

    return item.difference.is_date_difference
      ? `${noun} Days from ${subtrahend} to ${minuend}`.trim()
      : `${noun} ${measure}`.trim();
  }

  if (operation === 'count' || !nonEmpty(item?.column)) {
    return OPERATION_NOUNS.count;
  }

  const noun = OPERATION_NOUNS[operation] || humanize(operation);
  return `${noun} ${humanize(item.column)}`.trim();
}

function buildGroupLabel(item) {
  return humanize(item?.group_by) || 'Category';
}

function resolveTableLabel(item) {
  const tableName =
    item?.resolvedTable?.blueprintTable?.table_name || item?.table_name;
  return humanize(tableName);
}

function buildKpiLabels(metric) {
  const measureLabel = buildMeasureLabel(metric);
  const title = nonEmpty(metric?.name) ? metric.name : measureLabel;
  const tableLabel = resolveTableLabel(metric);
  const operation = String(metric?.operation || '').toLowerCase();

  if (metric?.ratio && nonEmpty(metric?.column) && nonEmpty(metric.ratio.column)) {
    const numerator = humanize(metric.column);
    const denominator = humanize(metric.ratio.column);
    const suffix = tableLabel ? ` in ${tableLabel}` : '';

    return {
      title,
      description: `${numerator} divided by ${denominator}${suffix}${
        Number(metric.ratio.scale) === 100 ? ', shown as a percentage' : ''
      }.`,
      measureLabel
    };
  }

  if (metric?.difference && nonEmpty(metric?.column) && nonEmpty(metric.difference.column)) {
    const minuend = humanize(metric.column);
    const subtrahend = humanize(metric.difference.column);
    const suffix = tableLabel ? ` in ${tableLabel}` : '';

    let description;

    if (metric.difference.as_percentage) {
      description = `${minuend} minus ${subtrahend}, as a percentage of ${minuend}${suffix}.`;
    } else if (metric.difference.is_date_difference) {
      description = `Days between ${subtrahend} and ${minuend}${suffix}.`;
    } else {
      description = `${minuend} minus ${subtrahend}${suffix}.`;
    }

    return { title, description, measureLabel };
  }

  if (operation === 'count' || !nonEmpty(metric?.column)) {
    return {
      title,
      description: tableLabel
        ? `Number of records in ${tableLabel}.`
        : 'Number of records.',
      measureLabel
    };
  }

  const phrase = OPERATION_NOUNS[operation] || humanize(operation) || 'Value';
  const subject = humanize(metric.column);

  const description = tableLabel
    ? `${phrase} of ${subject} across ${tableLabel}.`
    : `${phrase} of ${subject}.`;

  return { title, description, measureLabel };
}

function buildChartLabels(chart) {
  const measureLabel = buildMeasureLabel(chart);
  const groupLabel = buildGroupLabel(chart);
  const title = nonEmpty(chart?.name)
    ? chart.name
    : `${measureLabel} by ${groupLabel}`;

  const sentence = [`${measureLabel} for each ${groupLabel}`];

  const timeBucket = TIME_BUCKET_PHRASES[String(chart?.time_bucket || '').toLowerCase()];
  if (timeBucket) sentence.push(timeBucket);

  const sortPhrase = SORT_PHRASES[String(chart?.sort || '').toLowerCase()];
  if (sortPhrase) sentence.push(`sorted ${sortPhrase}`);

  if (Number.isInteger(chart?.limit) && chart.limit > 0) {
    sentence.push(`showing the top ${chart.limit}`);
  }

  return {
    title,
    description: `${sentence.join(', ')}.`,
    measureLabel,
    groupLabel
  };
}

module.exports = {
  humanize,
  buildKpiLabels,
  buildChartLabels
};
