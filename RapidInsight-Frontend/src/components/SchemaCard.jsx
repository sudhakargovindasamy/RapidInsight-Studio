import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import {
  getGeneratedTableBySchema
} from '../api/tableApi';

import {
  getSchemaById
} from '../api/schemaApi';

import '../pages/ProjectWorkspacePage.css';

function extractSchemaAttributes(response, fallbackSchema) {
  const candidates = [
    response?.data?.schemaDefinition,
    response?.data?.schema_definition,

    response?.schemaDefinition,
    response?.schema_definition,

    response?.data?.schema?.schemaDefinition,
    response?.data?.schema?.schema_definition,

    response?.schema?.schemaDefinition,
    response?.schema?.schema_definition,

    response?.data,
    response,

    fallbackSchema?.schemaDefinition,
    fallbackSchema?.schema_definition,
    fallbackSchema
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (
      Array.isArray(candidate.fields) &&
      candidate.fields.length > 0
    ) {
      return candidate.fields;
    }

    if (
      Array.isArray(candidate.columns) &&
      candidate.columns.length > 0
    ) {
      return candidate.columns;
    }

    if (
      Array.isArray(candidate.attributes) &&
      candidate.attributes.length > 0
    ) {
      return candidate.attributes;
    }
  }

  return [];
}

