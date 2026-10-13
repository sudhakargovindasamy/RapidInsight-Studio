const path = require('path');
const { spawn } = require('child_process');

const { resolveSdvPython } = require('./resolve-sdv-python');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_DIR = path.join(REPO_ROOT, 'backend', 'services', 'sdv-service');

function main() {
  let python;

  try {
    python = resolveSdvPython({ repoRoot: REPO_ROOT });
  } catch (error) {
    // This runs under concurrently alongside six Node services, so the message
    // has to be readable in a crowded, interleaved log.
    console.error('\n[sdv-service] cannot start\n');
    console.error(error.message);
    console.error('');

    process.exit(1);
  }

  const args = [
    '-m',
    'uvicorn',
    'app.main:app',
    '--port',
    process.env.SDV_PORT || '3008'
  ];

  if (process.argv.includes('--reload')) args.push('--reload');

  console.log(`[sdv-service] using ${python}`);

  const child = spawn(python, args, {
    cwd: SERVICE_DIR,
    stdio: 'inherit'
  });

  child.on('error', (error) => {
    console.error(`[sdv-service] failed to launch: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => process.exit(code ?? 0));

  // Without this, stopping the parent leaves uvicorn holding port 3008 and the
  // next start fails with an address-in-use error.
  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => child.kill(signal));
  });
}

main();