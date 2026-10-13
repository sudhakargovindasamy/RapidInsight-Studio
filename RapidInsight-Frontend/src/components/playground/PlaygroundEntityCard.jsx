import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { getTableRows } from "../../api/tableApi";
import { getEntityStatus } from "../../utils/playgroundStatus";
import "./PlaygroundEntityCard.css";

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '');
}

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    return ["true", "1", "yes", "y"].includes(
      value.trim().toLowerCase()
    );
  }

  return false;
}

function getFieldConstraints(field, primaryKeyName, uniqueKeys = []) {
  const fieldName = normalizeName(field.name);
  const isPrimaryKey = toBoolean(
    field.primaryKey ??
    field.primary_key ??
    field.isPrimaryKey ??
    field.is_primary_key
  ) || (!!primaryKeyName && !!fieldName && fieldName === normalizeName(primaryKeyName));

  const generationStrategy = String(
    field.generation?.strategy ??
    field.generation_strategy ??
    field.strategy ??
    ""
  ).toLowerCase();

  const isIdentity = toBoolean(
    field.identity ??
    field.isIdentity ??
    field.is_identity ??
    field.autoIncrement ??
    field.auto_increment
  ) || [
    "identity",
    "incremental",
    "sequence",
    "serial",
    "bigserial",
    "smallserial"
  ].includes(generationStrategy);

  const isUniqueList = Array.isArray(uniqueKeys) ? uniqueKeys : [uniqueKeys];
  const isUnique = toBoolean(
    field.unique ??
    field.isUnique ??
    field.is_unique
  ) || (!!fieldName && isUniqueList.map(normalizeName).includes(fieldName));

  const isNonNullable =
    isPrimaryKey ||
    toBoolean(
      field.notNull ??
      field.not_null ??
      field.required ??
      field.isRequired ??
      field.is_required
    );

  return {
    isPrimaryKey,
    isIdentity,
    isUnique,
    isNonNullable
  };
}

function FieldSpecialIcons({ field, primaryKeyName, uniqueKeys }) {
  const {
    isPrimaryKey,
    isIdentity,
    isUnique
  } = getFieldConstraints(field, primaryKeyName, uniqueKeys);

  if (!isPrimaryKey && !isIdentity && !isUnique) return null;

  return (
    <span className="field-constraint-icons" aria-label="Special constraints">
      {isPrimaryKey && (
        <span
          className="field-constraint-icon field-constraint-icon--pk"
          title="Primary key"
          aria-label="Primary key"
        >
          <svg className="pk-icon-dark" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', verticalAlign: 'middle', marginTop: '-2px' }}>
            <path d="M15 13a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12.5 10.5 4 19v3h3v-2h2v-2h2l1.5-1.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor"/>
          </svg>
          <svg className="pk-icon-light" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'none', verticalAlign: 'middle', marginTop: '-2px' }}>
            <circle cx="12" cy="12" r="12" fill="#3B82F6"/>
            <path d="M16 6C14.3 6 13 7.3 13 9C13 9.6 13.2 10.1 13.5 10.6L7 17.1V19H8.9L10 17.9L11.1 19H13V17.1L15.4 14.7C15.9 14.9 16.4 15 17 15C18.7 15 20 13.7 20 12C20 10.3 18.7 9 17 9C16.4 9 15.9 9.1 15.4 9.4L16.5 8.3C16.8 8.6 17.3 8.6 17.6 8.3C17.9 8 17.9 7.5 17.6 7.2L16.8 6.4C16.6 6.2 16.3 6 16 6Z" fill="#FDE047"/>
            <path d="M17 11C16.4 11 16 10.6 16 10C16 9.4 16.4 9 17 9C17.6 9 18 9.4 18 10C18 10.6 17.6 11 17 11Z" fill="#3B82F6"/>
          </svg>
        </span>
      )}

      {isIdentity && (
        <span
          className="field-constraint-icon field-constraint-icon--identity"
          title="Identity"
          aria-label="Identity"
        >
          #
        </span>
      )}

      {isUnique && (
        <span
          className="field-constraint-icon field-constraint-icon--unique"
          title="Unique"
          aria-label="Unique"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', verticalAlign: 'middle', marginTop: '-2px' }}>
            <rect width="24" height="24" rx="4" fill="#647B8C" />
            <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4 M14 13.12c0 2.38 0 6.38-1 8.88 M17.29 21.02c.12-.6.43-2.3.5-3.02 M6 12a6 6 0 0 1 12 0 M6 16h.01 M18 16c.2-2 .131-5.354 0-6 M8.65 22c.21-.66.45-1.32.57-2 M9 6.8a6 6 0 0 1 9 5.2v2" stroke="black" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </span>
      )}
    </span>
  );
}

