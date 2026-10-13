async function uploadSchemaDefinition({ supabase, bucket, path, schemaDefinition }) {
  const json = JSON.stringify(schemaDefinition, null, 2);

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, json, {
      contentType: 'application/json',
      upsert: true
    });

  if (error) throw error;

  return {
    bucket,
    path
  };
}

async function uploadRawDataFile({ supabase, bucket, path, buffer, contentType }) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      upsert: true
    });

  if (error) throw error;
  return { bucket, path };
}

module.exports = { uploadSchemaDefinition, uploadRawDataFile };