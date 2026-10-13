import { useProjectRefresh } from '../context/ProjectRefreshContext.jsx';
import { useCallback, useEffect, useState } from 'react';

import {
  getSchemasByProject,
  getSchemaById
} from '../api/schemaApi';

import {
  getGeneratedTableBySchema,
  getProjectDataModel
} from '../api/tableApi';

function getSchemaId(schema) {
  return schema.schema_id || schema.id;
}

function normalizeGeneratedTable(result) {
  return result?.table || result?.generatedTable || result?.data || result || null;
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function extractModelJson(response) {
  const model = response?.data || response?.model || response || null;
  return model?.model_json || model?.modelJson || null;
}

function buildBlueprintTableBySchemaId(modelJson) {
  const map = new Map();

  (modelJson?.tables || []).forEach((table) => {
    if (table.schema_id) {
      map.set(table.schema_id, table);
    }
  });

  return map;
}

function buildRelationshipLookup(modelJson) {
  const fkByTableColumn = new Map();

  (modelJson?.relationships || []).forEach((relationship) => {
    const key = `${normalizeName(relationship.from_table)}.${normalizeName(relationship.from_column)}`;
    fkByTableColumn.set(key, relationship);
  });

  return {
    fkByTableColumn
  };
}

export function usePlaygroundSchemas(projectId) {
  const { refreshKey } = useProjectRefresh(projectId);
  const [entities, setEntities] = useState([]);
  const [dataModel, setDataModel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const hydrateSchemas = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    setError('');

    try {
      const modelResponse = await getProjectDataModel(projectId).catch(() => null);
      const modelJson = extractModelJson(modelResponse);
      const blueprintBySchemaId = buildBlueprintTableBySchemaId(modelJson);
      const relationshipLookup = buildRelationshipLookup(modelJson);

      setDataModel(modelJson || null);

      const response = await getSchemasByProject(projectId);
      const schemas = response?.schemas || response?.data || response || [];

      const enriched = await Promise.all(
        schemas.map(async (schema) => {
          const schemaId = getSchemaId(schema);
          const blueprintTable = blueprintBySchemaId.get(schemaId) || null;

          let generatedTable = null;
          let schemaDefinition = null;

          try {
            const generatedResponse = await getGeneratedTableBySchema(schemaId);
            generatedTable = normalizeGeneratedTable(generatedResponse);
          } catch {
            generatedTable = null;
          }

          try {
            const fullSchemaRes = await getSchemaById(schemaId);

            schemaDefinition =
              fullSchemaRes?.data?.schemaDefinition ||
              fullSchemaRes?.schemaDefinition ||
              null;
          } catch {
            schemaDefinition = null;
          }

          const tableName =
            blueprintTable?.table_name ||
            generatedTable?.physical_table_name ||
            schema.physical_table_name ||
            schema.sanitized_table_name ||
            schema.name ||
            schema.display_name ||
            schema.original_file_name ||
            'Untitled';

          return {
            ...schema,
            schema_id: schemaId,
            schema_definition: schemaDefinition,
            blueprintTable,
            tableType: blueprintTable?.table_type || null,
            primaryKey: blueprintTable?.primary_key || null,
            generatedTableId:
              generatedTable?.id ||
              generatedTable?.generated_table_id ||
              generatedTable?.generatedTableId ||
              schema.generated_table_id ||
              null,
            generatedTable,
            rowCount: Number(generatedTable?.row_count || generatedTable?.rows || generatedTable?.record_count || 0),
            tableStatus: generatedTable?.status || schema.table_status || schema.status,
            tableName,
            relationshipLookup
          };
        })
      );

      const builtEntities = enriched.filter((entity) => {
        const status = String(entity.tableStatus || '').toUpperCase();

        return (
          entity.generatedTableId &&
          ['CREATED', 'BUILT', 'POPULATED'].includes(status)
        );
      });

      setEntities(builtEntities);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load playground schemas.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    hydrateSchemas();
  }, [hydrateSchemas, refreshKey]);

  return {
    entities,
    dataModel,
    loading,
    error,
    searchTerm,
    setSearchTerm,
    refresh: hydrateSchemas
  };
}
