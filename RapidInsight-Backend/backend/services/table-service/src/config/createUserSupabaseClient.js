const { createClient } = require('@supabase/supabase-js');

function createUserSupabaseClient(accessToken) {
  if (!process.env.SUPABASE_URL) {
    throw new Error('SUPABASE_URL is required.');
  }

  if (!process.env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY is required.');
  }

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );
}

module.exports = createUserSupabaseClient;
