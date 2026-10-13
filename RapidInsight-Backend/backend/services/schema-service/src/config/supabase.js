const { createClient } = require('@supabase/supabase-js');

const env = require('./env');

function createSupabaseClient(accessToken) {
  return createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    }
  );
}

function createSupabaseAdminClient() {
  return createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );
}

module.exports = {
  createSupabaseClient,
  createSupabaseAdminClient
};