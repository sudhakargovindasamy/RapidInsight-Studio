const path = require('path');
const dotenvPath = path.resolve(__dirname, '../backend/services/gateway/node_modules/dotenv');
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/gateway/.env') });

const { createClient } = require(path.resolve(__dirname, '../backend/services/gateway/node_modules/@supabase/supabase-js'));

const GATEWAY_URL = 'http://localhost:3000';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function apiRequest(endpoint, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${GATEWAY_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { status: response.status, ok: response.ok, data: json };
}

async function runAuthorizationTestSuite() {
  console.log('===============================================================');
  console.log('   RAPIDINSIGHTSTUDIO: PROJECT AUTHORIZATION & ISOLATION TEST   ');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passedTests++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  const timestamp = Date.now();
  const userA = {
    username: `usera_${timestamp}`,
    email: `usera_${timestamp}@testauth.com`,
    password: 'Password123!',
    token: null,
    id: null,
    projectId: null
  };

  const userB = {
    username: `userb_${timestamp}`,
    email: `userb_${timestamp}@testauth.com`,
    password: 'Password123!',
    token: null,
    id: null,
    projectId: null
  };

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Registration of User A and User B
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Registering User A and User B...');

    const signupARes = await apiRequest('/auth/signup', {
      method: 'POST',
      body: {
        username: userA.username,
        email: userA.email,
        password: userA.password,
        confirmPassword: userA.password
      }
    });
    assert(signupARes.status === 201 && signupARes.data.success, 'User A registered successfully');

    const signupBRes = await apiRequest('/auth/signup', {
      method: 'POST',
      body: {
        username: userB.username,
        email: userB.email,
        password: userB.password,
        confirmPassword: userB.password
      }
    });
    assert(signupBRes.status === 201 && signupBRes.data.success, 'User B registered successfully');

    // -------------------------------------------------------------------------
    // STEP 2: Authenticate User A and User B
    // -------------------------------------------------------------------------
    console.log('\n[STEP 2] Authenticating User A and User B...');

    const loginARes = await apiRequest('/auth/login', {
      method: 'POST',
      body: { username: userA.username, password: userA.password }
    });
    assert(loginARes.status === 200 && loginARes.data.session?.access_token, 'User A authenticated');
    userA.token = loginARes.data.session.access_token;
    userA.id = loginARes.data.user.id;

    const loginBRes = await apiRequest('/auth/login', {
      method: 'POST',
      body: { username: userB.username, password: userB.password }
    });
    assert(loginBRes.status === 200 && loginBRes.data.session?.access_token, 'User B authenticated');
    userB.token = loginBRes.data.session.access_token;
    userB.id = loginBRes.data.user.id;

    assert(userA.id !== userB.id, 'User A and User B have distinct user IDs');

    // -------------------------------------------------------------------------
    // STEP 3: Project Creation under Same Organisation Name
    // -------------------------------------------------------------------------
    console.log('\n[STEP 3] Creating Project A for User A and Project B for User B...');

    const createProjARes = await apiRequest('/projects', {
      method: 'POST',
      token: userA.token,
      body: {
        name: `Project Alpha ${timestamp}`,
        customerName: 'Rapid Insight Studio',
        description: 'Private project owned exclusively by User A'
      }
    });
    assert(createProjARes.status === 201 && createProjARes.data.data?.id, 'User A created Project A');
    userA.projectId = createProjARes.data.data.id;
    assert(createProjARes.data.data.created_by === userA.id, 'Project A backend created_by matches User A ID');

    const createProjBRes = await apiRequest('/projects', {
      method: 'POST',
      token: userB.token,
      body: {
        name: `Project Beta ${timestamp}`,
        customerName: 'Rapid Insight Studio',
        description: 'Private project owned exclusively by User B'
      }
    });
    assert(createProjBRes.status === 201 && createProjBRes.data.data?.id, 'User B created Project B');
    userB.projectId = createProjBRes.data.data.id;
    assert(createProjBRes.data.data.created_by === userB.id, 'Project B backend created_by matches User B ID');

    // -------------------------------------------------------------------------
    // STEP 4: Project Listing Isolation
    // -------------------------------------------------------------------------
    console.log('\n[STEP 4] Verifying Project Listing Isolation (/projects)...');

    const listProjARes = await apiRequest('/projects', { token: userA.token });
    assert(listProjARes.status === 200, 'User A listed projects successfully');
    const userAProjects = listProjARes.data.data || [];
    assert(
      userAProjects.some((p) => p.id === userA.projectId),
      'User A project list includes Project A'
    );
    assert(
      !userAProjects.some((p) => p.id === userB.projectId),
      'User A project list DOES NOT contain Project B (No leakage)'
    );

    const listProjBRes = await apiRequest('/projects', { token: userB.token });
    assert(listProjBRes.status === 200, 'User B listed projects successfully');
    const userBProjects = listProjBRes.data.data || [];
    assert(
      userBProjects.some((p) => p.id === userB.projectId),
      'User B project list includes Project B'
    );
    assert(
      !userBProjects.some((p) => p.id === userA.projectId),
      'User B project list DOES NOT contain Project A (No leakage)'
    );

    // -------------------------------------------------------------------------
    // STEP 5: Unauthorized Direct Project Access (ID Manipulation/Guessing)
    // -------------------------------------------------------------------------
    console.log('\n[STEP 5] Testing Unauthorized Direct Project Access (/projects/:id)...');

    // User A attempts to GET Project B
    const userAGetBRes = await apiRequest(`/projects/${userB.projectId}`, { token: userA.token });
    assert(
      userAGetBRes.status === 404 || userAGetBRes.status === 403,
      `User A GET Project B rejected with status ${userAGetBRes.status} (Forbidden/Not Found)`
    );

    // User B attempts to GET Project A
    const userBGetARes = await apiRequest(`/projects/${userA.projectId}`, { token: userB.token });
    assert(
      userBGetARes.status === 404 || userBGetARes.status === 403,
      `User B GET Project A rejected with status ${userBGetARes.status} (Forbidden/Not Found)`
    );

    // User A attempts to GET Project B Dashboard
    const userAGetBDashRes = await apiRequest(`/projects/${userB.projectId}/dashboard`, { token: userA.token });
    assert(
      userAGetBDashRes.status === 404 || userAGetBDashRes.status === 403,
      `User A GET Project B Dashboard rejected with status ${userAGetBDashRes.status}`
    );

    // -------------------------------------------------------------------------
    // STEP 6: Unauthorized Project Deletion Attempt
    // -------------------------------------------------------------------------
    console.log('\n[STEP 6] Testing Unauthorized Project Deletion Attempt...');

    // User A attempts to DELETE Project B
    const userADelBRes = await apiRequest(`/projects/${userB.projectId}`, {
      method: 'DELETE',
      token: userA.token
    });
    assert(
      userADelBRes.status === 404 || userADelBRes.status === 403,
      `User A DELETE Project B rejected with status ${userADelBRes.status}`
    );

    // Verify Project B still exists and is accessible to User B
    const verifyBRes = await apiRequest(`/projects/${userB.projectId}`, { token: userB.token });
    assert(verifyBRes.status === 200, 'Project B intact and still accessible to legitimate owner User B');

    // -------------------------------------------------------------------------
    // STEP 7: Unauthorized Resource Access (Schemas, Tables, Models, Catalog)
    // -------------------------------------------------------------------------
    console.log('\n[STEP 7] Testing Resource-Level Authorization (Schemas, Tables, Models, Catalog)...');

    // Schemas endpoint
    const schemaAccessRes = await apiRequest(`/schema?projectId=${userB.projectId}`, { token: userA.token });
    assert(
      schemaAccessRes.status === 404 || schemaAccessRes.status === 403,
      `User A listing schemas of Project B rejected with status ${schemaAccessRes.status}`
    );

    // Tables endpoint
    const tableAccessRes = await apiRequest(`/tables?projectId=${userB.projectId}`, { token: userA.token });
    assert(
      tableAccessRes.status === 404 || tableAccessRes.status === 403,
      `User A listing tables of Project B rejected with status ${tableAccessRes.status}`
    );

    // Project Data Model endpoint
    const modelAccessRes = await apiRequest(`/tables/projects/${userB.projectId}/data-model`, { token: userA.token });
    assert(
      modelAccessRes.status === 404 || modelAccessRes.status === 403,
      `User A fetching data model of Project B rejected with status ${modelAccessRes.status}`
    );

    // Catalog Sources endpoint
    const catalogSourceRes = await apiRequest(`/schema/catalog/sources?projectId=${userB.projectId}`, { token: userA.token });
    assert(
      catalogSourceRes.status === 404 || catalogSourceRes.status === 403,
      `User A fetching catalog sources of Project B rejected with status ${catalogSourceRes.status}`
    );

    // Catalog Profile Stat endpoint
    const profileStatRes = await apiRequest('/schema/catalog/profile', {
      method: 'POST',
      token: userA.token,
      body: {
        projectId: userB.projectId,
        columnId: '00000000-0000-0000-0000-000000000000',
        statistic: 'COUNT'
      }
    });
    assert(
      profileStatRes.status === 404 || profileStatRes.status === 403,
      `User A running catalog profiling on Project B rejected with status ${profileStatRes.status}`
    );

    // Generate Tables endpoint
    const generateTablesRes = await apiRequest(`/tables/projects/${userB.projectId}/generate-tables`, {
      method: 'POST',
      token: userA.token,
      body: { rowCount: 10 }
    });
    assert(
      generateTablesRes.status === 404 || generateTablesRes.status === 403,
      `User A trigger generate-tables on Project B rejected with status ${generateTablesRes.status}`
    );

    // -------------------------------------------------------------------------
    // STEP 8: Logout and Re-login Session Preservation
    // -------------------------------------------------------------------------
    console.log('\n[STEP 8] Testing Logout and Re-login Session Preservation...');

    // Simulate User A logging out, discarding token, and logging back in
    const reloginARes = await apiRequest('/auth/login', {
      method: 'POST',
      body: { username: userA.username, password: userA.password }
    });
    assert(reloginARes.status === 200, 'User A re-login successful');
    const newTokenA = reloginARes.data.session.access_token;

    const relistProjARes = await apiRequest('/projects', { token: newTokenA });
    assert(relistProjARes.status === 200, 'User A listed projects after re-login');
    const relistAProjects = relistProjARes.data.data || [];
    assert(
      relistAProjects.some((p) => p.id === userA.projectId),
      'User A still owns and sees Project A after re-login'
    );
    assert(
      !relistAProjects.some((p) => p.id === userB.projectId),
      'User A still CANNOT see Project B after re-login'
    );

    // -------------------------------------------------------------------------
    // STEP 9: Direct Database RLS Policy Verification
    // -------------------------------------------------------------------------
    console.log('\n[STEP 9] Verifying Database RLS Policies Directly via User Scoped Clients...');

    const userASupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userA.token}` } }
    });

    const { data: dbProjectsA, error: rlsErrorA } = await userASupabase
      .from('projects')
      .select('id, name, created_by');

    assert(!rlsErrorA, 'User A Supabase query executed without error');
    assert(
      dbProjectsA.every((p) => p.created_by === userA.id),
      'RLS on public.projects: All returned rows have created_by = User A'
    );
    assert(
      !dbProjectsA.some((p) => p.id === userB.projectId),
      'RLS on public.projects: User B project is completely invisible at DB layer'
    );

    console.log('\n===============================================================');
    console.log(`ALL TESTS PASSED! (${passedTests}/${totalTests} assertions passed)`);
    console.log('===============================================================\n');

  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP: Delete created test projects and users safely
    // -------------------------------------------------------------------------
    console.log('Cleaning up test data...');
    try {
      if (userA.projectId) {
        await supabaseAdmin.from('dashboards').delete().eq('project_id', userA.projectId);
        await supabaseAdmin.from('projects').delete().eq('id', userA.projectId);
      }
      if (userB.projectId) {
        await supabaseAdmin.from('dashboards').delete().eq('project_id', userB.projectId);
        await supabaseAdmin.from('projects').delete().eq('id', userB.projectId);
      }
      if (userA.id) {
        await supabaseAdmin.from('profiles').delete().eq('auth_user_id', userA.id);
        await supabaseAdmin.auth.admin.deleteUser(userA.id);
      }
      if (userB.id) {
        await supabaseAdmin.from('profiles').delete().eq('auth_user_id', userB.id);
        await supabaseAdmin.auth.admin.deleteUser(userB.id);
      }
      console.log('Test data cleaned up successfully.');
    } catch (cleanupErr) {
      console.error('Error during test cleanup:', cleanupErr);
    }
  }
}

runAuthorizationTestSuite().catch((err) => {
  console.error('\nTest Suite FAILED with error:\n', err);
  process.exit(1);
});
