let ready = false;

function markReady() {
  ready = true;
}

function markNotReady() {
  ready = false;
}

function isReady() {
  return ready;
}

module.exports = {
  markReady,
  markNotReady,
  isReady
};