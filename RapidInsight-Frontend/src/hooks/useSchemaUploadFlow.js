import { useCallback, useState } from 'react';

import { ApiError } from '../api/apiClient.js';
import { uploadSchema } from '../api/schemaApi.js';

function getDuplicatePayload(error) {
  if (error instanceof ApiError && error.isDuplicateTable) {
    return error.payload;
  }

  if (error?.status === 409 && error?.payload?.status === 'DUPLICATE_TABLE') {
    return error.payload;
  }

  return null;
}

function getDuplicateTableName(payload) {
  return (
    payload?.tableName ||
    payload?.physical_table_name ||
    payload?.physicalTableName ||
    payload?.table ||
    payload?.name ||
    'this table'
  );
}

function buildUploadSuccessMessage(result) {
  const tableName =
    result?.tableName ||
    result?.schema?.physical_table_name ||
    result?.schema?.sanitized_table_name;

  const schemaName =
    result?.schemaName ||
    result?.schema?.physical_schema_name;

  if (tableName && schemaName) {
    return `${tableName} schema uploaded successfully in ${schemaName}.`;
  }

  return result?.message || 'Schema uploaded successfully.';
}

export function useSchemaUploadFlow({ projectId, onSuccess } = {}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [duplicate, setDuplicate] = useState(null);

  const clearMessages = useCallback(() => {
    setError('');
    setSuccess('');
  }, []);

  const clearDuplicate = useCallback(() => {
    setDuplicate(null);
  }, []);

  const upload = useCallback(
    async (file) => {
      if (!projectId) {
        setError('Project is required before uploading schema.');
        return null;
      }

      if (!file) {
        setError('Please select a schema file.');
        return null;
      }

      clearMessages();
      setDuplicate(null);
      setUploading(true);

      try {
        const result = await uploadSchema({
          projectId,
          file,
        });

        setSuccess(buildUploadSuccessMessage(result));

        if (onSuccess) {
          onSuccess(result);
        }

        return result;
      } catch (uploadError) {
        const duplicatePayload = getDuplicatePayload(uploadError);

        if (duplicatePayload) {
          const tableName = getDuplicateTableName(duplicatePayload);

          const message =
            duplicatePayload?.message ||
            uploadError?.message ||
            `A table named ${tableName} already exists. Upload skipped. Please use the existing table or rename the file.`;

          setDuplicate({
            ...duplicatePayload,
            tableName,
            message,
            canOverwrite: false,
          });

          setError(message);
          return null;
        }

        setError(uploadError.message || 'Unable to upload schema.');
        return null;
      } finally {
        setUploading(false);
      }
    },
    [clearMessages, onSuccess, projectId]
  );

  return {
    uploading,
    error,
    success,
    duplicate,
    upload,
    clearDuplicate,
    clearMessages,
  };
}
