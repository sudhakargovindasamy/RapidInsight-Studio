const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  resolveSdvPython,
  interpreterIn,
  IS_WINDOWS
} = require('./resolve-sdv-python');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const REQUIREMENTS = path.join(
  REPO_ROOT,
  'backend',
  'services',
  'sdv-service',
  'requirements.txt'
);

/*
 * Creates the Python environment for sdv-service.
 *
 * The location is deliberately short and outside the repository. SDV pulls in
 * torch, whose licence files sit about thirteen folders deep, and on Windows the
 * full path then exceeds the 260-character limit - pip aborts halfway with
 * WinError 206. Measured on this repo: a venv at the project root left roughly
 * 250 characters in use and failed; C:\sdvenv leaves ~70 characters spare.
 *
 * Enabling LongPathsEnabled in the registry is the tidier fix, but it needs
 * administrator rights that not every developer has.
 */
function defaultVenvDir() {
  return IS_WINDOWS ? 'C:\\sdvenv' : path.join(REPO_ROOT, '.venv-sdv');
}

function run(command, args, label) {
  console.log(`\n> ${label}`);

  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.error) {
    console.error(`\nFailed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) process.exit(result.status ?? 1);
}

// On Linux, pip's default torch wheel bundles CUDA libraries (several GB). Hosts
// like Render have no GPU, so install the CPU-only build first; the later
// requirements install then sees torch as already satisfied.
function installDependencies(python) {
  if (process.platform === 'linux' && !process.env.SDV_SKIP_CPU_TORCH) {
    run(
      python,
      [
        '-m',
        'pip',
        'install',
        'torch',
        '--extra-index-url',
        'https://download.pytorch.org/whl/cpu'
      ],
      'pip install torch (CPU-only)'
    );
  }

  run(python, ['-m', 'pip', 'install', '-r', REQUIREMENTS], 'pip install');
}

function main() {
  // Only reuse the venv at the location we would create, so a stale one
  // elsewhere (e.g. a cached ~/.sdvenv) cannot hide a missing target.
  const target = process.env.SDV_VENV_DIR || defaultVenvDir();
  const existing = fs.existsSync(interpreterIn(target))
    ? interpreterIn(target)
    : null;

  if (existing) {
    console.log(`Found an existing SDV environment: ${existing}`);
    console.log('Reinstalling requirements into it.\n');

    installDependencies(existing);
    verify(existing);

    return;
  }

  const venvDir = target;
  const python = interpreterIn(venvDir);

  console.log(`Creating a Python environment for sdv-service at ${venvDir}`);
  console.log('(kept short and outside the repo - see the comment in this file)');

  if (!fs.existsSync(python)) {
    run(
      IS_WINDOWS ? 'python' : 'python3',
      ['-m', 'venv', venvDir],
      `create venv at ${venvDir}`
    );
  }

  installDependencies(python);
  verify(python);
}

function verify(python) {
  console.log('\n> verifying');

  const result = spawnSync(
    python,
    [
      '-c',
      "import sdv, torch; print('sdv', sdv.__version__, '| torch', torch.__version__)"
    ],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    console.error('\nSDV did not import cleanly after install:');
    console.error(result.stderr || result.stdout);
    console.error(
      '\nIf this is WinError 206, the path is too long. Set SDV_VENV_DIR to a ' +
        'shorter location and try again, for example:  set SDV_VENV_DIR=C:\\sdvenv'
    );

    process.exit(1);
  }

  console.log(result.stdout.trim());
  console.log(`\nDone. sdv-service will use: ${python}`);
  console.log('Start everything with:  npm run dev --prefix backend');
}

main();