function FieldNullabilityIcon({ field, primaryKeyName, uniqueKeys }) {
  const { isNonNullable } = getFieldConstraints(field, primaryKeyName, uniqueKeys);

  return (
    <span className="field-constraint-icons" aria-label="Nullability constraint">
      <span
        className={[
          "field-constraint-icon",
          "field-constraint-icon--nullability",
          isNonNullable
            ? "field-constraint-icon--non-nullable"
            : "field-constraint-icon--nullable"
        ].join(" ")}
        title={isNonNullable ? "Non-nullable" : "Nullable"}
        aria-label={isNonNullable ? "Non-nullable" : "Nullable"}
      >
        {isNonNullable ? "◆" : "◇"}
      </span>
    </span>
  );
}

export default function PlaygroundEntityCard({
  entity,
  position,
  dragBind,
  isGenerating,
  onGenerate,
  onViewTable,
}) {
  const status = getEntityStatus(entity, isGenerating);

  const eyeButtonRef = useRef(null);
  const closeTimerRef = useRef(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewError, setPreviewError] = useState('');
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({
    top: 0,
    left: 0,
    width: 520
  });

  const fields =
    entity.fields ||
    entity.schema_definition?.fields ||
    entity.schemaDefinition?.fields ||
    [];
  const visibleFields = fields.slice(0, 7);
  const rowCount = Number(entity.rowCount || 0);

  const entityId =
    entity.schema_id ||
    entity.schemaId ||
    entity.id;

  const hiddenSystemColumns = useMemo(
    () => new Set([
      '__ris_id',
      '__ris_generated_table_id',
      '__ris_created_by',
      '__ris_created_at'
    ]),
    []
  );

  const previewColumns = useMemo(() => {
    if (!previewRows.length) {
      return [];
    }

    return Object.keys(previewRows[0]).filter(
      (columnName) => !hiddenSystemColumns.has(columnName)
    );
  }, [hiddenSystemColumns, previewRows]);

  function cancelPreviewClose() {
    if (!closeTimerRef.current) {
      return;
    }

    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function schedulePreviewClose() {
    cancelPreviewClose();

    closeTimerRef.current = window.setTimeout(() => {
      setPreviewOpen(false);
      closeTimerRef.current = null;
    }, 180);
  }

  function updatePreviewPosition() {
    const button = eyeButtonRef.current;

    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportPadding = 16;
    const popupGap = 10;
    const popupHeight = 310;
    const popupWidth = Math.min(
      520,
      window.innerWidth - viewportPadding * 2
    );

    let left = rect.right - popupWidth;

    left = Math.max(
      viewportPadding,
      Math.min(
        left,
        window.innerWidth - popupWidth - viewportPadding
      )
    );

    let top = rect.bottom + popupGap;

    if (
      top + popupHeight >
      window.innerHeight - viewportPadding
    ) {
      top = rect.top - popupHeight - popupGap;
    }

    top = Math.max(viewportPadding, top);

    setPreviewPosition({
      top,
      left,
      width: popupWidth
    });
  }

  async function loadTablePreview() {
    if (
      previewLoaded ||
      previewLoading ||
      !entity.generatedTableId
    ) {
      return;
    }

    try {
      setPreviewLoading(true);
      setPreviewError('');

      const response = await getTableRows(
        entity.generatedTableId,
        1,
        5
      );

      const rows = response?.data || response?.rows || [];

      setPreviewRows(
        Array.isArray(rows) ? rows.slice(0, 5) : []
      );
      setPreviewLoaded(true);
    } catch (error) {
      setPreviewError(
        error?.message || 'Unable to load the table preview.'
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handlePreviewEnter() {
    cancelPreviewClose();
    updatePreviewPosition();
    setPreviewOpen(true);
    await loadTablePreview();
  }

  function handleEyeClick(event) {
    event.preventDefault();
    event.stopPropagation();

    cancelPreviewClose();
    setPreviewOpen(false);
    onViewTable?.();
  }

  useEffect(() => {
    if (!previewOpen) {
      return undefined;
    }

    const handleViewportChange = () => {
      updatePreviewPosition();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [previewOpen]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      <article
      className={`playground-entity playground-entity--${status.variant}`}
      data-playground-entity="true"
      data-entity-id={entity.schema_id || entityId}
      style={{
        transform: `translate3d(${position?.x || 0}px, ${position?.y || 0}px, 0)`,
        position: 'absolute',
      }}
    >
      <header className="entity-header" {...dragBind}>
        <div className="entity-header-title">
          <span className="entity-table-icon">⊞</span>
          <h3>
            {entity.tableName ||
              entity.original_name ||
              entity.name ||
              "Untitled"}
          </h3>

          {entity.tableType && (
            <span
              className={`entity-type-badge entity-type-badge--${entity.tableType.toLowerCase()}`}
              title={entity.tableType.toUpperCase()}
              aria-label={entity.tableType.toUpperCase()}
            >
              {entity.tableType.toLowerCase() === 'fact' ? 'ƒ' : '⬡'}
            </span>
          )}
        </div>

        <div className="entity-header-actions">

          <button
            ref={eyeButtonRef}
            type="button"
            className={[
              'entity-header-btn',
              'entity-view-btn',
              previewOpen ? 'entity-view-btn--active' : ''
            ].filter(Boolean).join(' ')}
            disabled={!entity.generatedTableId || rowCount === 0}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseEnter={handlePreviewEnter}
            onMouseLeave={schedulePreviewClose}
            onFocus={handlePreviewEnter}
            onBlur={schedulePreviewClose}
            onClick={handleEyeClick}
            title="Preview rows or click to open table"
            aria-label="Preview table rows"
            aria-expanded={previewOpen}
            aria-haspopup="dialog"
          >
            <img
              src="/eye-dark.png"
              alt="View Table"
              className="eye-png-dark"
            />

            <svg
              className="eye-svg-light"
              width="18"
              height="18"
              viewBox="0 0 100 100"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M 50 20 L 50 12" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <path d="M 35 25 L 25 15" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <path d="M 65 25 L 75 15" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <path d="M 50 80 L 50 88" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <path d="M 35 75 L 25 85" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <path d="M 65 75 L 75 85" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <path d="M 10 50 Q 50 20 90 50 Q 50 80 10 50 Z" fill="#F8D3B4" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
              <circle cx="50" cy="50" r="18" fill="#44D9E6" stroke="currentColor" strokeWidth="6" />
              <circle cx="50" cy="50" r="8" fill="#7C9CBF" stroke="currentColor" strokeWidth="6" />
            </svg>
          </button>
        </div>
      </header>

      <div className="entity-fields">
        {visibleFields.map((field, index) => (
          <div
            className="entity-field-row"
            key={`${field.name || "field"}-${index}`}
            data-field-name={normalizeName(field.name || `field_${index + 1}`)}
          >
            <div className="field-name-col">
              <FieldNullabilityIcon 
                field={field} 
                primaryKeyName={entity.primary_key || entity.primaryKey}
                uniqueKeys={entity.unique_keys || entity.uniqueKeys}
              />
              <span className="field-name">
                {field.name || `field_${index + 1}`}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FieldSpecialIcons 
                field={field} 
                primaryKeyName={entity.primary_key || entity.primaryKey}
                uniqueKeys={entity.unique_keys || entity.uniqueKeys}
              />
              <span className="field-type">
                {field.type || "text"}
              </span>
            </div>
          </div>
        ))}

        {fields.length > visibleFields.length ? (
          <div className="entity-field-row entity-field-row--more">
            +{fields.length - visibleFields.length} more fields
          </div>
        ) : null}
      </div>

      <footer className="entity-footer">
        <span className="entity-row-count">{rowCount} rows</span>
      </footer>
      </article>

      {previewOpen && createPortal(
        <section
          className="entity-table-preview"
          role="dialog"
          aria-label={`Table preview for ${
            entity.tableName || entity.name || 'generated table'
          }`}
          style={{
            top: `${previewPosition.top}px`,
            left: `${previewPosition.left}px`,
            width: `${previewPosition.width}px`
          }}
          onMouseEnter={cancelPreviewClose}
          onMouseLeave={schedulePreviewClose}
          onFocus={cancelPreviewClose}
          onBlur={schedulePreviewClose}
        >
          <header className="entity-table-preview__header">
            <div>
              <strong>
                {entity.tableName ||
                  entity.original_name ||
                  entity.name ||
                  'Table preview'}
              </strong>

              <span>First 5 of {rowCount} rows</span>
            </div>
          </header>

          {previewLoading ? (
            <div className="entity-table-preview__state">
              Loading table rows...
            </div>
          ) : previewError ? (
            <div className="entity-table-preview__state entity-table-preview__state--error">
              {previewError}
            </div>
          ) : previewRows.length === 0 ? (
            <div className="entity-table-preview__state">
              No table rows are available.
            </div>
          ) : (
            <div className="entity-table-preview__scroll">
              <table className="entity-table-preview__table">
                <thead>
                  <tr>
                    {previewColumns.map((columnName) => (
                      <th key={columnName}>{columnName}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {previewRows.map((row, rowIndex) => (
                    <tr
                      key={
                        row.__ris_id ||
                        `preview-row-${rowIndex}`
                      }
                    >
                      {previewColumns.map((columnName) => {
                        const value = row[columnName];

                        return (
                          <td key={columnName} title={String(value ?? 'NULL')}>
                            {value === null || value === undefined
                              ? 'NULL'
                              : typeof value === 'object'
                                ? JSON.stringify(value)
                                : String(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>,
        document.body
      )}
    </>
  );
}
