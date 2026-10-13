let ready = true;

function isReady() {
    return ready;
}

function markNotReady() {
    ready = false;
}

module.exports = {
    isReady,
    markNotReady
};