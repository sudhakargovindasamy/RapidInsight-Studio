const normalizeCustomerName = require('../utils/normalizeCustomerName');

async function findOrCreateCustomerOrganisation({ supabase, customerName, userId }) {
  const cleanName = String(customerName || '').trim().replace(/\s+/g, ' ');

  if (!cleanName) {
    const error = new Error('Customer Name is required.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedName = normalizeCustomerName(cleanName);

  const { data: existing, error: findError } = await supabase
    .from('organisations')
    .select('id, name, normalized_name, created_by, created_at, updated_at')
    .eq('normalized_name', normalizedName)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from('organisations')
    .insert({
      name: cleanName,
      normalized_name: normalizedName,
      created_by: userId
    })
    .select('id, name, normalized_name, created_by, created_at, updated_at')
    .single();

  if (!createError) return created;

  const duplicate =
    createError.code === '23505' ||
    String(createError.message || '').toLowerCase().includes('duplicate');

  if (!duplicate) throw createError;

  const { data: raceWinner, error: raceError } = await supabase
    .from('organisations')
    .select('id, name, normalized_name, created_by, created_at, updated_at')
    .eq('normalized_name', normalizedName)
    .single();

  if (raceError) throw raceError;
  return raceWinner;
}

module.exports = { findOrCreateCustomerOrganisation };