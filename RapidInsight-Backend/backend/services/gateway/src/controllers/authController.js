const { supabase, supabaseAdmin } = require('../config/supabase');

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function signup(req, res, next) {
  try {
    const username = normalizeUsername(req.body.username);
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;
    const confirmPassword = req.body.confirmPassword;

    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required.' });
    }

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Password and Confirm Password do not match.' });
    }

    const { data: existingUsername, error: usernameError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (usernameError) throw usernameError;

    if (existingUsername) {
      return res.status(409).json({ success: false, message: 'Username already exists.' });
    }

    const { data: existingEmail, error: emailError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (emailError) throw emailError;

    if (existingEmail) {
      return res.status(409).json({ success: false, message: 'Email already exists.' });
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username }
    });

    if (authError) {
      return res.status(400).json({
        success: false,
        message: authError.message || 'Unable to create auth user.'
      });
    }

    const authUserId = authData.user.id;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        auth_user_id: authUserId,
        username,
        email
      })
      .select('id, auth_user_id, username, email, created_at, updated_at')
      .single();

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      throw profileError;
    }

    return res.status(201).json({
      success: true,
      message: 'Signup successful.',
      profile
    });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const username = normalizeUsername(req.body.username);
    const password = req.body.password;

    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required.' });
    }

    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, auth_user_id, username, email, created_at, updated_at')
      .eq('username', username)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const { data: authData, error: loginError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password
    });

    if (loginError) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    return res.json({
      success: true,
      message: 'Login successful.',
      session: authData.session,
      user: authData.user,
      profile
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  signup,
  login
};