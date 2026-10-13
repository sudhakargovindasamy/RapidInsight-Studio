/**
 * Formats raw/physical database table names (e.g. 'colleges_db_df_ec5ba472ec' or 'performance_db_df')
 * into human-readable, professional display names (e.g. 'Colleges', 'Performance').
 */
export function formatTableDisplayName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'Untitled Table';

  // 1. Strip generated random hex hashes at the end (e.g. _ec5ba472ec, _89f931679b, _376a2c83ae)
  let clean = rawName.replace(/_[a-f0-9]{8,12}$/i, '');

  // 2. Strip common raw engineering/file suffixes like _db, _df, _rows, _data, _table
  clean = clean.replace(/(_db|_df|_rows|_data|_table)+$/i, '');

  // 3. Replace remaining underscores and hyphens with spaces
  clean = clean.replace(/[_-]+/g, ' ').trim();

  // 4. Capitalize each word (Title Case)
  clean = clean.replace(/\b[a-z]/g, (char) => char.toUpperCase());

  return clean || rawName;
}

export const formatTableName = formatTableDisplayName;
