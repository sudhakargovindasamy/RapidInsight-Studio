import './DeleteSchemaModal.css';

export default function DeleteSchemaModal({
  schema,
  isDeleting,
  onCancel,
  onConfirm
}) {
  if (!schema) return null;

  const hasGeneratedTable =
    Boolean(schema.generated_table_id) ||
    Boolean(schema.generatedTableId) ||
    Boolean(schema.physical_table_name) ||
    String(schema.table_status || '').toUpperCase() === 'BUILT';

  return (
    <div className="delete-schema-backdrop" role="presentation">
      <div className="delete-schema-modal" role="dialog" aria-modal="true">
        <h3>Delete schema file?</h3>

        <p>
          Are you sure you want to delete this schema file?
        </p>

        <div className="delete-schema-name">
          {schema.original_file_name || schema.display_name || schema.name || schema.id}
        </div>

        {hasGeneratedTable && (
          <div className="delete-schema-warning">
            Deleting this schema will also remove the generated table and its data.
          </div>
        )}

        <div className="delete-schema-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>

          <button
            type="button"
            className="danger-btn"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
