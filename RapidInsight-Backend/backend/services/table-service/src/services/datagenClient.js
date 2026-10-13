const axios = require('axios');

const DEFAULT_DATAGEN_URL = 'http://localhost:3002';

/*
 * Generating data can mean training an SDV model per table.
 *
 * A warm model samples in about a second, but a cold one takes 30-90 seconds to
 * fit, and a project with several new tables pays that per table. The old
 * 120-second budget was set when generation was Faker and effectively instant.
 */
const DEFAULT_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.DATAGEN_TIMEOUT_MS, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900000;
})();

function getDatagenUrl() {
  return String(process.env.DATAGEN_SERVICE_URL || DEFAULT_DATAGEN_URL).replace(
    /\/+$/,
    ''
  );
}

function buildHeaders({ accessToken, userId, userEmail }) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'x-user-id': userId,
    'x-user-email': userEmail || '',
    'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY
  };
}

/*
 * datagen-service has no fallback generator now that Faker is gone, so a
 * failure here stops the run. Surfacing its message rather than a generic one
 * matters: it is the message that says the SDV sidecar is not running and how
 * to start it.
 */
function wrapDatagenError(error) {
  const upstream =
    error.response?.data?.message ||
    error.response?.data?.detail ||
    error.message;

  const wrapped = new Error(upstream || 'Data generation failed.');

  wrapped.statusCode = error.response?.status === 422 ? 422 : 502;
  wrapped.code = error.response?.data?.code || 'DATAGEN_REQUEST_FAILED';

  return wrapped;
}

async function generateRows({
  schemaDefinition,
  rowCount,
  seedRows = [],
  schemaId,
  tableName,
  userId,
  userEmail,
  accessToken
}) {
  try {
    const response = await axios.post(
      `${getDatagenUrl()}/datagen/generate`,
      {
        schemaDefinition,
        rowCount,
        seedRows,
        schemaId,
        tableName
      },
      {
        headers: buildHeaders({ accessToken, userId, userEmail }),
        timeout: DEFAULT_TIMEOUT_MS
      }
    );

    return response.data?.rows || response.data?.data || [];
  } catch (error) {
    throw wrapDatagenError(error);
  }
}

async function generateRelationalRows({
  blueprint,
  schemas,
  rowCount,
  // Keyed by schema_id. Written at schema-upload time and read back here, so
  // SDV has something to learn each table's shape from.
  seedRows = {},
  randomSeed,
  userId,
  userEmail,
  accessToken
}) {
  try {
    const response = await axios.post(
      `${getDatagenUrl()}/datagen/generate-relational`,
      {
        blueprint,
        schemas,
        rowCount,
        seedRows,
        randomSeed
      },
      {
        headers: buildHeaders({ accessToken, userId, userEmail }),
        timeout: DEFAULT_TIMEOUT_MS
      }
    );

    return response.data?.data || null;
  } catch (error) {
    throw wrapDatagenError(error);
  }
}

/*
 * Whether the SDV sidecar behind datagen-service is up.
 *
 * Checked before a run starts so the user is told immediately, rather than
 * after waiting through relationship inference and table creation.
 */
async function checkSdvStatus() {
  try {
    const response = await axios.get(`${getDatagenUrl()}/datagen/sdv-status`, {
      headers: {
        'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY,
        'x-user-id': 'table-service'
      },
      timeout: 10000
    });

    return response.data?.data || { reachable: false };
  } catch (error) {
    return {
      reachable: false,
      message:
        error.response?.data?.data?.message ||
        error.message ||
        'Could not reach datagen-service.'
    };
  }
}

module.exports = {
  generateRows,
  generateRelationalRows,
  checkSdvStatus
};