export default function SchemaCard({
  schema,
  compact = false,
  onRequestDelete
}) {
  const navigate = useNavigate();

  const attributesButtonRef = useRef(null);
  const attributesPopupRef = useRef(null);
  const closeTimerRef = useRef(null);

  const [message, setMessage] = useState('');
  const [popupError, setPopupError] = useState('');
  const [generatedTable, setGeneratedTable] = useState(null);
  const [attributesOpen, setAttributesOpen] = useState(false);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [loadedSchema, setLoadedSchema] = useState(null);
  const [popupPosition, setPopupPosition] = useState({
    top: 0,
    left: 0,
    width: 340
  });

  const schemaId = schema.id || schema.schema_id;

  const isBuilt =
    schema.table_status === 'BUILT' ||
    schema.status === 'BUILT' ||
    schema.status === 'built' ||
    schema.status === 'table_created' ||
    Boolean(schema.generated_table_id) ||
    Boolean(schema.physical_table_name) ||
    Boolean(generatedTable?.id);

  const attributes = useMemo(
    () => extractSchemaAttributes(loadedSchema, schema),
    [loadedSchema, schema]
  );

  const fieldCount =
    schema.field_count ??
    attributes.length ??
    'N/A';

  useEffect(() => {
    async function loadGeneratedTable() {
      if (!schemaId) {
        return;
      }

      try {
        const response =
          await getGeneratedTableBySchema(schemaId);

        const table =
          response.generatedTable ||
          response.generated_table ||
          response.table ||
          response.data ||
          response;

        if (table?.id) {
          setGeneratedTable(table);
        }
      } catch {
        setGeneratedTable(null);
      }
    }

    loadGeneratedTable();
  }, [schemaId]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!attributesOpen) {
      return undefined;
    }

    function handleViewportChange() {
      updatePopupPosition();
    }

    updatePopupPosition();

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [attributesOpen, attributes, attributesLoading]);

  function updatePopupPosition() {
    const button = attributesButtonRef.current;

    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportPadding = 16;
    const popupGap = 10;
    const popupWidth = Math.min(
      340,
      window.innerWidth - viewportPadding * 2
    );

    let left = rect.left;

    if (
      left + popupWidth >
      window.innerWidth - viewportPadding
    ) {
      left =
        window.innerWidth -
        popupWidth -
        viewportPadding;
    }

    left = Math.max(viewportPadding, left);

    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;

    const actualHeight = attributesPopupRef.current
      ? attributesPopupRef.current.offsetHeight
      : 300;

    let isUpward = spaceBelow < actualHeight && spaceAbove > spaceBelow;

    setPopupPosition({
      top: isUpward ? 'auto' : rect.bottom + popupGap,
      bottom: isUpward ? window.innerHeight - rect.top + popupGap : 'auto',
      left,
      width: popupWidth
    });
  }

  function cancelPopupClose() {
    if (!closeTimerRef.current) {
      return;
    }

    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function schedulePopupClose() {
    cancelPopupClose();

    closeTimerRef.current = window.setTimeout(() => {
      setAttributesOpen(false);
      closeTimerRef.current = null;
    }, 250);
  }

  function handleViewTable() {
    const generatedTableId =
      generatedTable?.id ||
      schema.generated_table_id ||
      schema.generatedTableId;

    if (!generatedTableId) {
      setMessage('A generated table is not available yet.');
      return;
    }

    navigate(`/tables/${generatedTableId}`);
  }

  async function loadAttributes() {
    const existingAttributes =
      extractSchemaAttributes(null, schema);

    if (existingAttributes.length > 0) {
      return existingAttributes;
    }

    if (loadedSchema) {
      return extractSchemaAttributes(loadedSchema, schema);
    }

    if (!schemaId) {
      setPopupError(
        'Schema attributes are not available because the schema ID is missing.'
      );
      return [];
    }

    try {
      setAttributesLoading(true);
      setPopupError('');

      const response = await getSchemaById(schemaId);
      const loadedAttributes =
        extractSchemaAttributes(response, schema);

      setLoadedSchema(response);

      if (loadedAttributes.length === 0) {
        setPopupError(
          'The schema was loaded, but no field definitions were returned.'
        );
      }

      return loadedAttributes;
    } catch (error) {
      setPopupError(
        error?.message ||
        'Unable to load schema attributes.'
      );
      return [];
    } finally {
      setAttributesLoading(false);
    }
  }

  async function handleAttributesEnter() {
    cancelPopupClose();
    updatePopupPosition();
    setAttributesOpen(true);
    await loadAttributes();
  }

  async function handleAttributesClick() {
    cancelPopupClose();

    if (attributesOpen) {
      setAttributesOpen(false);
      return;
    }

    updatePopupPosition();
    setAttributesOpen(true);
    await loadAttributes();
  }

  function handleAttributesKeyDown(event) {
    if (event.key === 'Escape') {
      setAttributesOpen(false);
      attributesButtonRef.current?.focus();
    }
  }

  const attributesPopup = attributesOpen
    ? createPortal(
        <section
          ref={attributesPopupRef}
          className="schema-attributes-popup"
          role="dialog"
          aria-label="Schema attributes"
          style={{
            ...(popupPosition.top !== undefined 
              ? { top: popupPosition.top === 'auto' ? 'auto' : `${popupPosition.top}px` } 
              : {}),
            ...(popupPosition.bottom !== undefined 
              ? { bottom: popupPosition.bottom === 'auto' ? 'auto' : `${popupPosition.bottom}px` } 
              : {}),
            left: `${popupPosition.left}px`,
            width: `${popupPosition.width}px`
          }}
          onMouseEnter={cancelPopupClose}
          onMouseLeave={schedulePopupClose}
          onFocus={cancelPopupClose}
          onBlur={schedulePopupClose}
          onKeyDown={handleAttributesKeyDown}
        >
          <div className="schema-attributes-header">
            <div>
              <strong>Attributes</strong>
              <span>
                {attributes.length}{' '}
                {attributes.length === 1 ? 'field' : 'fields'}
              </span>
            </div>

            <button
              type="button"
              className="schema-attributes-close"
              onClick={() => setAttributesOpen(false)}
              aria-label="Close attributes"
            >
              ×
            </button>
          </div>

          {attributesLoading ? (
            <div className="schema-attributes-loading">
              Loading attributes...
            </div>
          ) : popupError ? (
            <div className="schema-attributes-error">
              {popupError}
            </div>
          ) : attributes.length > 0 ? (
            <div className="schema-attributes-list">
              {attributes.map((attribute, index) => {
                const attributeName =
                  attribute.name ||
                  attribute.column_name ||
                  attribute.columnName ||
                  `field_${index + 1}`;

                const attributeType =
                  attribute.type ||
                  attribute.data_type ||
                  attribute.dataType ||
                  'string';

                const isPrimaryKey = Boolean(
                  attribute.primaryKey ||
                  attribute.primary_key
                );

                const isRequired = Boolean(
                  attribute.notNull ||
                  attribute.not_null ||
                  attribute.required
                );

                const isUnique = Boolean(attribute.unique);

                return (
                  <div
                    className="schema-attribute-row"
                    key={`${attributeName}-${index}`}
                  >
                    <div className="schema-attribute-main">
                      <span
                        className={[
                          'schema-attribute-icon',
                          isPrimaryKey
                            ? 'schema-attribute-icon--key'
                            : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-hidden="true"
                      >
                        {isPrimaryKey ? '◆' : '·'}
                      </span>

                      <code className="schema-attribute-name">
                        {attributeName}
                      </code>
                    </div>

                    <div className="schema-attribute-details">
                      <span className="schema-attribute-type">
                        {attributeType}
                      </span>

                      {isPrimaryKey && (
                        <span className="schema-constraint-badge">
                          PK
                        </span>
                      )}

                      {isRequired && (
                        <span className="schema-constraint-badge">
                          Required
                        </span>
                      )}

                      {isUnique && (
                        <span className="schema-constraint-badge">
                          Unique
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="schema-attributes-empty">
              No attributes are available.
            </p>
          )}
        </section>,
        document.body
      )
    : null;

  return (
    <>
      <article
        className={[
          'schema-card-item',
          'schema-item',
          compact ? 'schema-card-item--compact' : ''
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="schema-item-top">
          <div className="schema-card-heading">
            <h3 className="schema-name">
              {schema.name ||
                schema.original_file_name ||
                schema.original_name ||
                'Untitled schema'}
            </h3>

            <p className="schema-card-subtitle">
              {schema.original_file_name ||
                schema.description ||
                'Uploaded schema'}
            </p>
          </div>

          <span className="type-badge">
            {schema.file_type ||
              schema.source_format ||
              'schema'}
          </span>
        </div>

        <div className="schema-meta schema-meta--compact">
          <span>
            <strong>Fields:</strong>{' '}
            {fieldCount}
          </span>

          <span>
            <strong>Status:</strong>{' '}
            {isBuilt
              ? 'BUILT'
              : schema.status || 'UPLOADED'}
          </span>
        </div>

        {message && (
          <p className="schema-note">
            {message}
          </p>
        )}

        <div className="schema-actions schema-actions--compact">
          {isBuilt && (
            <button
              type="button"
              className="secondary-btn schema-view-table-btn"
              onClick={handleViewTable}
            >
              View Table
            </button>
          )}

          <div className="schema-attributes-control">
            <button
              ref={attributesButtonRef}
              type="button"
              className={[
                'secondary-btn',
                'schema-attributes-btn',
                attributesOpen
                  ? 'schema-attributes-btn--active'
                  : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={handleAttributesEnter}
              onMouseLeave={schedulePopupClose}
              onFocus={handleAttributesEnter}
              onBlur={schedulePopupClose}
              onClick={handleAttributesClick}
              onKeyDown={handleAttributesKeyDown}
              disabled={attributesLoading}
              aria-expanded={attributesOpen}
              aria-haspopup="dialog"
            >
              {attributesLoading
                ? 'Loading...'
                : 'View Attributes'}
            </button>
          </div>

          <button
            type="button"
            className="danger-btn schema-delete-btn"
            onClick={() => onRequestDelete?.(schema)}
          >
            Delete
          </button>
        </div>
      </article>

      {attributesPopup}
    </>
  );
}
