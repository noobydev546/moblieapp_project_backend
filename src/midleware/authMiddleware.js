const jwt = require('jsonwebtoken');

// !! IMPORTANT: Use the *exact same* secret key you used in src/controllers/auth.js
// In a real app, you should load this from your .env file
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_group_project_4';

/**
 * Express middleware to verify a JWT token.
 *
 * This function checks for a token in the 'Authorization' header.
 * If the token is valid, it decodes the payload (user info)
 * and attaches it to the `req.user` object for the next handler to use.
 *
 * If the token is missing or invalid, it sends a 401 Unauthorized response.
 */
function verifyToken(req, res, next) {
    // 1. Get the token from the 'Authorization' header
    // The header format is expected to be "Bearer <token>"
    const authHeader = req.headers.authorization;

    // 2. Check if the header exists and is in the correct format
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Access denied. No token provided or invalid format.' 
        });
    }

    // 3. Extract the token string
    const token = authHeader.split(' ')[1]; // Get the part after "Bearer "

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        // 4. Verify the token using the secret key
        const decodedPayload = jwt.verify(token, JWT_SECRET);

        // 5. ATTACH USER INFO TO THE REQUEST
        // The next route handler (e.g., getProfile, bookRoom)
        // can now access `req.user` to see who made the request.
        req.user = decodedPayload;

        // 6. Pass control to the next function in the chain (the route handler)
        next();

    } catch (err) {
        // 4.1. Handle errors (e.g., token expired, invalid signature)
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired. Please log in again.' });
        }
        
        // For other errors (like invalid signature)
        return res.status(401).json({ error: 'Invalid token.' });
    }
}

// Export the middleware function
module.exports = verifyToken;