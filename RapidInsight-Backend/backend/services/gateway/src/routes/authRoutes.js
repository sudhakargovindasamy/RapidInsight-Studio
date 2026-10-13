const express = require('express');

const {
    signup,
    login
} = require('../controllers/authController');

const validateRequest = require('../middlewares/validateRequest');

const {
    signupSchema,
    loginSchema
} = require('../validators/authSchemas');

const router = express.Router();

router.post(
    '/signup',
    validateRequest(signupSchema),
    signup
);

router.post(
    '/login',
    validateRequest(loginSchema),
    login
);

module.exports = router;