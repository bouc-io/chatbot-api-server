import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createComponentLogger } from '../lib/logger';

const logger = createComponentLogger('auth');

const auth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  // Handle potentially comma-separated Authorization headers (e.g. from Istio/Envoy)
  // Logic adapted from agent-api-server/memory-api-server
  if (authHeader) {
    token = authHeader
      .split(',')
      .map((s) => s.trim())
      .find((s) => s.startsWith('Bearer '))
      ?.split(' ')[1];
  }

  // Fallback to x-auth-request-access-token header if Authorization header parsing failed
  if (!token) {
    const headerToken = req.headers['x-auth-request-access-token'];
    if (typeof headerToken === 'string') {
      token = headerToken;
    } else if (Array.isArray(headerToken)) {
      token = headerToken[0];
    }
  }

  if (!token) {
    logger.warn('No token found in Authorization or x-auth-request-access-token headers.');
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.decode(token) as Record<string, any> | null;

    if (!decoded) {
      logger.warn('Token decoding failed (returned null). Token might be invalid.');
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Extract org_id: JWT claim (Keycloak oidc-usermodel-attribute-mapper on user attribute "org_id")
    // Falls back to OAuth2-Proxy injected header
    const org_id: string | null =
      decoded.org_id ||
      (req.headers['x-auth-request-org'] as string) ||
      null;

    // Extract roles: JWT realm_access.roles (Keycloak oidc-usermodel-realm-role-mapper)
    // Falls back to OAuth2-Proxy injected header (comma-separated)
    const roles: string[] =
      decoded.realm_access?.roles ||
      (req.headers['x-auth-request-roles'] as string || '').split(',').filter(Boolean);

    // Attach user to request — preserve full decoded token + add org_id and roles explicitly
    (req as any).user = { ...decoded, org_id, roles };
    next();
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Exception during token decoding');
    res.status(401).json({ error: 'Unauthorized: Token processing failed' });
  }
};

export default auth;

/**
 * Middleware: require at least one of the specified roles.
 * Pass no roles to require only a valid token (any authenticated user).
 * Must be used after the global `auth` middleware so req.user is already set.
 */
export const requireRoles = (...allowed: string[]) =>
    (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user;
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const roles: string[] = user.roles || [];
        if (allowed.length > 0 && !roles.some((r) => allowed.includes(r))) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        }
        next();
    };