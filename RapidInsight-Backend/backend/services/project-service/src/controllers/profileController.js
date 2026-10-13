import { createUserSupabaseClient } from '../config/createUserSupabaseClient.js';
import { getAccessTokenFromRequest } from '../utils/getAccessTokenFromRequest.js';

async function getProfileAndOrganisation(supabase, userId) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, auth_user_id, username, email, organisation_id, created_at, updated_at')
    .eq('auth_user_id', userId)
    .single();

  if (profileError || !profile) {
    const error = new Error('Profile not found for this user.');
    error.statusCode = 404;
    throw error;
  }

  const { data: organisation, error: organisationError } = await supabase
    .from('organisations')
    .select('id, name, created_by, created_at, updated_at')
    .eq('id', profile.organisation_id)
    .single();

  if (organisationError || !organisation) {
    const error = new Error('Organisation not found for this user.');
    error.statusCode = 404;
    throw error;
  }

  return {
    profile,
    organisation
  };
}

export async function getMe(req, res) {
  try {
    const token = getAccessTokenFromRequest(req);
    const supabase = createUserSupabaseClient(token);

    const { profile, organisation } = await getProfileAndOrganisation(
      supabase,
      req.user.id
    );

    return res.status(200).json({
      user: {
        id: req.user.id,
        email: req.user.email,
        username: profile.username
      },
      profile,
      organisation
    });
  } catch (error) {
    console.error('GET /me error:', error);

    return res.status(error.statusCode || 500).json({
      message: error.message || 'Failed to load profile.'
    });
  }
}

export { getProfileAndOrganisation };
