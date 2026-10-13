const fs = require('fs');
const path = require('path');

/*
 * Finds the Python interpreter that has SDV installed.
 *
 * The venv cannot simply live inside services/sdv-service. SDV depends on torch,
 * which ships licence files nested about thirteen folders deep, and on Windows
 * the resulting absolute paths exceed the 260-character limit - pip fails
 * partway through with WinError 206. How much room is left depends entirely on
 * where the repository was cloned, so there is no location that is safe for
 * everyone.
 *
 * Hence a search rather than a fixed path, and SDV_PYTHON as the escape hatch.
 */

const IS_WINDOWS = process.platform === 'win32';

function interpreterIn(venvDir) {
  return IS_WINDOWS
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

// Ordered by preference. A short absolute path is listed first because it is the
// one that reliably works on Windows regardless of where the repo lives.
function candidateVenvs(repoRoot) {
  const candidates = [];

  // An explicit venv dir wins, so setup and startup always agree on one place.
  if (process.env.SDV_VENV_DIR) candidates.push(process.env.SDV_VENV_DIR);

  if (IS_WINDOWS) {
    candidates.push('C:\\sdvenv');
  } else {
    candidates.push(path.join(require('os').homedir(), '.sdvenv'));
  }

  candidates.push(path.join(repoRoot, '.venv-sdv'));
  candidates.push(path.join(repoRoot, 'backend', 'services', 'sdv-service', '.venv'));

  return candidates;
}

function resolveSdvPython({ repoRoot, requireFound = true }) {
  // An explicit setting always wins - a teammate may have put the venv anywhere
  // that happened to fit on their machine.
  if (process.env.SDV_PYTHON) {
    if (!fs.existsSync(process.env.SDV_PYTHON)) {
      throw new Error(
        `SDV_PYTHON is set to "${process.env.SDV_PYTHON}" but no file exists there.`
      );
    }

    return process.env.SDV_PYTHON;
  }

  for (const venv of candidateVenvs(repoRoot)) {
    const interpreter = interpreterIn(venv);

    if (fs.existsSync(interpreter)) return interpreter;
  }

  if (!requireFound) return null;

  throw new Error(
    [
      'Could not find a Python environment with SDV installed.',
      '',
      'Looked in:',
      ...candidateVenvs(repoRoot).map((venv) => `  ${interpreterIn(venv)}`),
      '',
      'Create one with:  npm run setup:sdv --prefix backend',
      'Or point at an existing one:  set SDV_PYTHON=C:\\path\\to\\python.exe'
    ].join('\n')
  );
}

module.exports = {
  resolveSdvPython,
  candidateVenvs,
  interpreterIn,
  IS_WINDOWS
};