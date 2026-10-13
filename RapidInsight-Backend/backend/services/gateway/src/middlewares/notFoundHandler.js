function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        message: 'Gateway route not found.',
        code: 'ROUTE_NOT_FOUND',
        requestId: req.id
    });
}

module.exports = notFoundHandler;