const { z } = require('zod');

const signupSchema = z.object({
    body: z
        .object({
            username: z
                .string()
                .trim()
                .min(3, 'Username must have at least 3 characters.')
                .max(50, 'Username cannot exceed 50 characters.'),

            email: z
                .string()
                .trim()
                .email('A valid email is required.'),

            password: z
                .string()
                .min(6, 'Password must have at least 6 characters.')
                .max(128, 'Password is too long.'),

            confirmPassword: z.string()
        })
        .refine(
            (data) => data.password === data.confirmPassword,
            {
                message: 'Password and Confirm Password do not match.',
                path: ['confirmPassword']
            }
        ),

    params: z.object({}),
    query: z.object({})
});

const loginSchema = z.object({
    body: z.object({
        username: z
            .string()
            .trim()
            .min(1, 'Username is required.'),

        password: z
            .string()
            .min(1, 'Password is required.')
    }),

    params: z.object({}),
    query: z.object({})
});

module.exports = {
    signupSchema,
    loginSchema
};