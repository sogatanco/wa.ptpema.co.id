export function apiKeyAuth(API_KEY) {
    return function (req, res, next) {
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: Bearer token required' });
        }
        const token = authHeader.split(' ')[1];
        if (token !== API_KEY) {
            return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
        }
        next();
    };
}
